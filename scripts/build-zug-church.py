"""Build a true low-poly Zug church or chapel in Blender, built from the same parts as the houses
(scripts/build-zug-house.py): stone plinth, plaster ground floor, a jettied half-timber storey with
timber bands, shuttered windows with white chevrons, timbered gables, thick terracotta roof slabs and a
gold finial. Flat vertex colours in the Zug lakefront palette, no textures, one mesh.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/build-zug-church.py -- \
      --kind michael --out public/assets/models/zug_st_michael.glb

Kinds:
  michael     St. Michael: a two-storey timbered nave, a round choir at the back and a bell tower with a
              timbered belfry and a pointed spire (the Chriesigloggä hangs in it).
  liebfrauen  Liebfrauenkapelle: a small chapel, a round choir, a ridge turret with a needle spire.
  verena      St. Verena: a small chapel with a wooden porch over the door and a ridge turret with an onion top.

Faces share no vertices, so shading is flat. Units are metres; the door faces glTF +z, like the houses.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


OUT, KIND = opt('--out'), opt('--kind', 'michael')
if not OUT or KIND not in ('michael', 'liebfrauen', 'verena'):
    sys.exit('usage: --kind michael|liebfrauen|verena --out church.glb')


def srgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def darker(c, k=0.78):
    return tuple(x * k for x in c[:3]) + (1.0,)


WALL = {'michael': 'f4ede0', 'liebfrauen': 'ecd08e', 'verena': 'e9b98c'}[KIND]
ROOF = {'michael': 'b4532f', 'liebfrauen': 'c8643c', 'verena': 'c97443'}[KIND]
C = {
    'plaster': srgb(WALL), 'stone': srgb('d8ccb4'), 'timber': srgb('7b4e30'),
    'roof': srgb(ROOF), 'roofEdge': darker(srgb(ROOF)),
    'shutter': srgb('9a6a40'), 'chevron': srgb('f6efe0'),
    'white': srgb('fbf8f1'), 'glass': srgb('4a5562'), 'dark': srgb('3a3f47'), 'door': srgb('7a4a26'),
    'gold': srgb('d9a93a'), 'blue': srgb('2d63b4'),
}
G, U, JET = 3.0, 2.6, 0.12          # ground floor, each timbered storey, jetty: as on the houses

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


def facade(cx, cy, hx, hy, side):
    """Facade coords (u to the right seen from outside, v up, w outwards) of a block centred at cx, cy."""
    return {
        'front': lambda u, v, w: (cx + u, cy - hy - w, v),
        'back': lambda u, v, w: (cx - u, cy + hy + w, v),
        'left': lambda u, v, w: (cx - hx - w, cy - u, v),
        'right': lambda u, v, w: (cx + hx + w, cy + u, v),
    }[side]


SIDES = ('front', 'back', 'left', 'right')


def fbox(m, u0, u1, v0, v1, w0, w1, color):
    prism(rect(u0, u1, v0, v1), w0, w1, color, m, skip_back=True)


def flat(m, poly, w, color):
    face([m(u, v, w) for u, v in poly], color, m(poly[0][0], poly[0][1], w - 1))


def beam(m, p, q, t, color=None):
    """A timber beam of thickness t between two facade points."""
    d = Vector((q[0] - p[0], q[1] - p[1])).normalized()
    n = Vector((-d.y, d.x)) * t / 2
    poly = [(p[0] + n.x, p[1] + n.y), (p[0] - n.x, p[1] - n.y), (q[0] - n.x, q[1] - n.y), (q[0] + n.x, q[1] + n.y)]
    prism(poly, 0, 0.05, color or C['timber'], m, skip_back=True)


def chevron(m, l, r, vm, w):
    """A white V on a shutter: two thin slanted quads."""
    c, t, dv = (l + r) / 2, 0.07, (r - l) * 0.35
    for a, b in (((l, vm + dv), (c, vm)), ((c, vm), (r, vm + dv))):
        flat(m, [(a[0], a[1] - t), (b[0], b[1] - t), (b[0], b[1] + t), (a[0], a[1] + t)], w, C['chevron'])


def window(m, uc, v0, v1, wd, mullion=False, glass='glass'):
    """The house window: white frame, slate glass, brown shutters with white chevrons."""
    fbox(m, uc - wd / 2 - 0.08, uc + wd / 2 + 0.08, v0 - 0.08, v1 + 0.08, 0, 0.05, C['white'])
    flat(m, rect(uc - wd / 2, uc + wd / 2, v0, v1), 0.055, C[glass])
    if mullion:
        fbox(m, uc - 0.035, uc + 0.035, v0, v1, 0.05, 0.08, C['white'])
    sw = wd / 2 + 0.05
    for s in (-1, 1):
        a, b = sorted((uc + s * (wd / 2 + 0.1), uc + s * (wd / 2 + 0.1 + sw)))
        fbox(m, a, b, v0, v1, 0, 0.06, C['shutter'])
        chevron(m, a + 0.05, b - 0.05, v0 + (v1 - v0) * 0.45, 0.065)


def arched(uc, v0, v1, r, n=6):
    vc = v1 - r
    return [(uc - r, v0), (uc + r, v0)] + [(uc + r * math.cos(math.pi * i / n), vc + r * math.sin(math.pi * i / n))
                                           for i in range(n + 1)]


def door(m, r, spring):
    """The house door: an arch in a stone surround, a plank line down the middle."""
    prism(arched(0, 0.35, spring + r + 0.15, r + 0.15), 0, 0.04, C['stone'], m, skip_back=True)
    prism(arched(0, 0.35, spring + r, r), 0.04, 0.07, C['door'], m, skip_back=True)
    fbox(m, -0.03, 0.03, 0.35, spring + r - 0.05, 0.07, 0.09, C['timber'])


def shield(m, uc, v, s=1.0):
    """The Zug coat of arms as on the houses: a gold shield with a blue band."""
    prism([(uc - 0.22 * s, v + 0.45 * s), (uc + 0.22 * s, v + 0.45 * s), (uc + 0.22 * s, v + 0.2 * s), (uc, v),
           (uc - 0.22 * s, v + 0.2 * s)], 0, 0.04, C['gold'], m, skip_back=True)
    flat(m, rect(uc - 0.17 * s, uc + 0.17 * s, v + 0.16 * s, v + 0.28 * s), 0.045, C['blue'])


def finial(x, y, z, s=1.0):
    prism([(0, z), (0.1 * s, z + 0.35 * s), (0, z + 0.7 * s), (-0.1 * s, z + 0.35 * s)], y - 0.05, y + 0.05,
          C['gold'], lambda a, b, c: (x + a, c, b))


def bays(h, width=2.4):
    n = max(2, round(2 * h / width))
    posts = [-h + 0.11 + (2 * h - 0.22) * i / n for i in range(n + 1)]
    return posts, n


def hall(cx, cy, hx, hy, floors, door_r=0.75, no_ground=()):
    """A house body: plinth, plaster ground floor with shuttered windows, jettied half-timber storeys,
    timbered gables front and back, the roof slabs and a finial. The ridge runs along y; returns the apex."""
    top = G + U * floors
    box(cx - hx - 0.06, cx + hx + 0.06, cy - hy - 0.06, cy + hy + 0.06, 0, 0.35, C['stone'])
    box(cx - hx, cx + hx, cy - hy, cy + hy, 0.35, G, C['plaster'])
    box(cx - hx - JET, cx + hx + JET, cy - hy - JET, cy + hy + JET, G, top, C['plaster'])
    rise = 1.15 * hx
    apex = top + rise
    prism([(-hx - JET, top), (hx + JET, top), (0, apex)], -hy - JET, hy + JET, C['plaster'],
          lambda a, b, c: (cx + a, cy + c, b))
    for z in [G] + [G + U * (i + 1) for i in range(floors)]:
        e = JET + 0.05
        box(cx - hx - e, cx + hx + e, cy - hy - e, cy + hy + e, z - 0.09, z + 0.09, C['timber'], skip_bottom=False)
    for side in SIDES:
        hg = hx if side in ('front', 'back') else hy
        h = hg + JET
        # ground floor: shuttered windows in every bay but the door's
        posts, n = bays(hg)
        g = facade(cx, cy, hx, hy, side)
        for i in range(n):
            uc = (posts[i] + posts[i + 1]) / 2
            if side == 'front' and abs(uc) < door_r + 0.9 or side in no_ground:
                continue
            window(g, uc, 1.0, 2.15, 0.8, mullion=side == 'front')
        # timbered storeys: posts, two rails, windows and St. Andrew's crosses in turn
        m = facade(cx, cy, hx + JET, hy + JET, side)
        posts, n = bays(h)
        for f in range(floors):
            z0 = G + U * f
            for u in posts:
                fbox(m, u - 0.11, u + 0.11, z0 + 0.09, z0 + U - 0.09, 0, 0.06, C['timber'])
            for v in (z0 + 0.5, z0 + U - 0.45):
                fbox(m, -h, h, v - 0.08, v + 0.08, 0, 0.06, C['timber'])
            for i in range(n):
                a, b = posts[i] + 0.11, posts[i + 1] - 0.11
                if min(i, n - 1 - i) % 2 == 0:
                    window(m, (a + b) / 2, z0 + 0.62, z0 + U - 0.57, min(0.8, (b - a) * 0.36), mullion=side == 'front')
                else:
                    for p, q in (((a + 0.15, z0 + 0.58), (b - 0.15, z0 + U - 0.53)), ((a + 0.15, z0 + U - 0.53), (b - 0.15, z0 + 0.58))):
                        beam(m, p, q, 0.16)
    # gables: king post, collar beam and struts front and back
    for side in ('front', 'back'):
        m = facade(cx, cy, hx + JET, hy + JET, side)
        hw = hx + JET
        zc = top + rise * 0.42
        wc = hw * (1 - 0.42) - 0.15
        fbox(m, -0.09, 0.09, top + 0.09, apex - 0.5, 0, 0.06, C['timber'])
        fbox(m, -wc, wc, zc - 0.08, zc + 0.08, 0, 0.06, C['timber'])
        for s in (-1, 1):
            beam(m, (s * (hw - 0.5), top + 0.15), (s * 0.25, zc - 0.1), 0.15)
    # roof: two thick slabs with overhang
    oh, ohf, t = 0.55, 0.65, 0.22
    s = rise / (hx + JET)
    ze = top - s * (oh - JET)
    for sgn in (-1, 1):
        xe = sgn * (hx + oh)
        prism([(xe, ze), (0, apex), (0, apex + t), (xe, ze + t)], -hy - ohf, hy + ohf, C['roof'],
              lambda a, b, c: (cx + a, cy + c, b), cap_color=C['roofEdge'])
    door(facade(cx, cy, hx, hy, 'front'), door_r, 1.75 if door_r < 0.8 else 2.0)
    finial(cx, cy - hy - ohf + 0.05, apex + t)
    return top, apex + t


def apse(cx, y0, r, h, rise, n=5):
    """A round choir behind the wall at y0: plinth, plaster, a timber band, shuttered windows, a cone roof."""
    ring = [(cx + r * math.cos(math.pi * i / n), y0 + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    grow = lambda k: (lambda a, b, c: (cx + (a - cx) * k, y0 + (b - y0) * k, c))
    prism(ring, 0, 0.35, C['stone'], grow(1.03))
    prism(ring, 0.35, h, C['plaster'], grow(1.0), skip_back=True)
    prism(ring, G - 0.09, G + 0.09, C['timber'], grow(1.06), skip_back=False)
    tip = (cx, y0, h + rise)
    for i in range(n):
        (x0, ya), (x1, yb) = ring[i], ring[i + 1]
        p0 = (cx + (x0 - cx) * 1.15, y0 + (ya - y0) * 1.15, h - 0.2)
        p1 = (cx + (x1 - cx) * 1.15, y0 + (yb - y0) * 1.15, h - 0.2)
        face([p0, p1, tip], C['roof'], (cx, y0, h))
    for i in range(n):
        a = math.pi * (i + 0.5) / n
        d = r * math.cos(math.pi / (2 * n))
        mx, my, nx, ny = cx + d * math.cos(a), y0 + d * math.sin(a), math.cos(a), math.sin(a)
        m = lambda u, v, w, mx=mx, my=my, nx=nx, ny=ny: (mx + ny * u + nx * w, my - nx * u + ny * w, v)
        window(m, 0, 1.0, 2.15, 0.5)
        if h > G + 2.0:
            window(m, 0, G + 0.6, G + 1.8, 0.5)


def pyramid(cx, cy, hb, z0, z1, color):
    base = [(cx + hb * math.cos(math.pi / 4 + math.pi * i / 2), cy + hb * math.sin(math.pi / 4 + math.pi * i / 2), z0)
            for i in range(4)]
    for i in range(4):
        face([base[i], base[(i + 1) % 4], (cx, cy, z1)], color if i % 2 else C['roofEdge'], (cx, cy, z0))
    face(base, C['roofEdge'], (cx, cy, z1))


def onion(cx, cy, z0, scale, color):
    prof = [(0.42, 0), (0.6, 0.28), (0.55, 0.55), (0.3, 0.85), (0.1, 1.05), (0.06, 1.3)]
    n = 8
    rings = [[(cx + r * scale * math.cos(2 * math.pi * k / n), cy + r * scale * math.sin(2 * math.pi * k / n),
               z0 + z * scale) for k in range(n)] for r, z in prof]
    for a, b in zip(rings, rings[1:]):
        zc = (a[0][2] + b[0][2]) / 2
        for k in range(n):
            face([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]], color, (cx, cy, zc))
    face(rings[-1], color, (cx, cy, z0))
    return z0 + 1.3 * scale


def turret(cx, cy, z0, z1, hw, top):
    """A timbered bell turret: plaster, corner posts and a band, a dark louvred opening each side."""
    box(cx - hw, cx + hw, cy - hw, cy + hw, z0, z1, C['plaster'], skip_bottom=True)
    for side in SIDES:
        m = facade(cx, cy, hw, hw, side)
        for u in (-hw + 0.08, hw - 0.08):
            fbox(m, u - 0.08, u + 0.08, z0, z1, 0, 0.05, C['timber'])
        fbox(m, -hw, hw, z1 - 0.3, z1 - 0.15, 0, 0.05, C['timber'])
        fbox(m, -hw * 0.45 - 0.07, hw * 0.45 + 0.07, z1 - 1.25 - 0.07, z1 - 0.45 + 0.07, 0, 0.04, C['white'])
        flat(m, rect(-hw * 0.45, hw * 0.45, z1 - 1.25, z1 - 0.45), 0.045, C['dark'])
    box(cx - hw - 0.1, cx + hw + 0.1, cy - hw - 0.1, cy + hw + 0.1, z1, z1 + 0.15, C['timber'], skip_bottom=False)
    if top == 'spire':
        tip = z1 + 0.15 + hw * 5.2
        pyramid(cx, cy, hw * 1.5, z1 + 0.15, tip, C['roof'])
    else:
        tip = onion(cx, cy, z1 + 0.15, hw * 1.7, C['roof'])
    finial(cx, cy, tip - 0.05, 0.9)


if KIND == 'michael':
    HX, HY = 4.4, 7.6
    top, apex = hall(0, 0, HX, HY, 2, door_r=0.95)
    apse(0, HY + JET, 3.3, top - 0.4, 3.4)
    # the bell tower beside the front: plaster storeys with timber bands, a timbered belfry, a spire
    TX, TY, TW = -HX - 2.0, -HY + 2.2, 2.0
    TB, TH = 13.0, 16.2                                  # belfry from TB, eaves at TH
    box(TX - TW - 0.06, TX + TW + 0.06, TY - TW - 0.06, TY + TW + 0.06, 0, 0.35, C['stone'])
    box(TX - TW, TX + TW, TY - TW, TY + TW, 0.35, TB, C['plaster'])
    box(TX - TW - JET, TX + TW + JET, TY - TW - JET, TY + TW + JET, TB, TH, C['plaster'])
    for z in (G, G + 5.0, TB, TH):
        e = (JET if z >= TB else 0) + 0.05
        box(TX - TW - e, TX + TW + e, TY - TW - e, TY + TW + e, z - 0.09, z + 0.09, C['timber'], skip_bottom=False)
    for side in SIDES:
        g = facade(TX, TY, TW, TW, side)
        if side != 'right':
            window(g, 0, 1.0, 2.15, 0.7)
        window(g, 0, G + 1.4, G + 2.8, 0.7)
        window(g, 0, G + 5.9, G + 7.3, 0.7)
        m = facade(TX, TY, TW + JET, TW + JET, side)
        h = TW + JET
        for u in (-h + 0.11, 0, h - 0.11):
            fbox(m, u - 0.11, u + 0.11, TB + 0.09, TH - 0.09, 0, 0.06, C['timber'])
        fbox(m, -h, h, TB + 0.5 - 0.08, TB + 0.5 + 0.08, 0, 0.06, C['timber'])
        for uc in (-h / 2, h / 2):                          # the belfry openings, shuttered like windows
            window(m, uc, TB + 0.75, TH - 0.45, 0.62, glass='dark')
    shield(facade(TX, TY, TW, TW, 'front'), 0, G + 3.6, 1.6)
    pyramid(TX, TY, (TW + 0.55) * 1.414, TH + 0.09, TH + 7.6, C['roof'])
    finial(TX, TY, TH + 7.5, 1.4)
    shield(facade(0, 0, HX, HY, 'front'), 0, G - 0.62)

else:
    HX, HY = 2.7, 4.2
    top, apex = hall(0, 0, HX, HY, 1, door_r=0.6)
    apse(0, HY + JET, 2.0, top - 0.4, 2.2, n=4)
    if KIND == 'liebfrauen':
        turret(0, -HY + 1.4, apex - 1.4, apex + 1.3, 0.55, 'spire')
    else:
        # a wooden porch over the door: two posts, a beam, a small gable roof; an onion turret
        PY, PD, PW, PH = -HY, 1.8, 1.4, 2.6
        for sx in (-1, 1):
            box(sx * PW - 0.1, sx * PW + 0.1, PY - PD - 0.1, PY - PD + 0.1, 0, PH, C['timber'])
        box(-PW - 0.12, PW + 0.12, PY - PD - 0.12, PY - PD + 0.12, PH - 0.2, PH, C['timber'], skip_bottom=False)
        box(-PW - 0.3, PW + 0.3, PY - PD - 0.1, PY, 0, 0.18, C['stone'])
        pr, pt = 1.3, 0.16
        for sgn in (-1, 1):
            xe = sgn * (PW + 0.4)
            prism([(xe, PH - 0.35), (0, PH + pr), (0, PH + pr + pt), (xe, PH - 0.35 + pt)], PY - PD - 0.35, PY - JET,
                  C['roof'], lambda a, b, c: (a, c, b), cap_color=C['roofEdge'])
        m = facade(0, PY - PD + 0.1, PW, 0.0, 'front')
        fbox(m, -0.08, 0.08, PH, PH + pr - 0.2, 0, 0.1, C['timber'])
        for s in (-1, 1):
            beam(m, (s * (PW - 0.1), PH + 0.05), (s * 0.12, PH + pr - 0.35), 0.13)
        turret(0, HY - 1.4, apex - 1.4, apex + 1.1, 0.55, 'onion')

# ---- one mesh, colours per face corner, flat shading
me = bpy.data.meshes.new(f'zug_{KIND}')
me.from_pydata([tuple(v) for v in verts], [], faces)
attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for fi, poly in enumerate(me.polygons):
    for li in poly.loop_indices:
        attr.data[li].color_srgb = cols[fi]
me.validate()
obj = bpy.data.objects.new(f'zug_{KIND}', me)
bpy.context.scene.collection.objects.link(obj)
mat = bpy.data.materials.new(f'zug_{KIND}')
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
zs = [v.z for v in verts]
print(f'built {OUT}: {tris} triangles, height {max(zs):.1f} m')
