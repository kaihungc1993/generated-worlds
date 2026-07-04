# Pre-export fixes for the dockyard scene. Run before bake-procedural.py /
# export-blend.py:
#   blender -b dockyard.blend -P fix-dockyard.py -P bake-procedural.py \
#       -P export-blend.py -- out.glb
import bpy

# The Sea/Seabed planes are 400x400 m and dominate the scene bounding box,
# which makes the web viewer frame the tiny dock from very far away. Shrink
# them to a modest margin around the dock.
for name in ("Sea", "Seabed"):
    o = bpy.data.objects.get(name)
    if o:
        o.scale = (o.scale[0] * 0.17, o.scale[1] * 0.17, o.scale[2])
        print("shrunk", name)

# The sea material uses Transmission 0.8; three.js renders that as glassy
# white under the studio IBL. Make it opaque so the teal water reads instead.
sea = bpy.data.objects.get("Sea")
if sea:
    for m in sea.data.materials:
        if not (m and m.use_nodes):
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            for key in ("Transmission Weight", "Transmission"):
                if key in bsdf.inputs:
                    bsdf.inputs[key].default_value = 0.0
                    print("sea transmission zeroed on", m.name)
                    break

# Road_Markings_UV_Proxy is a UV-projection helper: a single quad covering the
# whole ground slab with NO material. It exports as a giant default-white
# plane that hides the asphalt beneath it in the web viewer. Hide it from
# render (export-blend.py skips hide_render objects in scene mode) rather than
# deleting it, in case a UVProject modifier references it.
proxy = bpy.data.objects.get("Road_Markings_UV_Proxy")
if proxy:
    proxy.hide_render = True
    print("hid Road_Markings_UV_Proxy")
