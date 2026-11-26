"""Import the unrigged Meshy race runner, rig it and export public/assets/models/race_runner.glb.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/prepare-race-runner.py

The model is scaled to 1.6 m (game units are metres), feet at 0, facing -Y (glTF: +Z).
Joint heights (JOINTS_LOWPOLY) were measured on this mesh in T-pose, as fractions of the height.
Re-measure if the model changes. Animation is procedural in src/game/runner.ts; only the skeleton
is exported. Source: the low-poly Meshy remake (≈5k triangles); the texture is dilated (see dilated_texture) and reduced to 2048 px WebP.
Exported with Draco mesh compression (the app loads the Draco decoder).
"""
import bpy, glob, os, sys
import numpy as np
from mathutils import Vector

HEIGHT = 1.6
# `-- --tris N --tex N --out path` override the defaults (for comparing variants)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda k, d: type(d)(ARGS[ARGS.index(k) + 1]) if k in ARGS else d
TARGET_TRIS = opt('--tris', 20000)  # keep all of Meshy's ≈10k triangles: decimating tore the UV islands
TEX = opt('--tex', 2048)
SRC = opt('--src', 'assets-source/race_runner/Race_Runner_lowpoly.glb')
OUT = opt('--out', 'public/assets/models/race_runner.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
for o in list(bpy.context.scene.objects):
    if o is not mesh:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- normalise: feet at 0, centred, 1.6 m tall
vs = mesh.data.vertices
lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
k = HEIGHT / (hi.z - lo.z)
centre = Vector(((hi.x + lo.x) / 2, 0, lo.z))
for v in vs:
    v.co = (v.co - centre) * k

# ---- fewer triangles for phones (UVs are kept by the collapse decimator)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
dec = mesh.modifiers.new('decimate', 'DECIMATE')
dec.ratio = min(1.0, TARGET_TRIS / tris)
bpy.ops.object.modifier_apply(modifier=dec.name)

# ---- one 1024 px colour texture, matte (the metallic/roughness map is dropped)
src_img = next(i for i in bpy.data.images if 'metallic' not in i.name.lower())
for p in mesh.data.polygons:
    p.use_smooth = True


def dilated_texture(src, size):
    """Shrink the atlas without its black background bleeding into the hundreds of small UV islands.

    Meshy's texture is a mosaic of tiny islands on black. Plain downscaling (and later mipmapping)
    averages island edges with the black gaps: dark/white seams on the headband, a smeared face.
    So: rasterise the UV triangles into a mask, grow every island outwards into the gaps, then
    average down to `size`.
    """
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    # mask of texels covered by a UV triangle
    mask = np.zeros((h, w), dtype=bool)
    uv = mesh.data.uv_layers.active.data
    me = mesh.data
    me.calc_loop_triangles()
    for tri in me.loop_triangles:
        P = np.array([uv[l].uv[:] for l in tri.loops]) * (w, h)
        x0, y0 = np.floor(P.min(0)).astype(int) - 1
        x1, y1 = np.ceil(P.max(0)).astype(int) + 1
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
        if x1 <= x0 or y1 <= y0:
            continue
        ys, xs = np.mgrid[y0:y1, x0:x1] + 0.5
        (ax, ay), (bx, by), (cx, cy) = P
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        e = 1.5 / max(abs(d), 1) ** 0.5  # a texel of slack on every edge
        inside = (l1 >= -e) & (l2 >= -e) & (1 - l1 - l2 >= -e)
        mask[y0:y1, x0:x1] |= inside
    rgb = px[..., :3] * mask[..., None]
    filled = mask.astype(np.float32)
    for _ in range(48):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros_like(filled)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1)
            cnt += np.roll(np.roll(filled, dy, 0), dx, 1)
        grow = (filled == 0) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled[grow] = 1
    if not filled.all():
        rgb[filled == 0] = rgb[filled == 1].mean(0)
    k = w // size
    small = rgb.reshape(size, k, size, k, 3).mean((1, 3))
    out = np.concatenate([small, np.ones((size, size, 1), np.float32)], 2)
    img = bpy.data.images.new('RunnerTexture', size, size, alpha=False)
    img.pixels.foreach_set(out.ravel())
    img.pack()
    print('TEXTURE', w, '->', size, 'covered', round(float(mask.mean()), 3))
    return img


img = dilated_texture(src_img, TEX)
mat = bpy.data.materials.new('RaceRunner')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = .85
bsdf.inputs['Metallic'].default_value = 0
node = mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image = img
mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
mesh.data.materials.clear()
mesh.data.materials.append(mat)

