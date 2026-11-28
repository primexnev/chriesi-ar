"""Build a true low-poly Zug old-town house in Blender (no textures, one vertex-coloured material).

Run with Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/build-zug-house.py -- \
      --out public/assets/models/zug_house_a.glb [--w 6] [--d 6.5] [--floors 1] [--wall f1e3bf] [--roof c8643c]

Every part is real geometry in flat colours (warm pastel plaster and terracotta roofs, like the Zug lakefront):
stone plinth, white plaster ground floor, a jettied half-timber upper floor (or two), a steep gable
roof with overhang, a wooden bay window (Erker) and arched door on the front, windows with
wooden shutters with light chevrons on all four sides, the Zug coat of arms, a gold finial.
Faces share no vertices, so shading is flat; the whole house is one mesh and one draw call.
Units are metres; the front faces glTF +z (towards the street after placement).
"""
import os
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


OUT = opt('--out')
W = float(opt('--w', 6.0))          # width along the street (x)
D = float(opt('--d', 6.5))          # depth (Blender y; the front is at -y)
FLOORS = int(opt('--floors', 1))    # half-timber storeys above the plaster ground floor
WALL = opt('--wall', 'f1e3bf')     # plaster colour (hex): the warm pastels of the Zug lakefront
ROOF = opt('--roof', 'c8643c')     # roof tiles (hex): terracotta
if not OUT:
    sys.exit('usage: --out house.glb [--w 6] [--d 6.5] [--floors 1] [--wall f1e3bf] [--roof c8643c]')


def srgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


C = {
    'plaster': srgb(WALL), 'timber': srgb('7b4e30'), 'stone': srgb('d8ccb4'),
    'roof': srgb(ROOF), 'roofEdge': tuple(c * 0.78 for c in srgb(ROOF)[:3]) + (1.0,),
    'shutter': srgb('9a6a40'), 'chevron': srgb('f6efe0'),
    'blue': srgb('2d63b4'), 'white': srgb('fbf8f1'), 'glass': srgb('4a5562'), 'door': srgb('7a4a26'),
    'gold': srgb('d9a93a'),
}

# an empty scene: the factory one has a cube, a camera and a light that would be exported too
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


def world(a, b, c):
    return (a, b, c)


def box(x0, x1, y0, y1, z0, z1, color, skip_bottom=True):
    prism(rect(x0, x1, y0, y1), z0, z1, color, world, skip_back=skip_bottom)


def facade(side, off):
    """Map facade coords (u to the right seen from outside, v up, w outwards) to world."""
    hx, hy = W / 2 + off, D / 2 + off
    return {
        'front': lambda u, v, w: (u, -hy - w, v),
        'back': lambda u, v, w: (-u, hy + w, v),
        'left': lambda u, v, w: (-hx - w, -u, v),
        'right': lambda u, v, w: (hx + w, u, v),
    }[side]


def half(side):
    return W / 2 if side in ('front', 'back') else D / 2


def fbox(side, off, u0, u1, v0, v1, w0, w1, color):
    prism(rect(u0, u1, v0, v1), w0, w1, color, facade(side, off), skip_back=True)


def flat(side, off, poly, w, color):
    m = facade(side, off)
    face([m(u, v, w) for u, v in poly], color, m(poly[0][0], poly[0][1], w - 1))


def beam(side, off, p, q, t, w0, w1, color):
    """A timber beam of thickness t between two facade points."""
    d = Vector((q[0] - p[0], q[1] - p[1])).normalized()
    n = Vector((-d.y, d.x)) * t / 2
    poly = [(p[0] + n.x, p[1] + n.y), (p[0] - n.x, p[1] - n.y), (q[0] - n.x, q[1] - n.y), (q[0] + n.x, q[1] + n.y)]
    prism(poly, w0, w1, color, facade(side, off), skip_back=True)


def chevron(side, off, l, r, vm, w):
    """A white V on a shutter: two thin slanted quads."""
    c, t, dv = (l + r) / 2, 0.07, (r - l) * 0.35
    for a, b in (((l, vm + dv), (c, vm)), ((c, vm), (r, vm + dv))):
        flat(side, off, [(a[0], a[1] - t), (b[0], b[1] - t), (b[0], b[1] + t), (a[0], a[1] + t)], w, C['chevron'])


