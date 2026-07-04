# Bakes a .blend file's World (sky/HDRI/flat color) to an equirectangular
# panorama PNG, for use as a skybox next to the exported GLB.
#
# Usage: Blender -b scene.blend -P tools/bake-sky.py -- /tmp/eval-skies/slug.png
#
# Strategy: hide every object from rendering so only the World background
# renders through a panoramic Cycles camera. If that comes out black (some
# scenes fake the sky with backdrop geometry), retry with sky-ish named
# objects visible, then with everything visible.

import re
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
OUT = argv[0]

scene = bpy.context.scene

# --- render settings: Cycles (EEVEE can't do panoramic cameras) ------------
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
scene.render.resolution_x = 2048
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.filepath = OUT
scene.render.use_border = False

# --- panoramic camera at the scene's bounding-box center -------------------
center = Vector((0, 0, 0))
corners = []
for obj in scene.objects:
    if obj.type == "MESH":
        corners.extend(obj.matrix_world @ Vector(c) for c in obj.bound_box)
if corners:
    lo = Vector((min(c[i] for c in corners) for i in range(3)))
    hi = Vector((max(c[i] for c in corners) for i in range(3)))
    center = (lo + hi) / 2

cam_data = bpy.data.cameras.new("SkyBakeCam")
cam_data.type = "PANO"
cam_data.panorama_type = "EQUIRECTANGULAR"
cam_data.clip_start = 0.1
cam_data.clip_end = 100000
cam = bpy.data.objects.new("SkyBakeCam", cam_data)
cam.location = center
cam.rotation_euler = (1.5707963, 0, 0)  # look at the horizon (-Y)
scene.collection.objects.link(cam)
scene.camera = cam

# --- visibility modes -------------------------------------------------------
SKYISH = re.compile(r"sky|dome|backdrop|background|cloud|star|nebula|moon|celest|horizon", re.I)

hidden = []  # objects we hid, with their original hide_render
for obj in scene.objects:
    if obj is cam:
        continue
    hidden.append((obj, obj.hide_render))
    obj.hide_render = True


def mean_brightness(path):
    img = bpy.data.images.load(path)
    try:
        px = list(img.pixels)  # RGBA floats
        n = len(px) // 4
        step = max(1, n // 50000)  # sample ~50k pixels
        total = 0.0
        count = 0
        for i in range(0, n, step):
            total += px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]
            count += 3
        return total / count
    finally:
        bpy.data.images.remove(img)


def render():
    bpy.ops.render.render(write_still=True)
    return mean_brightness(OUT)


mode = "world"
mean = render()

if mean < 0.005:
    mode = "sky-geo"
    for obj, orig in hidden:
        if SKYISH.search(obj.name):
            obj.hide_render = orig
    mean = render()

if mean < 0.005:
    mode = "all"
    for obj, orig in hidden:
        obj.hide_render = orig
    mean = render()

print(f"SKY_BAKE_OK mode={mode} mean={mean:.4f} world={'yes' if scene.world else 'NO_WORLD'} out={OUT}")
