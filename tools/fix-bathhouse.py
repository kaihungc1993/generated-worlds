# Pre-export fixes for the bathhouse scene. Run before bake-procedural.py /
# export-blend.py:
#   blender -b scene.blend -P fix-bathhouse.py -P bake-procedural.py \
#       -P export-blend.py -- out.glb
import bpy
import re

# The shoji screens (glowing paper panels on the pagoda facade) were removed
# at the user's request; the source .blend still contains them, so drop them
# (with any children) on every export or they resurrect each re-export.
_shoji = [o for o in bpy.data.objects if re.search(r'shoji', o.name, re.IGNORECASE)]
_doomed = set(_shoji)
for o in _shoji:
    _doomed.update(o.children_recursive)
for o in _doomed:
    bpy.data.objects.remove(o, do_unlink=True)
print(f"removed {len(_doomed)} shoji objects")

# The viewer hides nodes matching ceil*/roof* at a word boundary (dollhouse
# view for interiors), but this is an exterior courtyard scene — hiding the
# wing and auxiliary roofs leaves holes while the main pagoda roofs stay.
# Rename so the matcher no longer fires ('rooftile' has no boundary after
# 'roof').
for o in list(bpy.data.objects):
    lower = o.name.lower()
    if "roof" in lower or "ceil" in lower:
        o.name = (
            o.name.replace("roof", "rooftile")
            .replace("Roof", "Rooftile")
            .replace("ROOF", "ROOFTILE")
            .replace("ceil", "ceiltile")
            .replace("Ceil", "Ceiltile")
        )
        print("renamed ->", o.name)

# The lantern point lights over the water are warm (1, 0.7, 0.28), but the
# water's teal base color (0.005, 0.04, 0.06) turns their diffuse pools GREEN
# in the web viewer (light x albedo has G >> R). In Cycles the water is a
# near-mirror so this never shows. Shift the albedo to a dark warm-neutral so
# the light pools read as warm lantern reflections.
water = bpy.data.materials.get("HotSpringWater")
if water and water.use_nodes:
    bsdf = next((n for n in water.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.032, 0.030, 0.028, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.08
        print("water albedo warmed")
