"""SG90 servo-specific retiming followed by the shared glTF exporter.

The source demo_assembly clip runs 380 frames (~16s): parts start EXPLODED,
assemble sequentially over frames 1-260, then the horn sweeps (266-370).
Retime it into a ~12s story that starts and ends ASSEMBLED and moves ONE
PART AT A TIME (staggered cascade, slight overlap):

    1-12    hold assembled
    12-87   explode, one part after another in reverse assembly order
            (horn screw first ... dc motor last); each part travels 10
            frames (~0.42s), a new part leaves every 5 frames
    87-135  hold exploded (48 frames = 2s)
    135-210 reassemble in the source's true assembly order (dc motor →
            potentiometer → pcb → pinion → gears in mesh order → output
            gear → top cover → bottom cap → case screws → horn → horn
            screw), same 10-frame moves staggered every 5 frames
    210-220 settle assembled
    220-288 horn sweep (gear train follows via the existing drivers)

Usage (via tools/export-fable-assets.mjs):
  blender -b sg90_servo.blend -P tools/export-sg90-fable.py -- \
    /tmp/blend-glb/fable/towerpro-sg90-servo.glb --object --bake-animation

The opened source file is changed in memory only; the shared exporter then
bakes the driver motion (with quaternion hemisphere continuity) and writes
the GLB.
"""

import json
import os
import runpy

import bpy  # pylint: disable=import-error

FPS = 24
HOLD_START = 12       # opening assembled hold
PART_MOVE = 10        # frames each part travels (~0.42s)
STAGGER_STEP = 5      # frames between consecutive part departures
HOLD_EXPLODED = 48    # 2s fully-exploded hold
SETTLE = 10           # assembled beat before the horn sweep

# Assembly order as authored in the source (demo_assembly_* strips end at
# 30/48/66/.../260); derived from the strips below and asserted against this.
EXPECTED_ASSEMBLY_ORDER = [
    'dc_motor', 'potentiometer', 'pcb', 'motor_pinion',
    'gear_1', 'gear_2', 'gear_3', 'output_gear',
    'top_cover', 'bottom_cap', 'case_screw_1', 'case_screw_2',
    'servo_horn', 'horn_screw',
]

SWEEP_PATH = '["output_shaft_rotate_deg"]'
EXPECTED_SWEEP_SOURCE = [(266.0, 0.0), (296.0, -90.0), (346.0, 90.0), (370.0, 0.0)]

scene = bpy.context.scene
if scene.render.fps != FPS:
    raise RuntimeError(f'Expected {FPS} fps source scene, found {scene.render.fps}')


def ease_keys(keyed_action):
    for fcurve in keyed_action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = 'BEZIER'
            point.handle_left_type = 'AUTO_CLAMPED'
            point.handle_right_type = 'AUTO_CLAMPED'
        fcurve.update()


# Collect the authored assembly strips: one muted NLA strip per exploding part
# plus the horn-sweep control strip on middle_body. Each part's source action
# ends when it finishes seating, which encodes the authored assembly order.
part_poses = {}
part_source_end = {}
sweep_owner = None
for obj in bpy.data.objects:
    animation_data = obj.animation_data
    if not animation_data:
        continue
    strips = [s for track in animation_data.nla_tracks for s in track.strips]
    if not strips:
        continue
    if len(strips) != 1:
        raise RuntimeError(f'Expected one NLA strip on {obj.name}, found {len(strips)}')
    action = strips[0].action

    if obj.name == 'middle_body':
        curves = [fc for fc in action.fcurves if fc.data_path == SWEEP_PATH]
        if len(action.fcurves) != 1 or len(curves) != 1:
            raise RuntimeError(f'Unexpected horn-sweep action layout on {obj.name}')
        source_keys = [(p.co.x, p.co.y) for p in curves[0].keyframe_points]
        if source_keys != EXPECTED_SWEEP_SOURCE:
            raise RuntimeError(f'Unexpected horn-sweep source keys: {source_keys}')
        sweep_owner = obj
        continue

    if action.name != f'demo_assembly_{obj.name}':
        raise RuntimeError(f'Unexpected strip action {action.name} on {obj.name}')
    exploded = [None, None, None]
    assembled = [None, None, None]
    for curve in action.fcurves:
        if curve.data_path != 'location':
            raise RuntimeError(f'Non-location channel {curve.data_path} on {obj.name}')
        exploded[curve.array_index] = curve.evaluate(action.frame_range[0])
        assembled[curve.array_index] = curve.evaluate(action.frame_range[1])
    if None in exploded or None in assembled:
        raise RuntimeError(f'Missing location channels on {obj.name}')
    # The file's rest pose is assembled (rest_state custom prop); the new clip
    # must start and end exactly there.
    for axis in range(3):
        if abs(obj.location[axis] - assembled[axis]) > 1e-6:
            raise RuntimeError(
                f'{obj.name} rest pose diverges from its assembled key on axis {axis}'
            )
    if max(abs(exploded[i] - assembled[i]) for i in range(3)) < 1e-6:
        raise RuntimeError(f'{obj.name} has no exploded offset')
    part_poses[obj.name] = (obj, {'a': assembled, 'x': exploded})
    part_source_end[obj.name] = action.frame_range[1]

