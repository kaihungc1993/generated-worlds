"""Workbench power scene: in-memory preprocessing, then the shared exporter.

This run is a composed multi-asset scene (workbench + fixture plate, bench
power supply, power strip, detachable AC cable) rather than a single
articulated object, so the shared --object stripping heuristics don't apply:
they key off single-asset stage conventions and would misread parts of a
scene this large. The '--object' flag is stripped before chaining so
export-blend.py runs in scene mode (hide_render exclusions still drop the
boolean cutters and QA anchors).

Preprocessing here:
  * drop the Gaussian-splat background (shipped separately as a baked
    equirect panorama via the manifest `sky` field — glTF can't carry splats)
    and all per-sub-asset QA rigs (review cameras/lights/targets),
  * convert FONT objects to meshes so panel legends/display digits survive
    the shared exporter's FONT exclusion,
  * author the cable-insertion articulation (the run's demo script cleaned
    its keys up after rendering): seated -> unplugged -> hold -> seated on
    the root DOF, which the shared --bake-animation machinery propagates
    through the prismatic-joint drivers,
  * bake the cable tube's hook deformation to a single morph target. The
    hook controls are all linear in the insertion DOF, so the deformed tube
    is an exact lerp between the seated and unplugged shapes — one glTF
    morph target keyed alongside the DOF captures it losslessly.
"""

import json
import os
import runpy
import sys

import bpy  # pylint: disable=import-error
import numpy as np

SPLAT_OBJECTS = {"lab_scene", "lab_sceneSplat_Proxy"}
QA_PROPS = (
    "workbench_qa_only", "power_supply_qa_only", "power_strip_qa_only",
    "ac_cable_qa_only",
)
INSERTION_MAX = 0.06
# Same story as the run's own demo render (ac_anim.py): seated, pull the
# plug, hold unplugged, reseat. 78 frames at 24 fps.
INSERTION_KEYS = ((1, 0.0), (30, INSERTION_MAX), (48, INSERTION_MAX), (78, 0.0))

scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 78

# --- strip the splat + QA review rigs ----------------------------------------
# Only cameras and lights: several qa-flagged EMPTYs (the C13 mount, the
# cable's hook follow controls) are load-bearing members of the cable's
# kinematic chain. The remaining QA empties are hide_render and the shared
# exporter's scene mode drops those on its own.
removed = []
for obj in list(bpy.data.objects):
    is_qa_rig = obj.type in {"CAMERA", "LIGHT"} and any(obj.get(p) for p in QA_PROPS)
    if obj.name in SPLAT_OBJECTS or is_qa_rig:
        removed.append(obj.name)
        bpy.data.objects.remove(obj, do_unlink=True)
# Semantic top-plane marker quad (clear material) — QA metadata, not geometry.
marker = bpy.data.objects.get("workbench_fixture_plate_top")
if marker:
    removed.append(marker.name)
    bpy.data.objects.remove(marker, do_unlink=True)
print("SCENE_STRIPPED::" + json.dumps(sorted(removed)))

# --- FONT -> MESH so labels/digits survive the shared FONT exclusion ----------
converted = []
for obj in list(bpy.data.objects):
    if obj.type != "FONT":
        continue
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    converted.append(obj.name)
print(f"FONT_CONVERTED:: {len(converted)} objects")

# --- author the cable-insertion animation on the root DOF ---------------------
link = bpy.data.objects["ac_cable_cable_body_link"]
if link.animation_data:
    link.animation_data_clear()
link["ac_cable_iec_insertion"] = 0.0
for frame, value in INSERTION_KEYS:
    link["ac_cable_iec_insertion"] = value
    link.keyframe_insert(data_path='["ac_cable_iec_insertion"]', frame=frame)
prop_curve = link.animation_data.action.fcurves.find('["ac_cable_iec_insertion"]')

# --- bake the tube's hook deformation to one morph target ---------------------
tube = bpy.data.objects["ac_cable_cable_tube"]
depsgraph = bpy.context.evaluated_depsgraph_get()


def tube_verts(insertion):
    link["ac_cable_iec_insertion"] = insertion
    link.update_tag()
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = tube.evaluated_get(deps).to_mesh()
    buf = np.empty(len(ev.vertices) * 3, dtype=np.float64)
    ev.vertices.foreach_get("co", buf)
    return buf


seated = tube_verts(0.0)
unplugged = tube_verts(INSERTION_MAX)
link["ac_cable_iec_insertion"] = 0.0
link.update_tag()
bpy.context.view_layer.update()

bpy.ops.object.select_all(action="DESELECT")
tube.hide_set(False)
tube.select_set(True)
bpy.context.view_layer.objects.active = tube
bpy.ops.object.convert(target="MESH")  # applies bevel + hooks at seated pose
if len(tube.data.vertices) * 3 != len(seated):
    raise RuntimeError("tube conversion changed vertex count")

tube.shape_key_add(name="Basis")
key = tube.shape_key_add(name="iec_unplugged")
key.data.foreach_set("co", unplugged)
key_action = None
# Key the morph weight from the DOF curve at the same 2-frame cadence the
# shared exporter bakes transforms at, so tube tip and connector stay glued.
frames = list(range(scene.frame_start, scene.frame_end + 1, 2))
if frames[-1] != scene.frame_end:
    frames.append(scene.frame_end)
for frame in frames:
    key.value = prop_curve.evaluate(frame) / INSERTION_MAX
    key.keyframe_insert(data_path="value", frame=frame)
for fc in tube.data.shape_keys.animation_data.action.fcurves:
    for point in fc.keyframe_points:
        point.interpolation = "LINEAR"
print("TUBE_MORPH_BAKED::" + json.dumps({"verts": len(tube.data.vertices), "keys": len(frames)}))

# Validate the seated/unplugged poses before handing off.
conn = bpy.data.objects["ac_cable_c13_connector_link"]
scene.frame_set(30)
bpy.context.view_layer.update()
# frame_set alone doesn't re-evaluate the custom-property action in
# background mode reliably; the shared exporter handles that itself. Just
# sanity-check the driver chain responds to the DOF.
link["ac_cable_iec_insertion"] = INSERTION_MAX
link.update_tag()
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
dx = conn.evaluated_get(deps).matrix_world.translation.x
if abs(dx - (-0.133)) > 5e-3:
    raise RuntimeError(f"cable connector did not respond to insertion DOF (x={dx})")
link["ac_cable_iec_insertion"] = 0.0
link.update_tag()
scene.frame_set(1)

print("WORKBENCH_PREPROCESS_OK::" + json.dumps({
    "stripped": len(removed),
    "fonts_converted": len(converted),
    "animation": "ac_cable_iec_insertion",
    "frames": [scene.frame_start, scene.frame_end],
}))

# Scene-mode export: strip '--object' so the single-asset stage heuristics in
# the shared exporter don't run against this composed multi-asset scene.
sys.argv = [a for a in sys.argv if a != "--object"]
runpy.run_path(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "export-blend.py"),
    run_name="__main__",
)