def window(side, off, uc, v0, v1, wd, mullion=False):
    fbox(side, off, uc - wd / 2 - 0.08, uc + wd / 2 + 0.08, v0 - 0.08, v1 + 0.08, 0, 0.05, C['white'])
    flat(side, off, rect(uc - wd / 2, uc + wd / 2, v0, v1), 0.055, C['glass'])
    if mullion:
        fbox(side, off, uc - 0.035, uc + 0.035, v0, v1, 0.05, 0.08, C['white'])
    sw = wd / 2 + 0.05
    for s in (-1, 1):
        a, b = sorted((uc + s * (wd / 2 + 0.1), uc + s * (wd / 2 + 0.1 + sw)))
        fbox(side, off, a, b, v0, v1, 0, 0.06, C['shutter'])
        chevron(side, off, a + 0.05, b - 0.05, v0 + (v1 - v0) * 0.45, 0.065)


# ---- body
G = 3.0                     # ground floor height
U = 2.6                     # each upper storey
JET = 0.12                  # the upper floors jut out over the ground floor
top = G + U * FLOORS
rise = 1.15 * W / 2         # steep roof
apex = top + rise
box(-W / 2 - 0.06, W / 2 + 0.06, -D / 2 - 0.06, D / 2 + 0.06, 0, 0.35, C['stone'])
box(-W / 2, W / 2, -D / 2, D / 2, 0.35, G, C['plaster'])
box(-W / 2 - JET, W / 2 + JET, -D / 2 - JET, D / 2 + JET, G, top, C['plaster'])
prism([(-W / 2 - JET, top), (W / 2 + JET, top), (0, apex)], -D / 2 - JET, D / 2 + JET, C['plaster'],
      lambda a, b, c: (a, -c, b))
for z in [G] + [G + U * (i + 1) for i in range(FLOORS)]:
    e = JET + 0.05
    box(-W / 2 - e, W / 2 + e, -D / 2 - e, D / 2 + e, z - 0.09, z + 0.09, C['timber'], skip_bottom=False)

# ---- half-timber, windows and doors on every side
for side in ('front', 'back', 'left', 'right'):
    h = half(side) + JET
    hg = half(side)
    # ground floor windows (the front has the door in the middle)
    gx = [-hg * 0.62, hg * 0.62] if side != 'front' else [-hg * 0.64, hg * 0.64]
    for uc in gx:
        window(side, 0, uc, 1.0, 2.15, 0.85, mullion=side == 'front')
    for f in range(FLOORS):
        z0 = G + U * f
        posts = [-h + 0.11, -h * 0.42, h * 0.42, h - 0.11] if side != 'front' else [-h + 0.11, -h * 0.47, h * 0.47, h - 0.11]
        for u in posts:
            fbox(side, JET, u - 0.11, u + 0.11, z0 + 0.09, z0 + U - 0.09, 0, 0.06, C['timber'])
        for v in (z0 + 0.5, z0 + U - 0.45):
            fbox(side, JET, -h, h, v - 0.08, v + 0.08, 0, 0.06, C['timber'])
        for uc in ((posts[0] + posts[1]) / 2, (posts[2] + posts[3]) / 2):
            window(side, JET, uc, z0 + 0.62, z0 + U - 0.57, 0.8, mullion=side == 'front')
        if side != 'front' or f > 0:
            a, b = posts[1] + 0.15, posts[2] - 0.15
            for p, q in (((a, z0 + 0.58), (b, z0 + U - 0.53)), ((a, z0 + U - 0.53), (b, z0 + 0.58))):
                beam(side, JET, p, q, 0.16, 0, 0.05, C['timber'])