if sweep_owner is None:
    raise RuntimeError('Missing horn-sweep strip on middle_body')
if len(part_poses) != 14:
    raise RuntimeError(f'Expected 14 exploding parts, found {len(part_poses)}')

assembly_order = sorted(part_poses, key=lambda n: part_source_end[n])
if assembly_order != EXPECTED_ASSEMBLY_ORDER:
    raise RuntimeError(f'Unexpected source assembly order: {assembly_order}')

# Staggered schedule. Disassembly runs in reverse assembly order (horn screw
# leaves first), reassembly in true assembly order (dc motor seats first).
n_parts = len(assembly_order)
explode_start = 1 + HOLD_START
explode_end = explode_start + (n_parts - 1) * STAGGER_STEP + PART_MOVE
reassemble_start = explode_end + HOLD_EXPLODED
reassemble_end = reassemble_start + (n_parts - 1) * STAGGER_STEP + PART_MOVE
sweep_start = reassemble_end + SETTLE
SWEEP_KEYS = (
    (1, 0.0),
    (sweep_start, 0.0),
    (sweep_start + 22, -60.0),
    (sweep_start + 48, 60.0),
    (sweep_start + 68, 0.0),
)
FRAME_END = sweep_start + 68

schedule = {}
for rank, name in enumerate(assembly_order):
    out_at = explode_start + (n_parts - 1 - rank) * STAGGER_STEP
    in_at = reassemble_start + rank * STAGGER_STEP
    schedule[name] = (
        (1, 'a'),
        (out_at, 'a'),
        (out_at + PART_MOVE, 'x'),
        (in_at, 'x'),
        (in_at + PART_MOVE, 'a'),
        (FRAME_END, 'a'),
    )

# Replace each part's assembly strip with its retimed explode/hold/reassemble
# clip. keyframe_insert (rather than hand-built actions) keeps Blender 4.x
# action slots consistent.
for name, (obj, poses) in part_poses.items():
    obj.animation_data_clear()
    for frame, pose in schedule[name]:
        obj.location = poses[pose]
        obj.keyframe_insert(data_path='location', frame=frame, group='sg90_retime')
    ease_keys(obj.animation_data.action)

# Author the end-of-clip horn sweep on the same control property the gear
# drivers read, so the whole train spins at its real ratios during the sweep.
sweep_owner.animation_data_clear()
for frame, value in SWEEP_KEYS:
    sweep_owner[SWEEP_PATH[2:-2]] = value
    sweep_owner.keyframe_insert(data_path=SWEEP_PATH, frame=frame)
ease_keys(sweep_owner.animation_data.action)

scene.frame_start = 1
scene.frame_end = FRAME_END
scene.frame_set(1)

print(
    'SG90_RETIMED::'
    + json.dumps(
        {
            'assembly_order': assembly_order,
            'schedule': {
                name: [[f, p] for f, p in frames] for name, frames in schedule.items()
            },
            'sweep_keys': SWEEP_KEYS,
            'frames': [scene.frame_start, scene.frame_end],
            'seconds': round(FRAME_END / FPS, 2),
        }
    )
)

# Continue in the same unsaved Blender session. The source .blend remains
# untouched while the shared exporter bakes drivers and writes the GLB.
runpy.run_path(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'export-blend.py'),
    run_name='__main__',
)
