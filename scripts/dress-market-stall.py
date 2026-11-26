"""Fill the Meshy market stall's empty baskets and crates with our own low-poly cherries and write
KIRSCHEN on its chalkboard (Blender).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/dress-market-stall.py -- \
      --src stall_prepared.glb --out public/assets/models/zug_stall.glb

Run on the stall after clean-meshy-texture.py and prepare-building.py (standing on z=0, front to -y
in Blender). Baskets are found as the round pieces of the mesh (vertices welded first); each gets a
low red mound with a few cherries on it. The two crates on the counter and the chalkboard are at
the places measured on this model (CRATES, BOARD below); a different stall needs new numbers.
Cherries are small low-poly spheres (24 triangles) in flat vertex colours: one extra mesh, one draw call.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


SRC, OUT = opt('--src'), opt('--out')
if not SRC or not OUT:
    sys.exit('usage: --src stall.glb --out stall_dressed.glb')

# measured on assets-source/stall (Blender axes, model units): crate interiors and the board
CRATES = [((-0.325, -0.215), (-0.115, 0.065), 0.27), ((0.205, 0.325), (-0.115, 0.065), 0.27)]
BOARD = (0.0, -0.142, 0.122, 0.11)  # centre x, front y (the frame's face), centre z, width

RED, DARK, STEM = (0.72, 0.07, 0.15), (0.5, 0.05, 0.11), (0.37, 0.62, 0.29)
rnd = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
stall = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]

# ---- find the baskets: round pieces about a basket's size
bm = bmesh.new()
bm.from_mesh(stall.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
bm.faces.ensure_lookup_table()
seen, baskets = set(), []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, comp = [f], []
    seen.add(f.index)
    while stack:
        g = stack.pop()
        comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen:
                    seen.add(h.index)
                    stack.append(h)
    vs = [stall.matrix_world @ v.co for g in comp for v in g.verts]
    mn = Vector([min(v[k] for v in vs) for k in range(3)])
    mx = Vector([max(v[k] for v in vs) for k in range(3)])
    d = mx - mn
    if len(comp) >= 60 and max(d) < 0.16 and abs(d.x - d.y) < 0.03:
        baskets.append(((mn + mx) / 2, min(d.x, d.y) / 2, mx.z))
bm.free()

verts, faces, cols = [], [], []


def poly(pts, col):
    i = len(verts)
    verts.extend(pts)
    faces.append(list(range(i, i + len(pts))))
    cols.append(col)


def cherry(c, r, col=RED, stem=False):
    """A round low-poly cherry: six slices, three rings (24 triangles), with an optional stem."""
    a0 = rnd.random() * math.pi
    rings = [(-0.92, 0.0), (-0.45, 0.85), (0.4, 0.92), (0.9, 0.0)]  # (height, radius) as fractions of r
    pts = [[c + Vector((math.cos(a0 + k * math.pi / 3) * r * rr, math.sin(a0 + k * math.pi / 3) * r * rr, r * hh))
            for k in range(6)] for hh, rr in rings]
    bot, top = c + Vector((0, 0, -0.92 * r)), c + Vector((0, 0, 0.9 * r))
    for k in range(6):
        n = (k + 1) % 6
        poly([pts[1][n], pts[1][k], bot], col)
        poly([pts[1][k], pts[1][n], pts[2][n], pts[2][k]], col)
        poly([pts[2][k], pts[2][n], top], col)
    if stem:
        s0 = top
        s1 = top + Vector((r * 0.5, 0, r * 1.4))
        w = Vector((0, r * 0.12, 0))
        poly([s0 - w, s0 + w, s1 + w, s1 - w], STEM)


def mound(c, rad, h):
    """A low dark-red dome filling a basket: an octagon fan."""
    apex = c + Vector((0, 0, h))
    ring = [c + Vector((math.cos(k * math.pi / 4) * rad, math.sin(k * math.pi / 4) * rad, 0)) for k in range(8)]
    for k in range(8):
        poly([ring[k], ring[(k + 1) % 8], apex], DARK)


for centre, rad, top in baskets:
    base = Vector((centre.x, centre.y, top - 0.014))
    mound(base, rad * 0.86, 0.022)
    r = rad * 0.3
    for k in range(5):
        a = k * 2 * math.pi / 5 + rnd.random() * 0.4
        cherry(base + Vector((math.cos(a) * rad * 0.48, math.sin(a) * rad * 0.48, 0.012)), r, stem=k % 2 == 0)
    cherry(base + Vector((0, 0, 0.026)), r, stem=True)

for (x0, x1), (y0, y1), floor in CRATES:
    r = 0.017
    nx, ny = int((x1 - x0) / (2.1 * r)), int((y1 - y0) / (2.1 * r))
    for i in range(nx):
        for j in range(ny):
            c = Vector((x0 + (i + 0.5) * (x1 - x0) / nx, y0 + (j + 0.5) * (y1 - y0) / ny, floor + r * 1.6))
            cherry(c + Vector((rnd.uniform(-0.003, 0.003), rnd.uniform(-0.003, 0.003), 0)), r, stem=(i + j) % 3 == 0)

me = bpy.data.meshes.new('cherries')
me.from_pydata([tuple(v) for v in verts], [], faces)
attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for fi, p in enumerate(me.polygons):
    for li in p.loop_indices:
        attr.data[li].color_srgb = cols[fi] + (1.0,)
mat = bpy.data.materials.new('cherries')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.45
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.append(mat)
fruit = bpy.data.objects.new('cherries', me)
bpy.context.scene.collection.objects.link(fruit)

# ---- KIRSCHEN in chalk on the board
cx, fy, cz, bw = BOARD
bpy.ops.object.text_add(location=(cx, fy - 0.003, cz))
txt = bpy.context.object
txt.data.body = 'KIRSCHEN'
txt.data.align_x = 'CENTER'
txt.data.align_y = 'CENTER'
txt.data.resolution_u = 2
txt.rotation_euler = (math.pi / 2, 0, 0)
bpy.context.view_layer.update()
txt.data.size = 1.0
bpy.context.view_layer.update()
width = txt.dimensions.x or 1.0
txt.data.size = bw * 0.78 / width
bpy.ops.object.convert(target='MESH')
chalk = bpy.data.materials.new('chalk')
chalk.use_nodes = True
cb = chalk.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (0.89, 0.87, 0.8, 1)
cb.inputs['Roughness'].default_value = 1.0
txt.data.materials.clear()
txt.data.materials.append(chalk)
txt.name = 'sign_text'

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='MATERIAL',
    export_image_format='WEBP', export_image_quality=85,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
    export_draco_position_quantization=14, export_draco_normal_quantization=8, export_draco_color_quantization=8,
)
print(f'dressed {OUT}: {len(baskets)} baskets, {len(CRATES)} crates, {tris} triangles in all')
