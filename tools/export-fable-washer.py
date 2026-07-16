"""Washer-specific in-memory fixes followed by the shared glTF exporter."""

import json
import math
import os
import runpy

import bpy  # pylint: disable=import-error


def remove_driver(owner, data_path, array_index):
    animation_data = owner.animation_data
    if not animation_data:
        return
    for curve in list(animation_data.drivers):
        if curve.data_path == data_path and curve.array_index == array_index:
            animation_data.drivers.remove(curve)


def remove_action_curve(source_action, data_path):
    for curve in list(source_action.fcurves):
        if curve.data_path == data_path:
            source_action.fcurves.remove(curve)


def add_control_curve(source_action, data_path, keys):
    remove_action_curve(source_action, data_path)
    curve = source_action.fcurves.new(data_path=data_path)
    for frame, value in keys:
        point = curve.keyframe_points.insert(frame, value)
        point.interpolation = "BEZIER"
        point.easing = "EASE_IN_OUT"
    curve.update()


root = bpy.data.objects["washer_link_frame"]
lid_hinge = bpy.data.objects["lid_hinge"]
drain_hose_insertion = bpy.data.objects["drain_hose_insertion"]
action = bpy.data.actions["washer_link_frameAction"]

# Keep the drain hose fully seated and remove both its authored control curve
# and transform driver, so it cannot become an exported animation channel.
remove_action_curve(action, '["drain_hose_insertion_m"]')
root["drain_hose_insertion_m"] = 0.0
remove_driver(drain_hose_insertion, "location", 1)
drain_hose_insertion.location.y = 0.0

# Animate the source's existing lid hinge over its original 120-frame loop.
root["lid_hinge_deg"] = 0.0
add_control_curve(
    action,
    '["lid_hinge_deg"]',
    ((1, 0.0), (60, 105.0), (120, 0.0)),
)

# With export_gn_mesh enabled, Blender emits evaluated Curve geometry on both
# the Curve and a child named "GN Instance". Realize each authored cable once
# to avoid coincident drain-hose and power-cord geometry in the GLB.
converted = []
for name in ("drain_hose", "power_cord"):
    obj = bpy.data.objects[name]
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    converted.append(name)

# Validate the exact poses that the shared exporter will bake.
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
if abs(lid_hinge.rotation_euler.x) > 1e-6:
    raise RuntimeError("washer lid is not closed at frame 1")
bpy.context.scene.frame_set(60)
bpy.context.view_layer.update()
if not math.isclose(lid_hinge.rotation_euler.x, -math.radians(105), abs_tol=1e-5):
    raise RuntimeError("washer lid did not reach the 105-degree open pose")
if abs(drain_hose_insertion.location.y) > 1e-6:
    raise RuntimeError("washer drain hose moved during preprocessing")
bpy.context.scene.frame_set(1)

print(
    "WASHER_PREPROCESS_OK::"
    + json.dumps(
        {
            "animation": "lid_hinge",
            "lid_degrees": [0, 105, 0],
            "drain_hose_static": True,
            "realized_curves": converted,
        }
    )
)

# Continue in the same unsaved Blender session. The source .blend remains
# untouched while the shared exporter handles materials and animation baking.
runpy.run_path(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "export-blend.py"),
    run_name="__main__",
)
