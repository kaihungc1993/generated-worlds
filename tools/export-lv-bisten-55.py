# LV Bisten 55 glTF compatibility preprocessing.
#
# Fixes scoped to this asset; the source .blend is never saved.
#
# 1. Monogram texture: the authored material combines its tile, procedural
#    wear, and an initials overlay through ShaderNodeMix nodes. Blender
#    renders that graph, but the glTF exporter cannot represent it and
#    incorrectly promotes the initials image to the material's base-color
#    texture. Connect the packed monogram tile directly to Principled Base
#    Color for the web export.
#
# 2. Hinge euler order: the articulation hinges use rotation_mode ZYX with a
#    rest orientation of (0, +/-90deg, 0) and the driven opening angle on the
#    Z component. The shared exporter bakes those transforms into euler
#    keyframes faithfully, but Blender's glTF exporter converts animated
#    euler f-curves to quaternions assuming XYZ order, which swaps the hinge
#    axis (the lid then swings sideways instead of opening about its rear
#    hinge). Split each hinge's static rest orientation onto a parent empty
#    so the animated euler is a pure Z rotation, which every euler order
#    interprets identically. Exact for ZYX because R = Rx(x)*Ry(y) * Rz(z).

import bpy  # pylint: disable=import-error
import json
import os
import runpy


MATERIAL = "monogram_coated_canvas"
IMAGE = "monogram_tile"

material = bpy.data.materials.get(MATERIAL)
if not material or not material.use_nodes or not material.node_tree:
    raise RuntimeError(f"LV preprocessing: missing node material {MATERIAL!r}")

nodes = material.node_tree.nodes
bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
image_node = next(
    (
        node
        for node in nodes
        if node.type == "TEX_IMAGE" and node.image and node.image.name == IMAGE
    ),
    None,
)
if not bsdf or not image_node:
    raise RuntimeError("LV preprocessing: missing Principled BSDF or monogram image node")
if not image_node.image.packed_file and not os.path.exists(bpy.path.abspath(image_node.image.filepath)):
    raise RuntimeError("LV preprocessing: monogram image is neither packed nor available on disk")

base_color = bsdf.inputs["Base Color"]
for link in list(base_color.links):
    material.node_tree.links.remove(link)
material.node_tree.links.new(image_node.outputs["Color"], base_color)

print(
    "LV_MONOGRAM_COMPAT::"
    f"{image_node.image.name} -> {material.name}.Principled BSDF.Base Color"
)

# Leather tones (linear RGBA), matched against the reference listing photos.
# lozine_trim_tan is authored as a dark chestnut mix, but the shared
# exporter's procedural flattening averages its mix stops with a neutral 0.5
# factor, which drags in the light "worn edge" stop and ships too pale.
# leather_handle_cognac has a plain default that already reads light under
# the studio viewer. Pin both to reference-matched colors and unlink any
# Base Color chain so the shared flattening pass leaves them untouched.
LEATHER_COLORS = {
    "lozine_trim_tan": (0.22, 0.085, 0.035, 1.0),
    "leather_handle_cognac": (0.34, 0.12, 0.025, 1.0),
}

for mat_name, color in LEATHER_COLORS.items():
    leather = bpy.data.materials.get(mat_name)
    if not leather or not leather.use_nodes or not leather.node_tree:
        raise RuntimeError(f"LV preprocessing: missing leather material {mat_name!r}")
    leather_bsdf = next(
        (node for node in leather.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if not leather_bsdf:
        raise RuntimeError(f"LV preprocessing: {mat_name!r} has no Principled BSDF")
    socket = leather_bsdf.inputs["Base Color"]
    for link in list(socket.links):
        leather.node_tree.links.remove(link)
    socket.default_value = color

print("LV_LEATHER_COMPAT::" + json.dumps(
    {name: list(color[:3]) for name, color in LEATHER_COLORS.items()}))

from mathutils import Euler, Matrix  # pylint: disable=import-error,wrong-import-position

HINGES = ["lid_hinge", "clasp_left_hinge", "clasp_right_hinge", "handle_pivot"]

for hinge_name in HINGES:
    hinge = bpy.data.objects.get(hinge_name)
    if hinge is None:
        raise RuntimeError(f"LV preprocessing: missing hinge object {hinge_name!r}")
    euler = hinge.rotation_euler
    # Static rest part: the authored euler with the driven Z component zeroed.
    rest_rotation = Euler((euler.x, euler.y, 0.0), hinge.rotation_mode).to_matrix().to_4x4()

    mount = bpy.data.objects.new(f"{hinge_name}_rest", None)
    (hinge.users_collection[0] if hinge.users_collection
     else bpy.context.scene.collection).objects.link(mount)
    mount.parent = hinge.parent
    mount.parent_type = hinge.parent_type
    mount.matrix_parent_inverse = hinge.matrix_parent_inverse.copy()
    mount.matrix_basis = Matrix.Translation(hinge.location) @ rest_rotation

    hinge.parent = mount
    hinge.parent_type = "OBJECT"
    hinge.matrix_parent_inverse = Matrix.Identity(4)
    hinge.location = (0.0, 0.0, 0.0)
    hinge.rotation_euler = (0.0, 0.0, euler.z)

print("LV_HINGE_COMPAT::" + ", ".join(f"{n} -> {n}_rest" for n in HINGES))

runpy.run_path(os.path.join(os.path.dirname(__file__), "export-blend.py"), run_name="__main__")
