# Pre-export fixes for the robotic-arm-assembly-cell scene. Run before
# bake-procedural.py / export-blend.py:
#   blender -b scene.blend -P fix-robotic-arm.py -P bake-procedural.py \
#       -P export-blend.py -- out.glb
import bpy

# Two materials drive Base Color from Object Info > Color (per-object tint):
# plastic_bin_object_color (red/green/blue/yellow part bins) and
# reach_and_clearance_object_color (red interlock dashes, reach arcs).
# export-blend.py's flatten pass can't evaluate OBJECT_INFO and averages both
# to mid-gray, so every bin and floor dash shipped gray. Split them into flat
# per-color variants (same approach as the exporter's ColorRamp ramp-split).
for mat in list(bpy.data.materials):
    if not (mat.use_nodes and mat.node_tree):
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    sock = bsdf.inputs['Base Color']
    if not sock.is_linked:
        continue
    link = sock.links[0]
    if link.from_node.type != 'OBJECT_INFO' or link.from_socket.name != 'Color':
        continue
    users = [o for o in bpy.data.objects if o.type == 'MESH'
             and mat.name in [m.name for m in o.data.materials if m]]
    variants = {}
    for o in users:
        color = tuple(round(c, 4) for c in o.color[:3])
        if color not in variants:
            v = mat.copy()
            v.name = f'{mat.name}_c{len(variants)}'
            vb = next(n for n in v.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            s = vb.inputs['Base Color']
            if s.is_linked:
                v.node_tree.links.remove(s.links[0])
            s.default_value = (color[0], color[1], color[2], 1.0)
            variants[color] = v
        # Objects share mesh data (_src_* instances); object-level slot links
        # keep each object's own tint instead of recoloring all instances.
        for slot in o.material_slots:
            if slot.material and slot.material.name == mat.name:
                slot.link = 'OBJECT'
                slot.material = variants[color]
    print(f'OBJCOLOR_SPLIT::{mat.name} -> {len(variants)} colors over {len(users)} objects')

# 8 of the 11 lamps are AREA lights (6 ceiling LED fixtures, the skylight and
# an ambient fill). KHR_lights_punctual has no area type, so the glTF exporter
# silently drops them and the web viewer got only sun + 2 accent spots.
# Convert them to wide soft spots (area lamps emit from their -Z face, which
# the object transform already encodes) so the ceiling-light character
# survives; the viewer normalizes overall intensity, ratios are what matter.
from math import radians

for o in bpy.data.objects:
    if o.type == 'LIGHT' and o.data.type == 'AREA':
        area = o.data
        spot = bpy.data.lights.new(area.name + '_spot', type='SPOT')
        spot.energy = area.energy
        spot.color = area.color
        spot.spot_size = radians(150)
        spot.spot_blend = 0.9
        o.data = spot
        print(f'AREA2SPOT::{o.name} ({area.energy}W)')
