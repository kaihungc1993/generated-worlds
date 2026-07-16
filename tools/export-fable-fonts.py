"""Convert FONT branding decals to meshes, then run the shared exporter.

The shared exporter (export-blend.py) excludes FONT objects wholesale —
they are usually presentation labels parked next to an asset. But some Fable
assets carry real product branding as FONT decals (the fridge's SAMSUNG
wordmark, the Bambu P1S's "Bambu Lab" wordmarks and bed labels), which that
exclusion silently dropped from the shipped GLBs. Converting them to meshes
in memory (same pattern as export-workbench-power.py) lets the branding
survive; the source .blend is never saved.
"""

import json
import os
import runpy

import bpy  # pylint: disable=import-error

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

if not converted:
    raise RuntimeError(
        "export-fable-fonts.py used on a blend with no FONT objects; "
        "use export-blend.py directly instead")
print("FABLE_FONTS_CONVERTED::" + json.dumps(sorted(converted)))

runpy.run_path(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "export-blend.py"),
    run_name="__main__",
)
