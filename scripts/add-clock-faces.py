"""Lay crisp clock faces over the blurry ones Meshy painted on a clock tower (Blender).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/add-clock-faces.py -- \
      --src tower_prepared.glb --out public/assets/models/zug_zytturm.glb

Run on a tower already through prepare-building.py (standing on z=0). The painted clock faces are
found as near-white faces of the texture on the tower's vertical walls (the sloped roof is left out), grouped by the side they
face; on each side a clock is laid just in front of the painted one, at its centre and size:
a rim in the tower's own timber brown, white dial, twelve hour marks and gold hands at ten past ten. The clock is a thick
disc sunk into the wall, so it sits flush wherever Meshy's wall bulges. Flat vertex colours, one
extra mesh (about 90 triangles per clock).
"""
import colorsys
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


SRC, OUT = opt('--src'), opt('--out')
if not SRC or not OUT:
    sys.exit('usage: --src tower.glb --out tower_clocks.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
tower = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
img = next(i for i in bpy.data.images if i.size[0] > 0)
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
me = tower.data
uv = me.uv_layers.active.data
mw = tower.matrix_world
zs = [(mw @ v.co).z for v in me.vertices]
z0, z1 = min(zs), max(zs)

# white faces on vertical walls (the sloped roof with its white stripes is left out), between
# a third and 85 % of the height, grouped by the side they face
sides = {}
for poly in me.polygons:
    c = mw @ poly.center
    if not (z0 + 0.3 * (z1 - z0) < c.z < z0 + 0.85 * (z1 - z0)):
        continue
    n = (mw.to_3x3() @ poly.normal).normalized()
    if abs(n.z) > 0.1:
        continue
    u = sum((uv[li].uv for li in poly.loop_indices), Vector((0, 0))) / poly.loop_total
    r, g, b = px[min(H - 1, int(u.y * H)), min(W - 1, int(u.x * W)), :3]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if v < 0.8 or s > 0.2:
        continue
    key = (round(n.x), round(n.y))
    if key == (0, 0):
        continue
    sides.setdefault(key, []).append((c, poly.area, [mw @ me.vertices[i].co for i in poly.vertices]))

verts, faces, cols = [], [], []
DIAL, MARK, GOLD = (0.97, 0.95, 0.9), (0.2, 0.17, 0.15), (0.85, 0.66, 0.2)
# the rim takes the tower's own timber brown: the median of the texture's wood-brown pixels
flat = px[:, :, :3].reshape(-1, 3)[::7]
hsv = np.array([colorsys.rgb_to_hsv(*c) for c in flat])
wood = flat[(hsv[:, 0] > 0.03) & (hsv[:, 0] < 0.12) & (hsv[:, 1] > 0.45) & (hsv[:, 2] > 0.25) & (hsv[:, 2] < 0.75)]
RIM = tuple(float(c) for c in np.median(wood, 0)) if len(wood) else (0.36, 0.22, 0.12)


def tri_fan(centre, pts, col):
    for k in range(len(pts)):
        i = len(verts)
        verts.extend([centre, pts[k], pts[(k + 1) % len(pts)]])
        faces.append([i, i + 1, i + 2])
        cols.append(col)


def quad(pts, col):
    i = len(verts)
    verts.extend(pts)
    faces.append([i, i + 1, i + 2, i + 3])
    cols.append(col)


# one dial per side: centre, radius and how far the wall stands out from the tower's axis
axis = Vector(((min((mw @ v.co).x for v in me.vertices) + max((mw @ v.co).x for v in me.vertices)) / 2,
               (min((mw @ v.co).y for v in me.vertices) + max((mw @ v.co).y for v in me.vertices)) / 2, 0))
dials = {}
for key, fs in sides.items():
    if len(fs) < 3:
        continue
    normal = Vector((key[0], key[1], 0)).normalized()
    area = sum(a for _, a, _ in fs)
    centre = sum((c * a for c, a, _ in fs), Vector()) / area
    front = max((p - axis).dot(normal) for _, _, ps in fs for p in ps)
    # the painted dial is round: its radius from the white area, a third larger so the rim covers its blurry edge
    dials[key] = (centre, math.sqrt(area / math.pi) * 1.32, front)
# all four clocks alike, as on a real clock tower: centred on each wall, at the measured height
# and size averaged over the sides where the painted dial could be measured
if dials:
    zc = sum(c.z for c, _, _ in dials.values()) / len(dials)
    rr = sum(r for _, r, _ in dials.values()) / len(dials)
    ff = sum(f for _, _, f in dials.values()) / len(dials)
    for key in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = Vector((key[0], key[1], 0))
        f = dials[key][2] if key in dials else ff
        dials[key] = (Vector((axis.x, axis.y, zc)) + n * f, rr, f)

placed = 0
for (nx, ny), (centre, R, front) in dials.items():
    normal = Vector((nx, ny, 0)).normalized()
    right = Vector((-normal.y, normal.x, 0))
    up = Vector((0, 0, 1))
    lateral = (centre - axis).dot(right)
    # the dial sits a hair in front of whatever stands out furthest inside its circle (Meshy's own
    # raised dial, its hands, a beam); behind it the clock is a thick disc sunk into the wall, so it
    # reads as mounted, with no gap seen from the side
    near = [(mw @ v.co) for v in me.vertices]
    near = [q for q in near if (q - axis).dot(normal) > front - R and math.hypot((q - axis).dot(right) - lateral, q.z - centre.z) < R]
    face = max([front] + [(q - axis).dot(normal) for q in near])
    o = Vector((axis.x, axis.y, centre.z)) + normal * (face + R * 0.03) + right * lateral

    def at(x, y, lift=0.0):
        return o + right * x + up * y + normal * lift

    seg = 16
    ring = lambda rr, lift=0.0: [at(math.cos(2 * math.pi * k / seg) * rr, math.sin(2 * math.pi * k / seg) * rr, lift) for k in range(seg)]
    outer, inner = ring(R), ring(R * 0.8)
    back = ring(R, -(face - front) - R * 0.25)  # reaches back into the wall
    for k in range(seg):
        quad([back[k], back[(k + 1) % seg], outer[(k + 1) % seg], outer[k]], RIM)
    for k in range(seg):
        quad([outer[k], outer[(k + 1) % seg], inner[(k + 1) % seg], inner[k]], RIM)
    tri_fan(at(0, 0), ring(R * 0.8), DIAL)
    for k in range(12):
        a = 2 * math.pi * k / 12
        d, t = Vector((math.cos(a), math.sin(a))), Vector((-math.sin(a), math.cos(a)))
        l0, l1, w = R * (0.66 if k % 3 else 0.6), R * 0.8, R * (0.05 if k % 3 else 0.07)
        quad([at(d.x * l0 + t.x * w, d.y * l0 + t.y * w, R * 0.01), at(d.x * l1 + t.x * w, d.y * l1 + t.y * w, R * 0.01),
              at(d.x * l1 - t.x * w, d.y * l1 - t.y * w, R * 0.01), at(d.x * l0 - t.x * w, d.y * l0 - t.y * w, R * 0.01)], MARK)
    for ang, ln, w in ((math.radians(90 - 300), 0.45, 0.07), (math.radians(90 - 60), 0.7, 0.05)):  # 10 and 2: ten past ten
        d, t = Vector((math.cos(ang), math.sin(ang))), Vector((-math.sin(ang), math.cos(ang)))
        quad([at(t.x * w * R, t.y * w * R, R * 0.02), at(d.x * ln * R + t.x * w * R * 0.4, d.y * ln * R + t.y * w * R * 0.4, R * 0.02),
              at(d.x * ln * R - t.x * w * R * 0.4, d.y * ln * R - t.y * w * R * 0.4, R * 0.02), at(-t.x * w * R, -t.y * w * R, R * 0.02)], GOLD)
    tri_fan(at(0, 0, R * 0.03), ring(R * 0.08, R * 0.03), GOLD)
    placed += 1

mesh = bpy.data.meshes.new('clocks')
mesh.from_pydata([tuple(v) for v in verts], [], faces)
attr = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for fi, p in enumerate(mesh.polygons):
    for li in p.loop_indices:
        attr.data[li].color_srgb = cols[fi] + (1.0,)
mesh.validate()
mat = bpy.data.materials.new('clocks')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.7
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
mesh.materials.append(mat)
bpy.context.scene.collection.objects.link(bpy.data.objects.new('clocks', mesh))

bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='MATERIAL',
    export_image_format='WEBP', export_image_quality=85,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
    export_draco_position_quantization=14, export_draco_normal_quantization=8, export_draco_color_quantization=8,
)
print(f'clocks: {placed} faces laid on sides {sorted(sides)}, rim {tuple(round(c, 2) for c in RIM)} -> {OUT}')
