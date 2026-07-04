# Runs inside Blender headless. Retimes the dishwasher open/close animation in
# a temp copy (the source .blend is never modified), then the copy is exported
# with tools/export-blend.py like any other articulated asset.
#
# The authored clip slides both racks out WHILE the door is still swinging
# open (racks keyed from frames 48/58, door swings 48-88), so the rack tines
# sweep through the door panel. Retime so motion is strictly sequential:
# door swings 30-62, racks slide 64/68-100. The clip length (100 frames) and
# key values are unchanged, and since the site plays it ping-pong, the
# mirrored close pass is clean too (racks retract fully before the door
# starts closing).
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

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print('RETIME_OK::' + out_blend)
