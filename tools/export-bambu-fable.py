# Bambu Lab P1S-specific, non-destructive export preprocessing.
#
# Usage:
#   blender -b /path/to/bambu_p1s_combo.blend \
#     -P tools/export-bambu-fable.py -- /tmp/blend-glb/fable/bambu-lab-p1s-combo.glb \
#     --object --bake-animation
#
# The opened source file is changed in memory only. The shared exporter then
# bakes the resulting driver motion and writes the GLB.
import json
import math
import re
from pathlib import Path

import bpy


ACTION_NAME = 'demo_articulation'
DOOR_PATH = '["front_door_hinge_deg"]'
EXPECTED_KEYS = [
    (1.0, 0.0),
    (8.0, 0.0),
    (34.0, 120.0),
    (58.0, 0.0),
    (280.0, 0.0),
]
RETIMED_KEYS = [
    (1.0, 0.0),
    (30.0, 0.0),
    (56.0, 120.0),
    (250.0, 120.0),
    (276.0, 0.0),
    (280.0, 0.0),
]


# The branding decals ("Bambu Lab" wordmarks on the door frame, AMS lid, and
# side panel, plus the bed labels) are FONT objects. The shared exporter's
# preprocessing (exec'd below) excludes FONT wholesale, which silently
# dropped the branding from the shipped GLB. Convert them to meshes first —
# same pattern as export-workbench-power.py. In-memory only; never saved.
converted_fonts = []
for obj in list(bpy.data.objects):
    if obj.type != 'FONT':
        continue
    bpy.ops.object.select_all(action='DESELECT')
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    converted_fonts.append(obj.name)
print('BAMBU_FONTS_CONVERTED::' + json.dumps(sorted(converted_fonts)))

action = bpy.data.actions.get(ACTION_NAME)
if action is None:
    raise RuntimeError(f'Missing required action: {ACTION_NAME}')

matches = [
    curve for curve in action.fcurves
    if curve.data_path == DOOR_PATH and curve.array_index == 0
]
if len(matches) != 1:
    raise RuntimeError(
        f'Expected one {DOOR_PATH} F-curve in {ACTION_NAME}, found {len(matches)}'
    )

curve = matches[0]
actual_keys = [(point.co.x, point.co.y) for point in curve.keyframe_points]
if actual_keys != EXPECTED_KEYS:
    raise RuntimeError(
        f'Unexpected source door keys: {actual_keys}; expected {EXPECTED_KEYS}'
    )

curve.keyframe_points.clear()
for frame, value in RETIMED_KEYS:
    point = curve.keyframe_points.insert(frame, value, options={'FAST'})
    point.interpolation = 'BEZIER'
    point.handle_left_type = 'AUTO_CLAMPED'
    point.handle_right_type = 'AUTO_CLAMPED'
curve.update()

print('BAMBU_DOOR_RETIMED::' + json.dumps({
    'action': ACTION_NAME,
    'data_path': DOOR_PATH,
    'before': EXPECTED_KEYS,
    'after': RETIMED_KEYS,
}))

# Materialize the custom-property drivers as ordinary transform actions before
# the shared export pass. This is Bambu-specific because its muted NLA control
# action otherwise cannot be evaluated reliably in Blender background mode.
scene = bpy.context.scene
bake_frames = list(range(scene.frame_start, scene.frame_end + 1, 4))
if bake_frames[-1] != scene.frame_end:
    bake_frames.append(scene.frame_end)

custom_prop = re.compile(r'^\["(.+)"\]$')
control_curves = {
    custom_prop.match(fc.data_path).group(1): fc
    for fc in action.fcurves
    if custom_prop.match(fc.data_path)
}
driver_globals = {
    '__builtins__': {},
    'radians': math.radians,
    'degrees': math.degrees,
    'sin': math.sin,
    'cos': math.cos,
    'tan': math.tan,
    'abs': abs,
    'min': min,
    'max': max,
    'pi': math.pi,
}
samples = {}

for owner in bpy.data.objects:
    if not owner.animation_data:
        continue
    for driver_curve in owner.animation_data.drivers:
        variables = list(driver_curve.driver.variables)
        if any(variable.type != 'SINGLE_PROP' for variable in variables):
            raise RuntimeError(
                f'Unsupported Bambu driver variable on {owner.name}: '
                f'{driver_curve.data_path}'
            )

        frame_values = []
        for frame in bake_frames:
            values = {}
            for variable in variables:
                target = variable.targets[0]
                match = custom_prop.match(target.data_path)
                if not (target.id and match):
                    raise RuntimeError(
                        f'Unsupported Bambu driver target on {owner.name}: '
                        f'{target.data_path}'
                    )
                prop_name = match.group(1)
                source_curve = control_curves.get(prop_name)
                values[variable.name] = (
                    source_curve.evaluate(frame)
                    if source_curve
                    else target.id.get(prop_name, 0.0)
                )
            frame_values.append(eval(
                driver_curve.driver.expression,
                driver_globals,
                values,
            ))

        samples.setdefault(owner, []).append((
            driver_curve.data_path,
            driver_curve.array_index,
            frame_values,
        ))

for owner in bpy.data.objects:
    if owner.animation_data:
        owner.animation_data_clear()

for owner, channels in samples.items():
    for data_path, array_index, frame_values in channels:
        target = owner.path_resolve(data_path)
        for frame, value in zip(bake_frames, frame_values):
            target[array_index] = value
            owner.keyframe_insert(
                data_path=data_path,
                index=array_index,
                frame=frame,
                group='bambu_web_export',
            )
    for fcurve in owner.animation_data.action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = 'LINEAR'

print('BAMBU_DRIVERS_MATERIALIZED::' + json.dumps({
    'objects': sorted(owner.name for owner in samples),
    'frames': [bake_frames[0], bake_frames[-1]],
    'step': 4,
}))

# Reuse the shared exporter's selection and material preprocessing, stopping
# before its generic driver bake. Bambu's drivers are already materialized.
shared_exporter = Path(__file__).with_name('export-blend.py')
shared_source = shared_exporter.read_text()
preprocessing, marker, _ = shared_source.partition('\nscene = bpy.context.scene\n')
if not marker:
    raise RuntimeError('Could not locate shared exporter preprocessing boundary')
exec(compile(preprocessing, str(shared_exporter), 'exec'))

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIVE_ACTIONS',
    export_frame_range=True,
    export_force_sampling=False,
    export_optimize_animation_size=False,
    export_apply=True,
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

polys = sum(
    len(obj.data.polygons)
    for obj in bpy.data.objects
    if obj.type == 'MESH'
)
print('EXPORT_OK::' + json.dumps({
    'out': out_path,
    'polys': polys,
    'actions': len(bpy.data.actions),
    'frames': [scene.frame_start, scene.frame_end],
    'fps': scene.render.fps,
}))
