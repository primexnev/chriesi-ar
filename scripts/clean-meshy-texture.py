"""Paint over stains that Meshy bakes onto surfaces it could not see in the source image (Blender).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/clean-meshy-texture.py -- \
      --src assets-source/stall/stall_lowpoly.glb --out assets-source/stall/stall_clean.glb

Meshy projects the image onto the model; faces hidden in the image (a counter top under baskets,
plank edges) pick up colour from whatever stood in front: brown smudges on cream cloth, pale
streaks on brown wood. Faces sharing a vertex form a piece (a cloth, a plank, a basket). A piece
that is mostly cream cloth gets its brown stains painted in its own clean cream; a piece that is
mostly wood gets its pale streaks painted in its own wood brown. Everything else (stripes, glass,
dark boards) is left alone. The result then goes through prepare-building.py.
"""
import colorsys
import os
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


SRC, OUT = opt('--src'), opt('--out')
if not SRC or not OUT:
    sys.exit('usage: --src in.glb --out out.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
img = next(i for i in bpy.data.images if i.size[0] > 0)
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)


def hsv(cols):
    return np.array([colorsys.rgb_to_hsv(*c) for c in cols])


def cream(h):
    return (h[:, 0] > 0.07) & (h[:, 0] < 0.17) & (h[:, 1] < 0.38) & (h[:, 2] > 0.72)


def wood(h):
    return (h[:, 0] > 0.02) & (h[:, 0] < 0.13) & (h[:, 1] > 0.42) & (h[:, 2] > 0.22) & (h[:, 2] < 0.8)


def face_pixels(uvs):
    """Texture pixels (row, col arrays) under one UV polygon."""
    x0, y0 = np.floor(uvs.min(0)).astype(int)
    x1, y1 = np.ceil(uvs.max(0)).astype(int)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
    if x1 <= x0 or y1 <= y0:
        return None
    ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    pts = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1)
    inside = np.zeros(len(pts), bool)
    for k in range(1, len(uvs) - 1):
        a, b, c = uvs[0], uvs[k], uvs[k + 1]
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (pts[:, 0] - c[0]) + (c[0] - b[0]) * (pts[:, 1] - c[1])) / d
        l2 = ((c[1] - a[1]) * (pts[:, 0] - c[0]) + (a[0] - c[0]) * (pts[:, 1] - c[1])) / d
        inside |= (l1 >= -0.01) & (l2 >= -0.01) & (1 - l1 - l2 >= -0.01)
    if inside.sum() < 2:
        return None
    return ys.ravel()[inside], xs.ravel()[inside]


stats = {'cloth': 0, 'wood': 0}
for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    me = obj.data
    uv = me.uv_layers.active.data
    pix = {}
    for poly in me.polygons:
        sel = face_pixels(np.array([uv[li].uv[:] for li in poly.loop_indices]) * [W, H])
        if sel is not None:
            pix[poly.index] = sel
    parent = {f: f for f in pix}

    def find(f):
        while parent[f] != f:
            parent[f] = parent[parent[f]]
            f = parent[f]
        return f

    by_vert = {}
    for f in pix:
        for v in me.polygons[f].vertices:
            if v in by_vert:
                parent[find(f)] = find(by_vert[v])
            else:
                by_vert[v] = f
    pieces = {}
    for f in pix:
        pieces.setdefault(find(f), []).append(f)
    for faces in pieces.values():
        rows = np.concatenate([pix[f][0] for f in faces])
        cols_ = np.concatenate([pix[f][1] for f in faces])
        rgb = px[rows, cols_, :3]
        hc = hsv(rgb)
        is_c, is_w = cream(hc), wood(hc)
        if is_c.mean() > 0.6:
            # cloth: brown and grey stains take the cloth's own cream
            clean = np.median(rgb[is_c], 0)
            # anything visibly off the cloth's own colour, soft stain edges included
            bad = (np.abs(rgb - clean).max(1) > 0.045) & (hc[:, 2] > 0.15)
            if bad.any():
                px[rows[bad], cols_[bad], :3] = clean
                stats['cloth'] += 1
        elif is_w.mean() > 0.6:
            # wood: pale streaks take the wood's own brown
            bad = (hc[:, 1] < 0.35) & (hc[:, 2] > 0.55)
            if bad.any():
                px[rows[bad], cols_[bad], :3] = np.median(rgb[is_w], 0)
                stats['wood'] += 1

img.pixels = px.ravel().tolist()
img.pack()
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB')
print(f"cleaned {stats['cloth']} cloth and {stats['wood']} wooden pieces -> {OUT}")
