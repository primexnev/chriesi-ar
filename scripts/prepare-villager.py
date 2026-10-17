import bpy, glob, os
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=glob.glob('assets-source/characters/*/*.fbx')[0])
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.context.view_layer.objects.active=mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
lo=Vector((min(v.co.x for v in mesh.data.vertices),min(v.co.y for v in mesh.data.vertices),min(v.co.z for v in mesh.data.vertices)))
hi=Vector((max(v.co.x for v in mesh.data.vertices),max(v.co.y for v in mesh.data.vertices),max(v.co.z for v in mesh.data.vertices)))
h=hi.z-lo.z
for v in mesh.data.vertices: v.co=(v.co-Vector(((hi.x+lo.x)/2,(hi.y+lo.y)/2,lo.z)))/h
mesh.location=(0,0,0)
# One modest mobile texture; source files remain untouched.
tex=glob.glob('assets-source/characters/*/*texture.png')[0]
im=bpy.data.images.load(os.path.abspath(tex)); im.scale(1024,1024)
os.makedirs('design',exist_ok=True)
im.filepath_raw=os.path.abspath('design/villager-color.jpg'); im.file_format='JPEG'; im.save()
mat=bpy.data.materials.new('Villager'); mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=.85
node=mat.node_tree.nodes.new('ShaderNodeTexImage'); node.image=im
mat.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
mesh.data.materials.clear(); mesh.data.materials.append(mat)
arm=bpy.data.armatures.new('VillagerRig'); rig=bpy.data.objects.new('VillagerRig',arm); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; bpy.ops.object.mode_set(mode='EDIT')
def bone(n,a,b,parent=None):
 e=arm.edit_bones.new(n); e.head=a;e.tail=b
 if parent:e.parent=arm.edit_bones[parent]
bone('Hips',(0,0,.43),(0,0,.55))
bone('Spine',(0,0,.55),(0,0,.76),'Hips')
bone('Head',(0,0,.76),(0,0,.98),'Spine')
for side,sign in [('L',1),('R',-1)]:
 bone('UpperArm_'+side,(sign*.09,0,.74),(sign*.26,0,.74),'Spine')
 bone('Forearm_'+side,(sign*.26,0,.74),(sign*.40,0,.74),'UpperArm_'+side)
 bone('Hand_'+side,(sign*.40,0,.74),(sign*.46,0,.74),'Forearm_'+side)
 bone('Thigh_'+side,(sign*.085,0,.48),(sign*.085,0,.25),'Hips')
 bone('Shin_'+side,(sign*.085,0,.25),(sign*.085,0,.055),'Thigh_'+side)
 bone('Foot_'+side,(sign*.085,0,.055),(sign*.085,-.10,.025),'Shin_'+side)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
os.makedirs('public/assets/models',exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath('public/assets/models/villager.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=80)
print('RIG',len(arm.bones),'GROUPS',len(mesh.vertex_groups),'BYTES',os.path.getsize('public/assets/models/villager.glb'))
