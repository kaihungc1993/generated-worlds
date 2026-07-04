# Runs inside Blender headless. Exports the opened .blend to a GLB with
# animations, excluding presentation helpers (text labels, annotation dots,
# cameras) so only the actual asset ships. Authored lamps DO export (as
# KHR_lights_punctual) so lamp-lit scenes keep their lighting character;
# the web viewer normalizes their intensities.
#
# blender -b file.blend -P export-blend.py -- /out/file.glb [--object] [--ground-snap]
import bpy
import json
import re
import sys

args = sys.argv[sys.argv.index('--') + 1:]
out_path = args[0]
is_object = '--object' in args  # single-asset export: strip stage helpers
ground_snap = '--ground-snap' in args  # scene export: drop floating objects onto terrain

EXCLUDE_TYPES = {'FONT', 'CAMERA'}
# Fit/orientation annotation helpers the AI pipeline parents next to each
# asset; they render as floating wireframe rectangles and arrows.
ANNOTATION_MARKERS = re.compile(
    r'__(fit_center_mark|long_axis_arrow|arrow_head|oriented_fit_box)(\.\d+)?$', re.IGNORECASE)
EXCLUDE_NAME = None
if is_object:
    # Presentation/stage helpers that AI generations commonly include around
    # single assets: backdrops, annotation panels, arrows, collision proxies.
    # Besides stage helpers, these assets often contain a static duplicate of
    # the whole object in its "closed" pose next to the articulated one; keep
    # only the articulated copy.
    # Patterns must not swallow real parts: 'arrow' is anchored so it can't
    # match 'narrow', '_CLOSED_' is case-sensitive so it only hits the
    # uppercase duplicate-copy convention (not 'drawer_closed_state' style
    # descriptions on articulated parts), and bare 'backplate' is out because
    # electrical panels/handles legitimately have backplates.
    EXCLUDE_NAME = re.compile(
        r'(backdrop|product_backplate|background|cyclorama|_BG$|^Ann|^AnimControls|^CableRouting'
        r'|^CollisionInfo|^JointLimits|annotat|(^|_)arrow|leader_line|concept_art|convcolonly'
        r'|^Col_|collision|shadow_card|contact_shadow|shadow_under|shadow_cutout|floor_pad'
        r'|reflection_card|reflection_strip|strip_reflection|neg_fill'
        r'|^ground$|^floor$|studio|presentation_copy|stage_floor|photo_stage|infinity_curve'
        r'|^closed_state|^closed_demo|^closed_ref|(?-i:_CLOSED_)|showroom_floor|floor_disc|display_pedestal'
        # Parked alternate-state duplicates ("empty jar" variant next to the
        # hero product) and fake floor caustic patches under glass products.
        r'|^empty_variant|caustic'
        # Non-rendering lookdev guides (lathe profile curves, product framing
        # boxes, layout curves) that sit in the visible view layer.
        r'|profile_guide|frame_guide|^ProductLayout_Curve'
        # Flat fake-specular cards hovering next to glass products and label
        # glue-seam flaps that jut off the silhouette outside a render.
        r'|highlight_smudge|label_seam_overlap)',
        re.IGNORECASE,
    )

