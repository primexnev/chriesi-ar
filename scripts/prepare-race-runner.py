"""Import the unrigged Meshy race runner, rig it and export public/assets/models/race_runner.glb.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/prepare-race-runner.py

The model is scaled to 1.6 m (game units are metres), feet at 0, facing -Y (glTF: +Z).
Joint heights below were measured on this mesh in T-pose, as fractions of the height:
ankles .075, knees .23, crotch .38, hip joints .43, shoulders .645, neck .73, big head from .745.
Re-measure if the model changes. Animation is procedural in src/game/runner.ts; only the skeleton
is exported. The mesh is decimated to ≈ 5k triangles and the texture reduced to 1024 px.
No Draco: the app does not ship a Draco decoder path yet, and the file is small enough without it.
"""
import bpy, glob, os
from mathutils import Vector

HEIGHT = 1.6
TARGET_TRIS = 5200
SRC = glob.glob('assets-source/race_runner/*.glb')[0]
OUT = 'public/assets/models/race_runner.glb'

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
img = src_img.copy()
img.scale(1024, 1024)
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


bone('Hips', (0, 0, .43), (0, 0, .5))
bone('Spine', (0, 0, .5), (0, 0, .58), 'Hips', True)
bone('Chest', (0, 0, .58), (0, 0, .7), 'Spine', True)
bone('Neck', (0, 0, .7), (0, 0, .745), 'Chest', True)
bone('Head', (0, 0, .745), (0, 0, 1.0), 'Neck', True)
for side, s in (('L', 1), ('R', -1)):
    bone('Shoulder_' + side, (s * .03, 0, .66), (s * .09, 0, .645), 'Chest')
    bone('UpperArm_' + side, (s * .09, 0, .645), (s * .235, 0, .643), 'Shoulder_' + side, True)
    bone('Forearm_' + side, (s * .235, 0, .643), (s * .37, 0, .642), 'UpperArm_' + side, True)
    bone('Hand_' + side, (s * .37, 0, .642), (s * .44, 0, .642), 'Forearm_' + side, True)
    bone('Thigh_' + side, (s * .08, 0, .43), (s * .082, 0, .23), 'Hips')
    bone('Shin_' + side, (s * .082, 0, .23), (s * .082, .005, .075), 'Thigh_' + side, True)
    bone('Foot_' + side, (s * .082, .005, .075), (s * .083, -.07, .02), 'Shin_' + side, True)
    bone('Toe_' + side, (s * .083, -.07, .02), (s * .083, -.135, .02), 'Foot_' + side, True)
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
    export_image_format='JPEG', export_jpeg_quality=82,
)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
print('RIG', len(arm.bones), 'TRIS', tris, 'UNWEIGHTED_FIXED', fixed, 'BYTES', os.path.getsize(OUT))
