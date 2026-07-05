# Runs inside Blender headless. Retimes the dishwasher open/close animation in
# a temp copy (the source .blend is never modified), then the copy is exported
# with tools/export-blend.py like any other articulated asset.
#
# Two defects in the authored clip made rack/track wires pierce the door in
# the exported GLB:
#  1. Both racks slide out WHILE the door is still swinging open (racks keyed
#     from frames 48/58, door swings 48-88), so the rack tines sweep through
#     the door panel. Retimed to be strictly sequential: door swings 30-62,
#     racks slide 64/68-100. Clip length (100 frames) and key values are
#     unchanged, and since the site plays it ping-pong, the mirrored close
#     pass is clean too (racks retract fully before the door starts closing).
#  2. The open_only_* helpers (door-to-tub bridge rails, rack track stops,
#     damper rods, link pivots) are keyed hidden until the door is open via
#     hide_viewport/hide_render — glTF has no visibility animation, so the
#     export showed them permanently, floating mid-air / piercing the door
#     mid-swing. Replace the visibility keys with scale 0 -> 1 keys (which
#     glTF does support) popping them in once the door lands fully open.
#  3. CURVE objects parented to the animated empties (the inner-door stamped
#     ribs, rack wire baskets, telescoping rails) export as extra "GN
#     Instance" nodes whose animation the exporter bakes in world space ON
#     TOP of the parent chain's animation — double-transformed wires sweep
#     out through the door panel mid-swing. Converting every curve to a
#     plain mesh keeps the geometry rigidly on its parent and no GN Instance
#     nodes are emitted.
#
# blender -b dishwasher.blend -P tools/retime-dishwasher.py -- /tmp/out.blend
import sys

import bpy

out_blend = sys.argv[sys.argv.index('--') + 1]

# object name -> {fcurve data_path: {old key frame: new key frame}}
RETIME = {
    'door_hinge_pivot_BOTTOM_AXIS_openable_origin': {
        'rotation_euler': {48.0: 30.0, 88.0: 62.0},
    },
    'lower_rack_slider_EMPTY_linear_drawer_motion': {
        'location': {48.0: 64.0},
    },
    'upper_rack_slider_EMPTY_linear_drawer_motion': {
        'location': {58.0: 68.0},
    },
}

for name, paths in RETIME.items():
    obj = bpy.data.objects[name]
    for fc in obj.animation_data.action.fcurves:
        mapping = paths.get(fc.data_path)
        if not mapping:
            continue
        for kp in fc.keyframe_points:
            if kp.co.x in mapping:
                shift = mapping[kp.co.x] - kp.co.x
                kp.co.x += shift
                kp.handle_left.x += shift
                kp.handle_right.x += shift
        fc.update()

# open_only_* visibility keys -> scale keys. The door lands at frame 62; pop
# the helpers in right after, matching the original intent (they appeared at
# frames 70/74 when the door finished at 88).
APPEAR = 64.0
for obj in bpy.data.objects:
    ad = obj.animation_data
    if not (ad and ad.action):
        continue
    vis_curves = [fc for fc in ad.action.fcurves
                  if fc.data_path in ('hide_viewport', 'hide_render')]
    if not vis_curves:
        continue
    for fc in vis_curves:
        ad.action.fcurves.remove(fc)
    obj.hide_viewport = False
    obj.hide_render = False
    obj.scale = (0.0, 0.0, 0.0)
    obj.keyframe_insert(data_path='scale', frame=1)
    obj.keyframe_insert(data_path='scale', frame=APPEAR - 1)
    obj.scale = (1.0, 1.0, 1.0)
    obj.keyframe_insert(data_path='scale', frame=APPEAR)
    for fc in ad.action.fcurves:
        if fc.data_path == 'scale':
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT'
            fc.update()

# Curve -> mesh conversion (defect 3). Object-level animation/parenting is
# preserved by convert(); only the data block changes, so the exporter stops
# emitting separately-animated GN Instance duplicates.
curves = [o for o in bpy.data.objects if o.type == 'CURVE']
for o in bpy.data.objects:
    o.select_set(o in curves)
if curves:
    bpy.context.view_layer.objects.active = curves[0]
    bpy.ops.object.convert(target='MESH')

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print('RETIME_OK::' + out_blend)
