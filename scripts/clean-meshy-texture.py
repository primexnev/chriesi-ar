"""Paint over stains that Meshy bakes onto surfaces it could not see in the source image (Blender).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/clean-meshy-texture.py -- \
      --src assets-source/stall/stall_lowpoly.glb --out assets-source/stall/stall_clean.glb

Meshy projects the image onto the model; faces hidden in the image (a counter top under baskets,
plank edges) pick up colour from whatever stood in front: brown smudges on cream cloth, pale
streaks on brown wood. Faces sharing a vertex form a piece (a cloth, a plank, a basket). A piece
that is mostly cream cloth gets its brown stains painted in its own clean cream; a piece that is
mostly wood gets its pale streaks painted in its own wood brown; a piece in two tones of blue and
white (the Zug roof pattern) gets every pixel snapped to clean blue or white, and a big blue triangle
across a roof corner (where Meshy's stripes break) is painted plain roof blue. Everything else (stripes, glass,
dark boards) is left alone. The result then goes through prepare-building.py.
"""
import colorsys
import math
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
roof_blue, smeared = [], []
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
        elif (blue := (hc[:, 0] > 0.53) & (hc[:, 0] < 0.7) & (hc[:, 1] > 0.3)).mean() > 0.25 and (blue | (hc[:, 1] < 0.18)).mean() > 0.8:
            # a two-tone roof (the blue and white Zug pattern): every pixel becomes clean blue or
            # clean white, which sharpens the zigzags and removes the smears between them
            b, w = np.median(rgb[blue], 0), np.median(rgb[hc[:, 1] < 0.18], 0) if (hc[:, 1] < 0.18).any() else np.array([0.95, 0.95, 0.95])
            light = (rgb @ [0.3, 0.59, 0.11]) > (b @ [0.3, 0.59, 0.11] + w @ [0.3, 0.59, 0.11]) / 2
            px[rows, cols_, :3] = np.where(light[:, None], w, b)
            stats['roof'] = stats.get('roof', 0) + 1
            roof_blue.append(b)
        elif ((hc[:, 0] > 0.5) & (hc[:, 0] < 0.72) & (hc[:, 1] > 0.06)).mean() > 0.6 and (hc[:, 2] > 0.6).mean() > 0.6:
            # pale, streaky blue: a roof patch where Meshy stretched the pattern; painted plain
            # roof blue once all the clean roof pieces are known (below)
            smeared.append((rows, cols_))
        elif is_w.mean() > 0.6:
            # wood: pale streaks take the wood's own brown
            bad = (hc[:, 1] < 0.35) & (hc[:, 2] > 0.55)
            if bad.any():
                px[rows[bad], cols_[bad], :3] = np.median(rgb[is_w], 0)
                stats['wood'] += 1

if roof_blue:
    blue = np.median(np.array(roof_blue), 0)
    for rows, cols_ in smeared:
        px[rows, cols_, :3] = blue
    # big roof triangles across a corner of a four-sided roof: Meshy projected the pattern over
    # the corner, so its stripes break there; such a blue face is painted plain roof blue
    for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        me = obj.data
        uv = me.uv_layers.active.data
        rot = obj.matrix_world.to_3x3()
        sloped = [p for p in me.polygons if (rot @ p.normal).normalized().z > 0.2]
        typical = float(np.median([p.area for p in sloped])) if sloped else 0
        for poly in sloped:
            n = (rot @ poly.normal).normalized()
            h = math.atan2(n.y, n.x) % (math.pi / 2)
            diagonal = math.pi / 8 < h < 3 * math.pi / 8
            if not diagonal or poly.area < 8 * typical:
                continue
            sel = face_pixels(np.array([uv[li].uv[:] for li in poly.loop_indices]) * [W, H])
            if sel is None:
                continue
            hc = hsv(px[sel][:, :3])
            if ((hc[:, 0] > 0.5) & (hc[:, 0] < 0.72) & (hc[:, 1] > 0.06)).mean() > 0.4:
                px[sel[0], sel[1], :3] = blue
                stats['smeared'] = stats.get('smeared', 0) + 1

img.pixels = px.ravel().tolist()
img.pack()
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB')
print(f"cleaned {stats['cloth']} cloth, {stats['wood']} wooden and {stats.get('roof', 0)} two-tone roof pieces, {stats.get('smeared', 0)} smeared roof patches -> {OUT}")
