"""Build the race gate in Blender as true low poly: two wooden posts, a blank cream board with a
Zug-blue frame on both faces, blue and white bunting below (no textures, one vertex-coloured material).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/build-race-sign.py -- \
      --out public/assets/models/zug_race_sign.glb

The same gate stands at the start and at the finish, so the board stays blank and the game writes
START or ZIEL on it (signText in src/game/journey-world.ts). On each face an empty `board_front` /
`board_back` marks the inside of the blue frame: at its middle, scaled to its width and height, its
local z (glTF y) pointing out of the face. Faces share no vertices, so shading is flat. Units are
metres; the gate's width runs along glTF z, like the start arch placeholder it replaces (the game
lays that across the path); the board faces glTF +x and -x.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[args.index('--out') + 1] if '--out' in args else None
if not OUT:
    sys.exit('usage: --out sign.glb')


def srgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


C = {
    'post': srgb('9a6a40'), 'postDark': srgb('7b4e30'), 'board': srgb('f3e8cf'), 'boardEdge': srgb('ddd0b2'),
    'blue': srgb('2d63b4'), 'white': srgb('fbf8f1'), 'string': srgb('efe6d2'), 'stone': srgb('d8ccb4'),
}

# measures (Blender axes before the final turn: width along x, the board's front facing -y)
POST_X, POST_R, POST_TOP = 2.55, 0.17, 5.05
# the board ends inside the posts (at their axes; thinner than a post), so nothing sticks out at the sides
BX, BZ0, BZ1, BT = POST_X, 3.6, 4.9, 0.12       # board half width, bottom, top, half thickness
GAP = 0.025                                      # between the two planks
FX, FZ0, FZ1, FW, FP = 1.95, 3.72, 4.78, 0.09, 0.02  # frame outer half width, bottom, top, line width, proud
STRING_END, STRING_SAG = 3.45, 0.28              # bunting string height at the posts, sag in the middle
FLAGS, FLAG_W, FLAG_H, FLAG_T = 11, 0.36, 0.46, 0.012

# an empty scene (the factory one has a cube, a camera and a light that would be exported too)
bpy.ops.wm.read_factory_settings(use_empty=True)
verts, faces, cols = [], [], []


def face(pts, color, away_from):
    """One flat polygon (convex, in order); flipped if its normal points towards `away_from`."""
    pts = [Vector(p) for p in pts]
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    c = sum(pts, Vector()) / len(pts)
    if n.dot(c - Vector(away_from)) < 0:
        pts.reverse()
    i = len(verts)
    verts.extend(pts)
    faces.append(list(range(i, i + len(pts))))
    cols.append(color)


def prism(poly, c0, c1, color, m, cap_color=None, skip_back=False):
    """Extrude a convex 2-D polygon (a, b) from c0 to c1; m(a, b, c) maps to world."""
    inside = sum((Vector(m(a, b, (c0 + c1) / 2)) for a, b in poly), Vector()) / len(poly)
    face([m(a, b, c1) for a, b in poly], cap_color or color, inside)
    if not skip_back:
        face([m(a, b, c0) for a, b in poly], cap_color or color, inside)
    for i in range(len(poly)):
        (a0, b0), (a1, b1) = poly[i], poly[(i + 1) % len(poly)]
        face([m(a0, b0, c0), m(a1, b1, c0), m(a1, b1, c1), m(a0, b0, c1)], color, inside)


def rect(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def box(x0, x1, y0, y1, z0, z1, color, skip_bottom=True):
    prism(rect(x0, x1, y0, y1), z0, z1, color, lambda a, b, c: (a, b, c), skip_back=skip_bottom)


def on_face(side):
    """Map board-face coords (u along the board, v up, w outwards) to world; side -1 front, +1 back."""
    return lambda u, v, w: (u, side * (BT + w), v)


# ---- posts: octagonal, a darker pyramid cap, a low stone foot
octagon = [(math.cos((k + 0.5) * math.pi / 4) * POST_R, math.sin((k + 0.5) * math.pi / 4) * POST_R) for k in range(8)]
for sx in (-1, 1):
    x = sx * POST_X
    m = lambda a, b, c, x=x: (x + a, b, c)
    prism(octagon, 0.25, POST_TOP, C['post'], m, skip_back=True)
    box(x - 0.26, x + 0.26, -0.26, 0.26, 0, 0.25, C['stone'])
    tip = (x, 0, POST_TOP + 0.22)
    for k in range(8):
        (a0, b0), (a1, b1) = octagon[k], octagon[(k + 1) % 8]
        face([(x + a0 * 1.15, b0 * 1.15, POST_TOP), (x + a1 * 1.15, b1 * 1.15, POST_TOP), tip], C['postDark'], (x, 0, POST_TOP))
    face([(x + a * 1.15, b * 1.15, POST_TOP) for a, b in octagon], C['postDark'], tip)

# ---- the board: two planks, a darker strip in the gap between them
mid = (BZ0 + BZ1) / 2
for z0, z1 in ((BZ0, mid - GAP / 2), (mid + GAP / 2, BZ1)):
    prism(rect(-BX, BX, -BT, BT), z0, z1, C['board'], lambda a, b, c: (a, b, c), skip_back=False)
box(-BX + 0.02, BX - 0.02, -BT + 0.02, BT - 0.02, mid - GAP / 2, mid + GAP / 2, C['boardEdge'], skip_bottom=False)

# ---- the blue frame on both faces, a little proud of the planks
for side in (-1, 1):
    m = on_face(side)
    for u0, u1, v0, v1 in ((-FX, FX, FZ0, FZ0 + FW), (-FX, FX, FZ1 - FW, FZ1),
                           (-FX, -FX + FW, FZ0 + FW, FZ1 - FW), (FX - FW, FX, FZ0 + FW, FZ1 - FW)):
        prism(rect(u0, u1, v0, v1), 0, FP, C['blue'], m, skip_back=True)

# ---- bunting: a sagging string from post to post with triangle flags, blue and white in turn
def string_z(x):
    return STRING_END - STRING_SAG * (1 - (x / POST_X) ** 2)


N = 12
xs = [-POST_X + 2 * POST_X * k / N for k in range(N + 1)]
for x0, x1 in zip(xs, xs[1:]):
    z0, z1 = string_z(x0), string_z(x1)
    face([(x0, -0.015, z0), (x1, -0.015, z1), (x1, -0.015, z1 + 0.035), (x0, -0.015, z0 + 0.035)], C['string'], (0, 1, 0))
    face([(x0, 0.015, z0), (x1, 0.015, z1), (x1, 0.015, z1 + 0.035), (x0, 0.015, z0 + 0.035)], C['string'], (0, -1, 0))
span = 2 * POST_X - 0.7
for k in range(FLAGS):
    x = -span / 2 + span * k / (FLAGS - 1)
    z = string_z(x)
    tri = [(x - FLAG_W / 2, string_z(x - FLAG_W / 2)), (x + FLAG_W / 2, string_z(x + FLAG_W / 2)), (x, z - FLAG_H)]
    prism(tri, -FLAG_T, FLAG_T, C['blue'] if k % 2 == 0 else C['white'], lambda a, b, c: (a, c, b))

# ---- one mesh, colours per face corner, flat shading
me = bpy.data.meshes.new('race_sign')
me.from_pydata([tuple(v) for v in verts], [], faces)
attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for fi, poly in enumerate(me.polygons):
    for li in poly.loop_indices:
        attr.data[li].color_srgb = cols[fi]
me.validate()
sign = bpy.data.objects.new('race_sign', me)
bpy.context.scene.collection.objects.link(sign)
mat = bpy.data.materials.new('race_sign')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.9
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.append(mat)

# ---- where the game writes: the inside of the blue frame on each face
iw, ih, iz = 2 * (FX - FW), FZ1 - FZ0 - 2 * FW, (FZ0 + FZ1) / 2
for side, name in ((-1, 'board_front'), (1, 'board_back')):
    mark = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(mark)
    # local z out of the face (+90° about x turns +z to -y; the back is turned half round), local
    # x along the board, read left to right from in front of it
    mark.matrix_world = (Matrix.Translation((0, side * BT, iz)) @ Matrix.Rotation(0 if side < 0 else math.pi, 4, 'Z')
                         @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Diagonal((iw, ih, 1, 1)))

# width along glTF z (Blender y), like the start arch placeholder
turn = Matrix.Rotation(math.pi / 2, 4, 'Z')
for o in list(bpy.context.scene.objects):
    o.matrix_world = turn @ o.matrix_world

tris = sum(len(p.vertices) - 2 for p in me.polygons)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='MATERIAL',
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
    export_draco_position_quantization=14, export_draco_normal_quantization=8, export_draco_color_quantization=8,
)
print(f'built {OUT}: {tris} triangles, {2 * BX:.1f} m wide, {POST_TOP + 0.22:.1f} m tall, frame inside {iw:.2f} x {ih:.2f} m')
