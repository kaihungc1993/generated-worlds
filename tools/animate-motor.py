# Runs inside Blender headless. Authors the motor-assembly open + exploded-view
# animation and saves to a temp copy (the source .blend is never modified).
#
# The blend's generator (main.py) builds flipping_lid_visual with its origin on
# the hinge axis and documents that lid_open_angle is a local-X rotation on top
# of the authored (0, 0, -90deg) euler, so the lid animates by keying
# rotation_euler.x alone. The coil / washer / rotor are coaxial on world Z and
# explode by translating up with slight lateral separation.
#
# blender -b motor_assembly_asset.blend -P tools/animate-motor.py -- /tmp/out.blend
import math
import sys

import bpy

out_blend = sys.argv[sys.argv.index('--') + 1]

FPS = 24
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = 120  # ~5 s; site plays it ping-pong so it reassembles


def key(obj, path, frame):
    obj.keyframe_insert(data_path=path, frame=frame)


def smooth(obj):
    """Ease-in-out on every authored curve (auto-clamped bezier holds flat
    at the extremes, so moves settle into their hold instead of overshooting)."""
    for fc in obj.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'


# --- Beat 1 (frames 1-37, 0-1.5 s): lid flips open about its hinge ----------
lid = bpy.data.objects['flipping_lid_visual']
lid.rotation_euler.x = 0.0
key(lid, 'rotation_euler', 1)
lid.rotation_euler.x = math.radians(105.0)
key(lid, 'rotation_euler', 37)
smooth(lid)

# --- Beat 2 (frames 37-100, 1.5-4.2 s): staggered exploded view -------------
# (start frame, end frame, world-space offset at full explode, extra spin)
# The open lid stands up on the -X side, so lateral separation leans +X.
EXPLODE = {
    'copper_coil_ring_visual': (37, 85, (0.12, 0.0, 0.85), None),
    'washer_spacer_disk_visual': (43, 91, (0.0, 0.0, 1.85), None),
    'rotor_assembly_visual': (49, 100, (0.0, 0.0, 2.85), math.radians(80.0)),
}

for name, (f0, f1, (dx, dy, dz), spin) in EXPLODE.items():
    o = bpy.data.objects[name]
    base = o.location.copy()
    o.location = base
    key(o, 'location', f0)
    o.location = (base.x + dx, base.y + dy, base.z + dz)
    key(o, 'location', f1)
    if spin is not None:
        rz = o.rotation_euler.z
        o.rotation_euler.z = rz
        key(o, 'rotation_euler', f0)
        o.rotation_euler.z = spin
        key(o, 'rotation_euler', f1)
    smooth(o)

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print('ANIMATE_OK::' + out_blend)
