# Runs inside Blender headless, BEFORE export-blend.py in the same session:
#   blender -b scene.blend -P bake-procedural.py -P export-blend.py -- out.glb
#
# The glTF exporter cannot represent procedural node graphs (noise/brick/
# voronoi ramps feeding Base Color) or MIX_SHADER surfaces; export-blend.py
# flattens those to a single RGB, which strips all texture detail from
# scene-scale surfaces (concrete quays, wood planks, rusted steel) and turns
# emission-masked materials (glowing windows on an otherwise matte wall) into
# uniformly glowing white shells.
#
# This pass bakes such materials to image textures Cycles-side so the GLB
# keeps the authored look:
#   - Principled BSDF with a procedural Base Color chain -> baked base color.
#   - MIX_SHADER of two Principled BSDFs (rust/paint mixes) -> baked combined
#     base color on a single Principled with averaged metallic/roughness.
#   - MIX_SHADER of a Principled/Translucent with an EMISSION shader (glow
#     masks: lantern windows, shoji panels) -> baked base color + baked
#     emissive texture with the mix factor applied, on a single Principled.
#
# Every user mesh gets a jointly-packed "BakeUV" layer (Smart UV Project over
# all users of a material at once, so they share one atlas per material).
# Baking uses EMIT passes with the color chain routed into a temporary
# Emission shader: exact, light-independent, and fine at 1 sample.
#
# Image-textured and flat materials are left untouched, so this is safe to
# chain in front of export-blend.py: its flatten pass skips anything that now
# has an image in the chain.
import os
import re
import sys
from math import radians

import bpy

EMISSIVE_STRENGTH_MAX = 3.0  # three.js + ACES clips hot emissives to white
# Above this many polygons across a material's users, per-face UV islands go
# sub-texel and the bake atlas degenerates into noise; convert those materials
# to a flat single Principled instead (export-blend.py averages the chains).
MAX_BAKE_POLYS = 150_000
FALLBACK_EMISSIVE_STRENGTH = 0.4
SCRATCH_NAME = '__bake_scratch'
BAKE_NODE = '__bake_target'
BAKE_UV = 'BakeUV'

blend_slug = re.sub(r'\W+', '-', os.path.splitext(os.path.basename(bpy.data.filepath))[0])
TEX_DIR = os.path.join('/tmp/matfix/baketex', blend_slug)
os.makedirs(TEX_DIR, exist_ok=True)

scene = bpy.context.scene
view_layer = bpy.context.view_layer