# ---- front: arched door with stone surround, coat of arms, Erker
arch = lambda r, v0, n=6: [(r * __import__('math').cos(3.14159 * i / n), v0 + r * __import__('math').sin(3.14159 * i / n)) for i in range(n + 1)]
fr = facade('front', 0)
prism([(-0.75, 0.35)] + [(0.75, 0.35)] + arch(0.75, 1.75), 0, 0.04, C['stone'], fr, skip_back=True)
prism([(-0.6, 0.35)] + [(0.6, 0.35)] + arch(0.6, 1.75), 0.04, 0.07, C['door'], fr, skip_back=True)
fbox('front', 0, -0.03, 0.03, 0.35, 2.3, 0.07, 0.09, C['timber'])
shield = [(-0.22, 2.95), (0.22, 2.95), (0.22, 2.7), (0, 2.5), (-0.22, 2.7)]
prism(shield, 0, 0.04, C['gold'], fr, skip_back=True)
flat('front', 0, [(-0.17, 2.66), (0.17, 2.66), (0.17, 2.78), (-0.17, 2.78)], 0.045, C['blue'])
# Erker on the first upper floor
ef = facade('front', JET)
e0, e1, ed = G + 0.25, G + U - 0.3, 0.75
fbox('front', JET, -0.85, 0.85, e0, e1, 0, ed, C['timber'])
flat('front', JET, rect(-0.85, 0.85, e0 + 0.45, e1 - 0.3), ed + 0.005, C['white'])
flat('front', JET, rect(-0.7, 0.7, e0 + 0.55, e1 - 0.4), ed + 0.01, C['glass'])
fbox('front', JET, -0.03, 0.03, e0 + 0.55, e1 - 0.4, ed, ed + 0.03, C['white'])
prism([(0, e0), (ed, e0), (0, e0 - 0.55)], -0.45, 0.45, C['timber'], lambda a, b, c: ef(c, b, a))
FL, FR, BR, BL = ef(-1.0, e1, ed + 0.15), ef(1.0, e1, ed + 0.15), ef(1.0, e1, 0), ef(-1.0, e1, 0)
TL, TR = ef(-0.35, e1 + 0.6, 0.25), ef(0.35, e1 + 0.6, 0.25)
inside = ef(0, e1 + 0.1, 0.3)
face([FL, FR, TR, TL], C['roof'], inside)
face([BL, FL, TL], C['roof'], inside)
face([FR, BR, TR], C['roof'], inside)

# ---- gables: king post, collar beam and struts front and back
for side in ('front', 'back'):
    hw = W / 2 + JET
    zc = top + rise * 0.42
    wc = hw * (1 - 0.42) - 0.15
    fbox(side, JET, -0.09, 0.09, top + 0.09, apex - 0.5, 0, 0.06, C['timber'])
    fbox(side, JET, -wc, wc, zc - 0.08, zc + 0.08, 0, 0.06, C['timber'])
    for s in (-1, 1):
        beam(side, JET, (s * (hw - 0.5), top + 0.15), (s * 0.25, zc - 0.1), 0.15, 0, 0.05, C['timber'])

# ---- roof: two thick slabs with overhang, a chimney, a gold finial
oh, ohf, t = 0.55, 0.65, 0.22
s = rise / (W / 2 + JET)
ze = top - s * (oh - JET)
roofmap = lambda a, b, c: (a, -c, b)
for sgn in (-1, 1):
    xe = sgn * (W / 2 + oh)
    poly = [(xe, ze), (0, apex), (0, apex + t), (xe, ze + t)]
    prism(poly, -D / 2 - ohf, D / 2 + ohf, C['roof'], roofmap, cap_color=C['roofEdge'])
box(1.0, 1.6, 0.8, 1.4, apex - 1.6, apex - 0.2, C['stone'])
box(0.92, 1.68, 0.72, 1.48, apex - 0.2, apex - 0.05, C['timber'], skip_bottom=False)
yf = -D / 2 - ohf + 0.05
prism([(0, apex + t), (0.1, apex + t + 0.35), (0, apex + t + 0.7), (-0.1, apex + t + 0.35)], yf - 0.05, yf + 0.05,
      C['gold'], lambda a, b, c: (a, c, b))

# ---- one mesh, colours per face corner, flat shading
me = bpy.data.meshes.new('zug_house')
me.from_pydata([tuple(v) for v in verts], [], faces)
attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for fi, poly in enumerate(me.polygons):
    for li in poly.loop_indices:
        attr.data[li].color_srgb = cols[fi]
me.validate()
obj = bpy.data.objects.new('zug_house', me)
bpy.context.scene.collection.objects.link(obj)
mat = bpy.data.materials.new('zug_house')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.9
vc = nt.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.append(mat)

tris = sum(len(p.vertices) - 2 for p in me.polygons)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='MATERIAL',
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
    export_draco_position_quantization=14, export_draco_normal_quantization=8, export_draco_color_quantization=8,
)
print(f'built {OUT}: {tris} triangles, {W}x{D} m, {FLOORS} upper floor(s), height {apex + t:.1f} m')
