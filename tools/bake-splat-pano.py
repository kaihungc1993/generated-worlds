# Bakes a Gaussian-splat background (KIRI 3DGS import: a dense point mesh
# with per-point gaussian attributes) to an equirectangular panorama PNG for
# use as the exported asset's skybox (manifest `sky` field).
#
# glTF cannot carry real gaussian splats, and the addon's camera-dependent
# geometry-nodes renderer doesn't work headless, so instead the splat points
# are rendered as a Cycles point cloud: each gaussian becomes a small sphere
# whose radius comes from the splat's log-scale attributes and whose emission
# color/alpha come from the precomputed `Col` attribute. From a panoramic
# camera at the subject's position this reads as the photographic room the
# splat was captured from.
#
# Usage: Blender -b scene.blend -P tools/bake-splat-pano.py -- OUT.png \
#          [--splat-object NAME] [--camera X,Y,Z] [--res WxH] [--samples N]
import sys

import bpy  # pylint: disable=import-error
import numpy as np
from mathutils import Vector  # pylint: disable=import-error

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


SPLAT_NAME = arg("--splat-object", "lab_scene")
CAM_POS = tuple(float(v) for v in arg("--camera", "0,0,1.35").split(","))
RES_W, RES_H = (int(v) for v in arg("--res", "2048x1024").split("x"))
SAMPLES = int(arg("--samples", "64"))

scene = bpy.context.scene
splat = bpy.data.objects[SPLAT_NAME]
mesh = splat.data
n = len(mesh.vertices)

# --- read splat attributes ---------------------------------------------------
pos = np.empty(n * 3, dtype=np.float32)
mesh.vertices.foreach_get("co", pos)
pos = pos.reshape(-1, 3)


def read_float(name):
    a = mesh.attributes[name]
    buf = np.empty(n, dtype=np.float32)
    a.data.foreach_get("value", buf)
    return buf


col = np.empty(n * 4, dtype=np.float32)
mesh.attributes["Col"].data.foreach_get("color", col)
col = col.reshape(-1, 4)

# Gaussian scales are stored as log-scale; the third axis is the gaussian's
# flat direction, so a representative sphere radius comes from the two large
# axes. Alpha in Col is the already-sigmoided opacity.
s0, s1 = read_float("scale_0"), read_float("scale_1")
radius = np.exp((s0 + s1) / 2.0)
alpha = col[:, 3]

# Drop near-transparent floaters; they only add noise and render time.
keep = alpha > 0.02
pos, col, radius = pos[keep], col[keep], radius[keep]
radius = np.clip(radius, 0.004, 0.35)
print(f"SPLAT_POINTS:: kept {len(pos)} of {n}")

# --- rebuild as a plain point mesh + Mesh-to-Points GN -----------------------
pm = bpy.data.meshes.new("splat_bake_points")
pm.vertices.add(len(pos))
pm.vertices.foreach_set("co", pos.ravel())
ca = pm.attributes.new("Col", "FLOAT_COLOR", "POINT")
ca.data.foreach_set("color", col.ravel())
ra = pm.attributes.new("splat_radius", "FLOAT", "POINT")
ra.data.foreach_set("value", radius)
ob = bpy.data.objects.new("splat_bake", pm)
ob.matrix_world = splat.matrix_world.copy()
scene.collection.objects.link(ob)

mat = bpy.data.materials.new("splat_bake_mat")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
out_node = nt.nodes.new("ShaderNodeOutputMaterial")
attr_node = nt.nodes.new("ShaderNodeAttribute")
attr_node.attribute_name = "Col"
# Col holds display-referred (sRGB-like) splat colors; decode to linear so the
# Standard view transform round-trips them back to the authored look.
gamma = nt.nodes.new("ShaderNodeGamma")
gamma.inputs["Gamma"].default_value = 2.2
emit = nt.nodes.new("ShaderNodeEmission")
transp = nt.nodes.new("ShaderNodeBsdfTransparent")
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(attr_node.outputs["Color"], gamma.inputs["Color"])
nt.links.new(gamma.outputs["Color"], emit.inputs["Color"])
nt.links.new(attr_node.outputs["Alpha"], mix.inputs["Fac"])
nt.links.new(transp.outputs["BSDF"], mix.inputs[1])
nt.links.new(emit.outputs["Emission"], mix.inputs[2])
nt.links.new(mix.outputs["Shader"], out_node.inputs["Surface"])

ng = bpy.data.node_groups.new("splat_bake_gn", "GeometryNodeTree")
ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
gin = ng.nodes.new("NodeGroupInput")
gout = ng.nodes.new("NodeGroupOutput")
m2p = ng.nodes.new("GeometryNodeMeshToPoints")
rad = ng.nodes.new("GeometryNodeInputNamedAttribute")
rad.data_type = "FLOAT"
rad.inputs["Name"].default_value = "splat_radius"
setmat = ng.nodes.new("GeometryNodeSetMaterial")
setmat.inputs["Material"].default_value = mat
ng.links.new(gin.outputs["Geometry"], m2p.inputs["Mesh"])
ng.links.new(rad.outputs["Attribute"], m2p.inputs["Radius"])
ng.links.new(m2p.outputs["Points"], setmat.inputs["Geometry"])
ng.links.new(setmat.outputs["Geometry"], gout.inputs["Geometry"])
gnmod = ob.modifiers.new("splat_bake_gn", "NODES")
gnmod.node_group = ng

# --- render only the splat ----------------------------------------------------
for o in scene.objects:
    o.hide_render = o is not ob

cam_data = bpy.data.cameras.new("SplatPanoCam")
cam_data.type = "PANO"
cam_data.panorama_type = "EQUIRECTANGULAR"
cam_data.clip_start = 0.05
cam_data.clip_end = 10000
cam = bpy.data.objects.new("SplatPanoCam", cam_data)
cam.location = Vector(CAM_POS)
# Horizon-level, with the pano CENTER on Blender +X. three.js samples an
# equirect background at u=0.5 for world +X, and the glTF Y-up export maps
# Blender axes to three as (x, z, -y) — chasing that through equirectUv, a
# +X-centered bake lines the room up with the exported model in the viewer
# (a +Y-centered bake, like bake-sky.py's, shows the room yawed 90°; for
# sky-only worlds that's invisible, for an indoor capture it isn't).
cam.rotation_euler = (1.5707963, 0, -1.5707963)
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
# Deep stacks of semi-transparent gaussians need generous transparency depth.
scene.cycles.transparent_max_bounces = 32
scene.render.resolution_x = RES_W
scene.render.resolution_y = RES_H
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"SPLAT_PANO_OK:: out={OUT} points={len(pos)} res={RES_W}x{RES_H}")