def _surface(mat):
    if not (mat.use_nodes and mat.node_tree):
        return None, None
    out = next((n for n in mat.node_tree.nodes
                if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    if not out or not out.inputs['Surface'].is_linked:
        return out, None
    return out, out.inputs['Surface'].links[0].from_node


def _has_image(socket, depth=0):
    if depth > 12 or not socket.is_linked:
        return False
    node = socket.links[0].from_node
    if node.type == 'TEX_IMAGE':
        return True
    return any(_has_image(i, depth + 1) for i in node.inputs)


def _color_source(shader):
    """The socket feeding a shader's color: Base Color / Color."""
    for name in ('Base Color', 'Color'):
        if name in shader.inputs:
            return shader.inputs[name]
    return None


def classify(mat):
    """-> ('base', bsdf) | ('mix2', mix, a, b) | ('emis', mix, other, emission) | None"""
    _, surf = _surface(mat)
    if surf is None:
        return None
    if surf.type == 'BSDF_PRINCIPLED':
        sock = surf.inputs['Base Color']
        if sock.is_linked and not _has_image(sock):
            return ('base', surf)
        return None
    if surf.type == 'MIX_SHADER':
        subs = []
        for i in surf.inputs:
            if i.type == 'SHADER':
                subs.append(i.links[0].from_node if i.is_linked else None)
        if len(subs) != 2 or None in subs:
            return None
        a, b = subs
        types = {a.type, b.type}
        if types == {'BSDF_PRINCIPLED'}:
            return ('mix2', surf, a, b)
        if 'EMISSION' in types and types & {'BSDF_PRINCIPLED', 'BSDF_TRANSLUCENT'}:
            emis = a if a.type == 'EMISSION' else b
            other = b if a.type == 'EMISSION' else a
            return ('emis', surf, other, emis)
    return None


def _fac_socket(mix_node):
    return mix_node.inputs['Fac']


def eligible_users(mat):
    users = []
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.hide_render:
            continue
        if mat.name not in [m.name for m in o.data.materials if m]:
            continue
        if len(o.data.polygons) == 0:
            continue
        users.append(o)
    return users


def _val(socket, fallback=0.5):
    try:
        return float(socket.default_value)
    except (TypeError, AttributeError):
        return fallback


# --- workspace: make sure every user is reachable (view layer + visible) ----
temp_linked = []
hidden_restore = []


viewport_restore = []


def ensure_reachable(obj):
    if obj.name not in view_layer.objects:
        scene.collection.objects.link(obj)
        temp_linked.append(obj)
        view_layer.update()
    if obj.hide_viewport:  # disabled-in-viewport objects can't be selected/baked
        obj.hide_viewport = False
        viewport_restore.append(obj)
    if obj.hide_get():
        obj.hide_set(False)
        hidden_restore.append(obj)


# --- collect targets ---------------------------------------------------------
targets = []
for mat in bpy.data.materials:
    kind = classify(mat)
    if not kind:
        continue
    users = eligible_users(mat)
    if not users:
        continue
    targets.append((mat, kind, users))

if targets:
    print(f'BAKE:: {len(targets)} materials to bake: '
          + ', '.join(m.name for m, _, _ in targets))

    # View-layer collections hidden in the viewport (eye icon) make their
    # objects unselectable, which breaks edit-mode unwrap and baking even
    # though they still render/export. Unhide for the duration of the bake.
    lc_restore = []

    def _unhide_layer_collections(lc):
        if lc.hide_viewport:
            lc.hide_viewport = False
            lc_restore.append(lc)
        for c in lc.children:
            _unhide_layer_collections(c)

    _unhide_layer_collections(view_layer.layer_collection)

    prev_engine = scene.render.engine
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False

    scratch_img = bpy.data.images.new(SCRATCH_NAME, 64, 64, alpha=False)
    scratch_nodes = []  # (node_tree, node)

    def ensure_scratch_active(mat):
        nt = mat.node_tree
        if not nt:
            return
        node = nt.nodes.get(SCRATCH_NAME)
        if node is None:
            node = nt.nodes.new('ShaderNodeTexImage')
            node.name = SCRATCH_NAME
            node.image = scratch_img
            scratch_nodes.append((nt, node))
        nt.nodes.active = node

    def image_size(users):
        area = 0.0
        for o in users:
            d = sorted(o.dimensions, reverse=True)
            area += d[0] * d[1]
        return 1024 if area > 400 else 512

    def unwrap(users):
        """Joint Smart UV Project of all users into one atlas (BakeUV)."""
        done_meshes = set()
        for o in users:
            if o.data.name in done_meshes:
                continue
            done_meshes.add(o.data.name)
            uv = o.data.uv_layers.get(BAKE_UV) or o.data.uv_layers.new(name=BAKE_UV)
            if uv is None:  # 8-layer limit: reuse whatever is active
                continue
            o.data.uv_layers.active = uv
        bpy.ops.object.select_all(action='DESELECT')
        for o in users:
            o.select_set(True)
        view_layer.objects.active = users[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.01)
        bpy.ops.object.mode_set(mode='OBJECT')

    def new_bake_image(name, size):
        img = bpy.data.images.new(name, size, size, alpha=False)
        img.filepath_raw = os.path.join(TEX_DIR, f'{name}.png')
        img.file_format = 'PNG'
        return img

    def bake_users(mat, users, bake_node):
        """EMIT-bake each user in isolation (everything else hidden: EMIT
        needs no lights/bounce geometry and tiny depsgraphs keep it fast)."""
        mat.node_tree.nodes.active = bake_node
        vis = {o.name: o.hide_render for o in bpy.data.objects}
        try:
            for o in bpy.data.objects:
                o.hide_render = True
            for o in users:
                o.hide_render = False
                for slot in o.material_slots:
                    m = slot.material
                    if m and m.name != mat.name:
                        ensure_scratch_active(m)
                bpy.ops.object.select_all(action='DESELECT')
                o.select_set(True)
                view_layer.objects.active = o
                try:
                    bpy.ops.object.bake(type='EMIT', use_clear=False, margin=4)
                except RuntimeError as e:
                    print(f'BAKE_SKIP:: {mat.name} / {o.name}: {e}')
                o.hide_render = True
        finally:
            for o in bpy.data.objects:
                if o.name in vis:
                    o.hide_render = vis[o.name]

    def link_or_set(nt, dst_socket, src_socket):
        """Feed dst from src's link if linked, else copy the value."""
        if src_socket.is_linked:
            nt.links.new(src_socket.links[0].from_socket, dst_socket)
        else:
            v = src_socket.default_value
            try:
                dst_socket.default_value = (v[0], v[1], v[2], 1.0)
            except TypeError:
                dst_socket.default_value = (v, v, v, 1.0)

    for mat, kind, users in targets:
        nt = mat.node_tree
        out, surf = _surface(mat)
        orig_from = out.inputs['Surface'].links[0].from_socket

        mesh_users = [o for o in users]
        total_polys = sum(len(o.data.polygons) for o in mesh_users)
        if total_polys > MAX_BAKE_POLYS:
            # Flat fallback: rebuild as a single Principled whose (still
            # procedural) color chains export-blend.py's flatten pass will
            # average. Keeps hi-poly organic meshes (e.g. 160k-poly stone
            # lanterns) from getting a useless sub-texel atlas.
            if kind[0] != 'base':
                final = nt.nodes.new('ShaderNodeBsdfPrincipled')
                if kind[0] == 'mix2':
                    _, _, a, b = kind
                    link_or_set(nt, final.inputs['Base Color'], _color_source(a))
                    final.inputs['Metallic'].default_value = 0.5 * (
                        _val(a.inputs['Metallic']) + _val(b.inputs['Metallic']))
                    final.inputs['Roughness'].default_value = 0.5 * (
                        _val(a.inputs['Roughness']) + _val(b.inputs['Roughness']))
                else:
                    _, _, other, emis_node = kind
                    link_or_set(nt, final.inputs['Base Color'], _color_source(other))
                    link_or_set(nt, final.inputs['Emission Color'],
                                emis_node.inputs['Color'])
                    final.inputs['Emission Strength'].default_value = min(
                        _val(emis_node.inputs['Strength'], 1.0),
                        FALLBACK_EMISSIVE_STRENGTH)
                nt.links.new(final.outputs['BSDF'], out.inputs['Surface'])
            print(f'BAKE_FLAT:: {mat.name} ({kind[0]}, {total_polys} polys)')
            continue
        for o in mesh_users:
            ensure_reachable(o)
        # Curve objects using this material export via to_mesh without our
        # BakeUV; give them a flat-color copy that export-blend.py's flatten
        # pass (or the mix replacement below) can handle.
        for o in bpy.data.objects:
            if o.type == 'CURVE' and not o.hide_render:
                for slot in o.material_slots:
                    if slot.material and slot.material.name == mat.name:
                        flat = bpy.data.materials.get(mat.name + '_curveflat')
                        if flat is None:
                            flat = mat.copy()
                            flat.name = mat.name + '_curveflat'
                        slot.material = flat

        size = image_size(mesh_users)
        unwrap(mesh_users)

        img_col = new_bake_image(f'{blend_slug}_{mat.name}_col', size)
        uvnode = nt.nodes.new('ShaderNodeUVMap')
        uvnode.uv_map = BAKE_UV
        bake_node = nt.nodes.new('ShaderNodeTexImage')
        bake_node.name = BAKE_NODE
        bake_node.image = img_col
        nt.links.new(uvnode.outputs['UV'], bake_node.inputs['Vector'])

        emit = nt.nodes.new('ShaderNodeEmission')
        temp_nodes = [emit]

        if kind[0] == 'base':
            bsdf = kind[1]
            nt.links.new(bsdf.inputs['Base Color'].links[0].from_socket,
                         emit.inputs['Color'])
        else:
            mix = kind[1]
            mixrgb = nt.nodes.new('ShaderNodeMixRGB')
            temp_nodes.append(mixrgb)
            fac = _fac_socket(mix)
            if fac.is_linked:
                nt.links.new(fac.links[0].from_socket, mixrgb.inputs['Fac'])
            else:
                mixrgb.inputs['Fac'].default_value = float(fac.default_value)
            if kind[0] == 'mix2':
                _, _, a, b = kind
                link_or_set(nt, mixrgb.inputs['Color1'], _color_source(a))
                link_or_set(nt, mixrgb.inputs['Color2'], _color_source(b))
            else:  # emis: base pass uses the non-emission shader's color only
                _, _, other, emis_node = kind
                src = _color_source(other)
                link_or_set(nt, mixrgb.inputs['Color1'], src)
                link_or_set(nt, mixrgb.inputs['Color2'], src)
            nt.links.new(mixrgb.outputs['Color'], emit.inputs['Color'])

        nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
        bake_users(mat, mesh_users, bake_node)
        img_col.save()

        img_emit = None
        if kind[0] == 'emis':
            _, mix, other, emis_node = kind
            img_emit = new_bake_image(f'{blend_slug}_{mat.name}_emit', size)
            emit_bake_node = nt.nodes.new('ShaderNodeTexImage')
            emit_bake_node.name = BAKE_NODE + '_emit'
            emit_bake_node.image = img_emit
            nt.links.new(uvnode.outputs['UV'], emit_bake_node.inputs['Vector'])
            # emissive contribution = mix fac masking the emission color
            mask = nt.nodes.new('ShaderNodeMixRGB')
            temp_nodes.append(mask)
            fac = _fac_socket(mix)
            # fac=1 selects the SECOND shader input; invert mask if emission
            # sits in the first slot.
            emis_is_second = mix.inputs[2].is_linked and mix.inputs[2].links[0].from_node == emis_node
            if fac.is_linked:
                nt.links.new(fac.links[0].from_socket, mask.inputs['Fac'])
            else:
                mask.inputs['Fac'].default_value = float(fac.default_value)
            dark = (0.0, 0.0, 0.0, 1.0)
            if emis_is_second:
                mask.inputs['Color1'].default_value = dark
                link_or_set(nt, mask.inputs['Color2'], emis_node.inputs['Color'])
            else:
                link_or_set(nt, mask.inputs['Color1'], emis_node.inputs['Color'])
                mask.inputs['Color2'].default_value = dark
            nt.links.new(mask.outputs['Color'], emit.inputs['Color'])
            bake_users(mat, mesh_users, emit_bake_node)
            img_emit.save()

        # --- final graph: single Principled sampling the baked textures -----
        for n in temp_nodes:
            nt.nodes.remove(n)
        if kind[0] == 'base':
            bsdf = kind[1]
            for l in list(bsdf.inputs['Base Color'].links):
                nt.links.remove(l)
            nt.links.new(bake_node.outputs['Color'], bsdf.inputs['Base Color'])
            nt.links.new(orig_from, out.inputs['Surface'])
        else:
            final = nt.nodes.new('ShaderNodeBsdfPrincipled')
            nt.links.new(bake_node.outputs['Color'], final.inputs['Base Color'])
            if kind[0] == 'mix2':
                _, _, a, b = kind
                final.inputs['Metallic'].default_value = 0.5 * (
                    _val(a.inputs['Metallic']) + _val(b.inputs['Metallic']))
                final.inputs['Roughness'].default_value = 0.5 * (
                    _val(a.inputs['Roughness']) + _val(b.inputs['Roughness']))
            else:
                _, _, other, emis_node = kind
                if other.type == 'BSDF_PRINCIPLED':
                    final.inputs['Metallic'].default_value = _val(other.inputs['Metallic'], 0.0)
                    final.inputs['Roughness'].default_value = _val(other.inputs['Roughness'])
                else:  # translucent paper
                    final.inputs['Metallic'].default_value = 0.0
                    final.inputs['Roughness'].default_value = 0.6
                strength = min(_val(emis_node.inputs['Strength'], 1.0),
                               EMISSIVE_STRENGTH_MAX)
                emit_node = nt.nodes.get(BAKE_NODE + '_emit')
                nt.links.new(emit_node.outputs['Color'],
                             final.inputs['Emission Color'])
                final.inputs['Emission Strength'].default_value = strength
            nt.links.new(final.outputs['BSDF'], out.inputs['Surface'])
        print(f'BAKED:: {mat.name} ({kind[0]}, {len(mesh_users)} users, '
              f'{size}px{", +emissive" if img_emit else ""})')

    # cleanup: scratch nodes/image out of every tree so the exporter never
    # sees them.
    for nt, node in scratch_nodes:
        nt.nodes.remove(node)
    bpy.data.images.remove(scratch_img)
    scene.render.engine = prev_engine
    for lc in lc_restore:
        lc.hide_viewport = True

# restore workspace changes that would leak into the export
for o in viewport_restore:
    o.hide_viewport = True
for o in hidden_restore:
    o.hide_set(True)
for o in temp_linked:
    scene.collection.objects.unlink(o)
print('BAKE_DONE::')
