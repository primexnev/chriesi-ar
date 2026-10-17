"""Import the unrigged Meshy villager, rig it and export public/assets/models/villager.glb.

Run from the repo root:  blender -b -P scripts/prepare-villager.py
(or with the `bpy` Python module:  python3 -c "import bpy; exec(open('scripts/prepare-villager.py').read())")

The model is normalised to 1 unit tall, feet at 0, facing -Y (glTF: +Z).
Joint positions below were measured on this mesh (T-pose): arms at 0.655 height,
crotch at 0.29, knees at 0.195, ankles at 0.075. Re-measure if the model changes.
Animation is procedural in src/scenes/intro/motion.ts; only the skeleton is exported.
"""
import bpy, glob, os
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=glob.glob('assets-source/characters/*/*.fbx')[0])
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
for o in list(bpy.context.scene.objects):
    if o is not mesh:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
mesh.parent = None
vs = mesh.data.vertices
lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
h = hi.z - lo.z
centre = Vector(((hi.x + lo.x) / 2, (hi.y + lo.y) / 2, lo.z))
for v in vs:
    v.co = (v.co - centre) / h
mesh.location = (0, 0, 0)

# One modest mobile texture; source files remain untouched.
tex = glob.glob('assets-source/characters/*/*texture.png')[0]
im = bpy.data.images.load(os.path.abspath(tex))
im.scale(1024, 1024)
os.makedirs('design', exist_ok=True)
im.filepath_raw = os.path.abspath('design/villager-color.jpg')
im.file_format = 'JPEG'
im.save()
mat = bpy.data.materials.new('Villager')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = .85
node = mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image = im
mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
mesh.data.materials.clear()
mesh.data.materials.append(mat)

# ---- skeleton (22 bones). Names are used by motion.ts.
arm = bpy.data.armatures.new('VillagerRig')
rig = bpy.data.objects.new('VillagerRig', arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None, connect=False, roll=0.0):
    e = arm.edit_bones.new(name)
    e.head = head
    e.tail = tail
    e.roll = roll
    if parent:
        e.parent = arm.edit_bones[parent]
        e.use_connect = connect


bone('Hips', (0, 0, .37), (0, 0, .47))
bone('Spine', (0, 0, .47), (0, 0, .57), 'Hips', True)
bone('Chest', (0, 0, .57), (0, 0, .705), 'Spine', True)
bone('Neck', (0, 0, .705), (0, 0, .75), 'Chest', True)
bone('Head', (0, 0, .75), (0, 0, .98), 'Neck', True)
for side, s in (('L', 1), ('R', -1)):
    bone('Shoulder_' + side, (s * .02, 0, .665), (s * .11, .004, .655), 'Chest')
    bone('UpperArm_' + side, (s * .11, .004, .655), (s * .245, .004, .655), 'Shoulder_' + side, True)
    bone('Forearm_' + side, (s * .245, .004, .655), (s * .375, 0, .652), 'UpperArm_' + side, True)
    bone('Hand_' + side, (s * .375, 0, .652), (s * .462, 0, .652), 'Forearm_' + side, True)
    bone('Thigh_' + side, (s * .062, -.004, .37), (s * .07, -.002, .195), 'Hips')
    bone('Shin_' + side, (s * .07, -.002, .195), (s * .075, .012, .075), 'Thigh_' + side, True)
    bone('Foot_' + side, (s * .075, .012, .075), (s * .078, -.075, .022), 'Shin_' + side, True)
    bone('Toe_' + side, (s * .078, -.075, .022), (s * .08, -.13, .022), 'Foot_' + side, True)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# Every vertex must follow at least one bone (heat weighting can miss loose islands).
groups = {g.index: g.name for g in mesh.vertex_groups}
heads = {b.name: (b.head_local + b.tail_local) / 2 for b in arm.bones}
fixed = 0
for v in mesh.data.vertices:
    if sum(g.weight for g in v.groups) < 1e-4:
        name = min(heads, key=lambda n: (heads[n] - v.co).length)
        mesh.vertex_groups[name].add([v.index], 1.0, 'REPLACE')
        fixed += 1

os.makedirs('public/assets/models', exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath('public/assets/models/villager.glb'), export_format='GLB',
    use_selection=True, export_animations=False, export_image_format='JPEG', export_jpeg_quality=80,
)
print('RIG', len(arm.bones), 'GROUPS', len(mesh.vertex_groups), 'UNWEIGHTED_FIXED', fixed,
      'BYTES', os.path.getsize('public/assets/models/villager.glb'))