# ---- skeleton (22 bones), measured in fractions of the height. Names are used by runner.ts.
# Joints measured on each mesh in T-pose (slices through the mesh at many heights).
# Low-poly Meshy remake of the same design (Smart Topology, 5k tris, Nov 2026): legs apart up to .33,
# arms at .65, neck .72-.76, head from .76.
JOINTS_LOWPOLY = dict(hip=.39, spine=.46, chest=.55, neck=.71, head=.76, arm=.65, sh=.11, elbow=.25, wrist=.35,
                      fingers=.418, leg_x=.078, knee=.19, ankle=.07, ball=-.06, toe=-.114)
arm = bpy.data.armatures.new('RunnerRig')
rig = bpy.data.objects.new('RunnerRig', arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None, connect=False):
    e = arm.edit_bones.new(name)
    e.head = Vector(head) * HEIGHT
    e.tail = Vector(tail) * HEIGHT
    if parent:
        e.parent = arm.edit_bones[parent]
        e.use_connect = connect


# Girl racer (same family, Nov 2026): arms a bit lower and shorter, head from .72.
JOINTS_GIRL = dict(hip=.36, spine=.43, chest=.52, neck=.68, head=.72, arm=.635, sh=.10, elbow=.23, wrist=.33,
                   fingers=.389, leg_x=.07, knee=.18, ankle=.065, ball=-.055, toe=-.13)
# Girl supporter with braids: arms higher (.685), longer neck, head from .785.
JOINTS_GIRL2 = dict(hip=.37, spine=.44, chest=.55, neck=.74, head=.785, arm=.685, sh=.12, elbow=.25, wrist=.33,
                    fingers=.374, leg_x=.065, knee=.18, ankle=.065, ball=-.05, toe=-.10)
J = {'lowpoly': JOINTS_LOWPOLY, 'girl': JOINTS_GIRL, 'girl2': JOINTS_GIRL2}[opt('--joints', 'lowpoly')]
bone('Hips', (0, 0, J['hip']), (0, 0, J['spine']))
bone('Spine', (0, 0, J['spine']), (0, 0, J['chest']), 'Hips', True)
bone('Chest', (0, 0, J['chest']), (0, 0, J['neck']), 'Spine', True)
bone('Neck', (0, 0, J['neck']), (0, 0, J['head']), 'Chest', True)
bone('Head', (0, 0, J['head']), (0, 0, 1.0), 'Neck', True)
a = J['arm']
for side, s in (('L', 1), ('R', -1)):
    bone('Shoulder_' + side, (s * .03, 0, a + .015), (s * J['sh'], 0, a), 'Chest')
    bone('UpperArm_' + side, (s * J['sh'], 0, a), (s * J['elbow'], 0, a - .002), 'Shoulder_' + side, True)
    bone('Forearm_' + side, (s * J['elbow'], 0, a - .002), (s * J['wrist'], 0, a - .003), 'UpperArm_' + side, True)
    bone('Hand_' + side, (s * J['wrist'], 0, a - .003), (s * J['fingers'], 0, a - .003), 'Forearm_' + side, True)
    x = J['leg_x']
    bone('Thigh_' + side, (s * x, 0, J['hip']), (s * (x + .002), 0, J['knee']), 'Hips')
    bone('Shin_' + side, (s * (x + .002), 0, J['knee']), (s * (x + .002), .005, J['ankle']), 'Thigh_' + side, True)
    bone('Foot_' + side, (s * (x + .002), .005, J['ankle']), (s * (x + .003), J['ball'], .02), 'Shin_' + side, True)
    bone('Toe_' + side, (s * (x + .003), J['ball'], .02), (s * (x + .003), J['toe'], .02), 'Foot_' + side, True)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')

# Heat weighting fails on this mesh (many loose islands), so weights come from the distance
# to each bone segment: the nearest bones share a vertex, closer ones get much more.
# Legs and arms never pull vertices from the other side of the body.
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length

segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.bones}
groups = {n: mesh.vertex_groups.get(n) or mesh.vertex_groups.new(name=n) for n in segs}
for v in mesh.data.vertices:
    p = v.co
    cand = []
    for n, (a, b) in segs.items():
        if n.endswith('_L') and p.x < -.01 * HEIGHT or n.endswith('_R') and p.x > .01 * HEIGHT:
            continue
        cand.append((seg_dist(p, a, b), n))
    cand.sort()
    best = max(cand[0][0], .004)
    near = [(d, n) for d, n in cand[:3] if d < best * 1.5 + .02 * HEIGHT]
    ws = [(1 / max(d, .004) ** 4, n) for d, n in near]
    total = sum(w for w, _ in ws)
    for w, n in ws:
        groups[n].add([v.index], w / total, 'REPLACE')
fixed = 0

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True, export_animations=False,
    export_image_format=opt('--fmt', 'WEBP'), export_image_quality=opt('--q', 80), export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10, export_draco_position_quantization=12, export_draco_normal_quantization=8,
)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
print('RIG', len(arm.bones), 'TRIS', tris, 'UNWEIGHTED_FIXED', fixed, 'BYTES', os.path.getsize(OUT))
