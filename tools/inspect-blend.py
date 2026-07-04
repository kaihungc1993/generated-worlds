# Runs inside Blender: prints a JSON summary of the .blend file
# (objects, animations, rigs, dimensions) to stdout.
import bpy
import json
import sys

objects = []
for o in bpy.data.objects:
    objects.append({
        'name': o.name,
        'type': o.type,
        'animated': bool(o.animation_data and (o.animation_data.action or o.animation_data.nla_tracks)),
        'children': len(o.children),
    })

actions = [{'name': a.name, 'frames': [a.frame_range[0], a.frame_range[1]]} for a in bpy.data.actions]

scene = bpy.context.scene
summary = {
    'objects': len(objects),
    'meshes': sum(1 for o in objects if o['type'] == 'MESH'),
    'armatures': sum(1 for o in objects if o['type'] == 'ARMATURE'),
    'empties': sum(1 for o in objects if o['type'] == 'EMPTY'),
    'lights': sum(1 for o in objects if o['type'] == 'LIGHT'),
    'cameras': sum(1 for o in objects if o['type'] == 'CAMERA'),
    'animated_objects': sum(1 for o in objects if o['animated']),
    'actions': actions[:20],
    'frame_range': [scene.frame_start, scene.frame_end],
    'fps': scene.render.fps,
    'materials': len(bpy.data.materials),
    'images': len(bpy.data.images),
    'polys': sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'),
    'sample_objects': objects[:25],
}
print('BLEND_SUMMARY::' + json.dumps(summary))