def _is_volume_only(o):
    """Fog/atmosphere boxes: volume shader with no surface. glTF can't
    represent volumes, so they'd export as opaque white boxes."""
    if o.type != 'MESH' or not o.data.materials:
        return False
    for m in o.data.materials:
        if not (m and m.use_nodes and m.node_tree):
            return False
        out = next((n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
        if not out or out.inputs['Surface'].is_linked or not out.inputs['Volume'].is_linked:
            return False
    return True


# Scene exports must match the scene's own render: objects with hide_render
# (asset palettes parked off to the side, collision proxies, alternate copies)
# don't appear in renders and must not ship. Backdrop cards (fake sky/mountain
# planes) are replaced by the baked skybox.
SCENE_EXCLUDE = re.compile(r'backdrop', re.IGNORECASE)

if is_object:
    # Viewport-hidden objects can't be selected, so use_selection would drop
    # them silently. Objects that render (hide_render False) are part of the
    # asset (e.g. interior glaze rings temp-hidden while sculpting) — unhide
    # them. Hidden non-rendering proxies (low-poly "_export" threads, GN
    # cutter tools) stay hidden and therefore stay out.
    for o in bpy.data.objects:
        if o.hide_render:
            continue
        try:
            if not o.visible_get():
                o.hide_set(False)
        except RuntimeError:
            pass

selected = []
for o in bpy.data.objects:
    bad = (o.type in EXCLUDE_TYPES
           or (not is_object and o.hide_render)
           or ANNOTATION_MARKERS.search(o.name)
           or (EXCLUDE_NAME and EXCLUDE_NAME.search(o.name))
           or (not is_object and SCENE_EXCLUDE.search(o.name))
           or _is_volume_only(o))
    try:
        o.select_set(not bad)
        if not bad:
            selected.append(o)
    except RuntimeError:
        pass  # object not in the active view layer; exporter won't see it

if is_object:
    # Geometric safety net for unnamed stage geometry (photo floors, backdrop
    # cards): drop meshes that are nearly flat AND dwarf the rest of the asset.
    # Comparing against the extent of everything else — not the median part
    # size — keeps real large panels (drawer fronts, doors, side walls), which
    # are big relative to individual screws but never bigger than the asset.
    from mathutils import Vector

    def _world_extent(objs):
        pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
        if not pts:
            return 0.0
        return max(
            max(p.x for p in pts) - min(p.x for p in pts),
            max(p.y for p in pts) - min(p.y for p in pts),
            max(p.z for p in pts) - min(p.z for p in pts),
        )

    sel_meshes = [o for o in selected if o.type == 'MESH']
    total_extent = _world_extent(sel_meshes)

    def _is_flat(o):
        d = sorted(o.dimensions)
        return d[2] > 1e-6 and d[0] < 0.05 * d[2]

    stage_candidates = [o for o in sel_meshes if _is_flat(o) and max(o.dimensions) > 0.5 * total_extent]
    core_extent = _world_extent([o for o in sel_meshes if o not in stage_candidates])
    if core_extent > 0:
        for o in stage_candidates:
            if max(o.dimensions) > 1.5 * core_extent:
                try:
                    o.select_set(False)
                except RuntimeError:
                    pass

    # Orphan cleanup: when the file contains a static "closed/presentation"
    # duplicate of the whole asset (dropped by name above), a few of the
    # copy's parts are usually named without the prefix (control buttons,
    # door pieces, names truncated at Blender's 63-char limit) and would
    # remain floating in empty space. Drop kept geometry clusters that are
    # disconnected from the main asset and centered inside the excluded
    # copy's bounding box. Curves/surfaces/metaballs count too: they export
    # as meshes, and detail curves on the duplicate (e.g. side-panel groove
    # wires) are just as prone to missing the duplicate's name prefix.
    GEO_TYPES = {'MESH', 'CURVE', 'SURFACE', 'META'}
    DUP_PAT = re.compile(
        r'(^closed_state|^closed_demo|^closed_ref|(?-i:_CLOSED_)|presentation_copy)',
        re.IGNORECASE,
    )
    dup_meshes = [o for o in bpy.data.objects if o.type in GEO_TYPES and DUP_PAT.search(o.name)]
    kept = [o for o in selected if o.type in GEO_TYPES and o.select_get()]
    if dup_meshes and kept and core_extent > 0:
        def _bbox(o):
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            return ([min(p[k] for p in pts) for k in range(3)],
                    [max(p[k] for p in pts) for k in range(3)])

        boxes = [_bbox(o) for o in kept]
        eps = 0.02 * core_extent

        parent = list(range(len(kept)))

        def _find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for i in range(len(kept)):
            ai = boxes[i]
            for j in range(i + 1, len(kept)):
                bj = boxes[j]
                if all(ai[0][k] - eps <= bj[1][k] and bj[0][k] - eps <= ai[1][k] for k in range(3)):
                    pi, pj = _find(i), _find(j)
                    if pi != pj:
                        parent[pi] = pj

        comps = {}
        for i in range(len(kept)):
            comps.setdefault(_find(i), []).append(i)

        def _vol(i):
            lo, hi = boxes[i]
            return (max(hi[0] - lo[0], 1e-5) * max(hi[1] - lo[1], 1e-5) * max(hi[2] - lo[2], 1e-5))

        main = max(comps, key=lambda r: sum(_vol(i) for i in comps[r]))
        dpts = [o.matrix_world @ Vector(c) for o in dup_meshes for c in o.bound_box]
        dmin = [min(p[k] for p in dpts) for k in range(3)]
        dmax = [max(p[k] for p in dpts) for k in range(3)]
        dropped = []
        for r, idxs in comps.items():
            if r == main:
                continue
            center = [(min(boxes[i][0][k] for i in idxs) + max(boxes[i][1][k] for i in idxs)) / 2
                      for k in range(3)]
            if all(dmin[k] - eps <= center[k] <= dmax[k] + eps for k in range(3)):
                for i in idxs:
                    try:
                        kept[i].select_set(False)
                        dropped.append(kept[i].name)
                    except RuntimeError:
                        pass
        if dropped:
            print('ORPHANS_DROPPED::' + json.dumps(dropped))

# --- Ground snap (--ground-snap) ---------------------------------------------
# Some generated scenes leave props hovering above the terrain (placed for an
# earlier terrain sculpt that was later flattened). Drop each floating root
# object straight down so it rests on the terrain surface. Only ever lowers,
# and only objects whose entire footprint hovers well clear of the ground, so
# correctly placed props and arched bridges are untouched.

if ground_snap:
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    def _xy_footprint(o):
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return ((max(p.x for p in pts) - min(p.x for p in pts))
                * (max(p.y for p in pts) - min(p.y for p in pts)))

    sel_meshes = [o for o in selected if o.type == 'MESH']
    terrain = None
    for o in sel_meshes:
        if re.search(r'terrain|ground|landscape', o.name, re.IGNORECASE):
            if terrain is None or _xy_footprint(o) > _xy_footprint(terrain):
                terrain = o
    if terrain is None and sel_meshes:
        terrain = max(sel_meshes, key=_xy_footprint)

    if terrain is not None:
        deps = bpy.context.evaluated_depsgraph_get()
        t_ev = terrain.evaluated_get(deps)
        t_mesh = t_ev.to_mesh()
        t_mesh.calc_loop_triangles()
        t_verts = [t_ev.matrix_world @ v.co for v in t_mesh.vertices]
        t_tris = [tuple(t.vertices) for t in t_mesh.loop_triangles]
        bvh = BVHTree.FromPolygons(t_verts, t_tris)

        def _terrain_z(x, y):
            hit = bvh.ray_cast(Vector((x, y, 1e6)), Vector((0, 0, -1)))
            return hit[0].z if hit[0] else None

        def _root(o):
            while o.parent is not None:
                o = o.parent
            return o

        terrain_root = _root(terrain)
        roots = {}
        for o in sel_meshes:
            r = _root(o)
            if r is not terrain_root:
                roots.setdefault(r.name, []).append(o)

        snapped = []
        for root_name, meshes in roots.items():
            pts = []
            for o in meshes:
                pts.extend(o.matrix_world @ Vector(c) for c in o.bound_box)
            bottom = min(p.z for p in pts)
            x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
            y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
            heights = []
            n = 5
            for i in range(n):
                for j in range(n):
                    z = _terrain_z(x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * j / (n - 1))
                    if z is not None:
                        heights.append(z)
            if not heights:
                continue  # off the terrain entirely (e.g. hangs past the edge)
            # Airborne only if even the highest ground under the footprint is
            # well below the object; keeps arched bridges and slope overhangs.
            if bottom - max(heights) <= 2.0:
                continue
            center_z = _terrain_z((x0 + x1) / 2, (y0 + y1) / 2)
            target = center_z if center_z is not None else max(heights)
            drop = bottom - target
            root = bpy.data.objects[root_name]
            mw = root.matrix_world.copy()
            mw.translation.z -= drop
            root.matrix_world = mw
            snapped.append({'root': root_name, 'drop': round(drop, 2)})
        if snapped:
            print('GROUND_SNAP::' + json.dumps(snapped))

# --- Per-object colors from Object Info ramps --------------------------------
# "Smart" materials color many objects from one ColorRamp driven by Object
# Info > Random (e.g. 4000 shipping containers in 9 colors). Flattening that
# to one average turns the whole yard beige. Instead, give each user object a
# copy of the material with the ramp sampled at a per-object random value.

def _object_info_ramp(mat):
    if not (mat.use_nodes and mat.node_tree):
        return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return None
    sock = bsdf.inputs['Base Color']
    if not sock.is_linked:
        return None
    ramp = sock.links[0].from_node
    if ramp.type != 'VALTORGB':
        return None
    fac = ramp.inputs['Fac']
    if fac.is_linked and fac.links[0].from_node.type == 'OBJECT_INFO':
        return ramp
    return None


import hashlib

for mat in list(bpy.data.materials):
    ramp = _object_info_ramp(mat)
    if not ramp:
        continue
    users = [o for o in selected if o.type == 'MESH' and o.select_get()
             and mat.name in [m.name for m in o.data.materials if m]]
    if len(users) < 2:
        continue
    variants = {}
    for o in users:
        # Deterministic stand-in for Object Info Random (not bit-exact with
        # Blender's hash, but same distribution across the ramp).
        rnd = int(hashlib.md5(o.name.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
        # Snap to the nearest stop so the palette stays discrete even on
        # interpolating ramps (else ~every object gets a unique material).
        pos = min((e.position for e in ramp.color_ramp.elements), key=lambda p: abs(p - rnd))
        color = tuple(round(c, 4) for c in ramp.color_ramp.evaluate(pos))
        if color not in variants:
            v = mat.copy()
            v.name = f"{mat.name}_v{len(variants)}"
            bsdf = next(n for n in v.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            s = bsdf.inputs['Base Color']
            if s.is_linked:
                v.node_tree.links.remove(s.links[0])
            s.default_value = color
            variants[color] = v
        repl = variants[color]
        for slot in o.material_slots:
            if slot.material and slot.material.name == mat.name:
                # Objects often share mesh data; per-object link keeps each
                # object's own color instead of recoloring all instances.
                slot.link = 'OBJECT'
                slot.material = repl
    print(f'RAMP_SPLIT::{mat.name} -> {len(variants)} colors over {len(users)} objects')

# --- Flatten procedural base colors -----------------------------------------
# The glTF exporter cannot convert procedural node graphs (noise/brick/ramp
# mixes feeding Base Color); it silently drops them and the material renders
# glTF-default white. Replace such links with a representative flat color
# evaluated from the node graph. Image-texture chains are left untouched.

def _has_image(socket, depth=0):
    if depth > 10 or not socket.is_linked:
        return False
    node = socket.links[0].from_node
    if node.type == 'TEX_IMAGE':
        return True
    return any(_has_image(i, depth + 1) for i in node.inputs)


def _luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


_vcol_cache = {}


def _avg_vertex_color(mat):
    """Mean of the active color attribute over meshes using this material."""
    if mat.name in _vcol_cache:
        return _vcol_cache[mat.name]
    acc = [0.0, 0.0, 0.0]
    n = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or mat.name not in [m.name for m in o.data.materials if m]:
            continue
        attr = o.data.color_attributes.active_color if o.data.color_attributes else None
        if not attr:
            continue
        data = attr.data
        stride = max(1, len(data) // 2048)
        for i in range(0, len(data), stride):
            c = data[i].color
            acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n += 1
    result = [a / n for a in acc] if n else None
    _vcol_cache[mat.name] = result
    return result


def _eval_color(socket, mat=None, depth=0):
    """Best-effort flat RGB for a socket the exporter can't bake."""
    if depth > 12:
        return [0.5, 0.5, 0.5]
    if not socket.is_linked:
        v = socket.default_value
        try:
            return [v[0], v[1], v[2]]
        except TypeError:
            return [v, v, v]
    node = socket.links[0].from_node

    if node.type == 'TEX_IMAGE':
        return None
    if node.type == 'RGB':
        return list(node.outputs[0].default_value)[:3]
    if node.type == 'VALTORGB':  # color ramp: average its stops
        els = node.color_ramp.elements
        return [sum(e.color[i] for e in els) / len(els) for i in range(3)]
    if node.type in ('VERTEX_COLOR', 'ATTRIBUTE'):
        return _avg_vertex_color(mat) or [1.0, 1.0, 1.0]

    if node.type in ('MIX', 'MIX_RGB'):
        if node.type == 'MIX':
            fac_sock = node.inputs['Factor']
            rgba = [i for i in node.inputs if i.type == 'RGBA']
            a_sock, b_sock = rgba[0], rgba[1]
        else:
            fac_sock = node.inputs['Fac']
            a_sock, b_sock = node.inputs['Color1'], node.inputs['Color2']
        if fac_sock.is_linked:
            fc = _eval_color(fac_sock, mat, depth + 1)
            f = _luma(fc) if fc else 0.5
        else:
            f = float(fac_sock.default_value)
        a = _eval_color(a_sock, mat, depth + 1) or [0.5, 0.5, 0.5]
        b = _eval_color(b_sock, mat, depth + 1) or [0.5, 0.5, 0.5]
        blend = node.blend_type
        if blend == 'MULTIPLY':
            return [a[i] * (1 - f + f * b[i]) for i in range(3)]
        if blend == 'ADD':
            return [a[i] + f * b[i] for i in range(3)]
        return [a[i] * (1 - f) + b[i] * f for i in range(3)]  # MIX and the rest

    colors = []
    for inp in node.inputs:
        if inp.type == 'RGBA':
            c = _eval_color(inp, mat, depth + 1)
            if c:
                colors.append(c)
    if colors:
        return [sum(c[i] for c in colors) / len(colors) for i in range(3)]
    # grayscale generators (noise/wave/voronoi) with no color inputs
    return [0.5, 0.5, 0.5]


for mat in bpy.data.materials:
    if not mat.use_nodes or not mat.node_tree:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for sock_name in ('Base Color', 'Emission Color'):
        sock = bsdf.inputs[sock_name]
        if sock.is_linked and not _has_image(sock):
            color = _eval_color(sock, mat)
            if color:
                mat.node_tree.links.remove(sock.links[0])
                sock.default_value = (color[0], color[1], color[2], 1.0)
    # Procedural metallic/roughness chains are dropped the same way; unlink so
    # the socket's authored default exports instead of glTF defaults.
    for name in ('Metallic', 'Roughness'):
        s = bsdf.inputs[name]
        if s.is_linked and not _has_image(s):
            mat.node_tree.links.remove(s.links[0])

# Ensure all animated objects push their actions into NLA so the exporter
# picks up every clip (some files keep many object-level actions).
scene = bpy.context.scene

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='SCENE',  # bake the scene timeline into one clip
    export_frame_range=True,
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_apply=True,
    # Geometry-nodes instancers (e.g. dockyard's container/pallet zones)
    # otherwise evaluate to empty meshes and silently vanish from the GLB.
    export_gn_mesh=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_cameras=False,
    export_lights=True,
    export_extras=False,
    export_skins=True,
)

# Report stats for the driver script.
polys = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
n_actions = len(bpy.data.actions)
print('EXPORT_OK::' + json.dumps({
    'out': out_path,
    'polys': polys,
    'actions': n_actions,
    'frames': [scene.frame_start, scene.frame_end],
    'fps': scene.render.fps,
}))
