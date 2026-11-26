"""Prepare a static Meshy building (no rig) for the app.

Run with Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/prepare-building.py -- \
      --src assets-source/zug_house_1/zug_house_1_lowpoly.glb --out public/assets/models/zug_house_1.glb [--tex 1024]

What it does: joins the meshes, stands the model on y=0 centred on its footprint, shrinks the
texture to --tex pixels (Meshy delivers 2048), shades it flat (Meshy's smooth normals streak flat
boards with light), then exports WebP textures and Draco geometry.
The game sizes buildings onto their placeholders (MODEL_FIT in src/scenes/shared/models.ts),
so the model's own units do not matter.
"""
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


SRC = opt('--src')
OUT = opt('--out')
TEX = int(opt('--tex', 1024))
if not SRC or not OUT:
    sys.exit('usage: --src in.glb --out out.glb [--tex 1024]')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
# bake parent transforms into the mesh, then drop empty parents
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o)

# stand on the ground, centred on the footprint (glTF y-up is Blender z-up)
pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
z0 = min(p.z for p in pts)
for v in obj.data.vertices:
    v.co -= Vector((cx, cy, z0))

# flat shading: Meshy's smooth normals make flat boards (shutters, doors) catch light in streaks
bpy.context.view_layer.objects.active = obj
if obj.data.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
for poly in obj.data.polygons:
    poly.use_smooth = False

for img in bpy.data.images:
    if img.size[0] > TEX:
        img.scale(TEX, TEX)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', use_selection=False,
    export_image_format='WEBP', export_image_quality=85,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
    export_draco_position_quantization=12, export_draco_normal_quantization=8,
)
print(f'prepared {OUT}: {tris} triangles, texture {TEX}px')
