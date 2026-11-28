"""Give a rigged character (from prepare-race-runner.py) smooth skin weights, and/or render it
with the arms up to check the shoulders.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/reweight-character.py -- \
      --src public/assets/models/girl_racer.glb [--out public/assets/models/girl_racer.glb] [--render check.png]

The bones stay exactly as they are (names, places, rolls), so src/game/runner.ts drives the new
weights the same way. Why: prepare-race-runner.py weights each vertex by its distance to the
nearest bones, because Blender's heat weighting fails on the Meshy meshes (many loose islands).
With the arms raised that tore the armpits: chest vertices went up with the arm, sleeve vertices
stayed on the chest. Here the heat weights are made on a closed voxel copy of the body (one
watertight surface, where heat weighting works) and copied onto the real mesh from the nearest
face, then cleaned (≤ 4 bones per vertex, left and right kept apart).
"""
import bpy, math, os, sys
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda k, d=None: ARGS[ARGS.index(k) + 1] if k in ARGS else d
SRC, OUT, RENDER = opt('--src'), opt('--out'), opt('--render')
VOXEL = float(opt('--voxel', 0.012))
# the sleeve ramp (fractions of the height): from this far inside the shoulder joint the arm starts
# to take over, this far outside it has the whole weight; only in this band around the arm height
RAMP_IN, RAMP_OUT = float(opt('--ramp-in', 0.0)), float(opt('--ramp-out', 0.04))
BAND_DOWN, BAND_UP = float(opt('--band-down', 0.08)), 0.10

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
height = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)


def select(*objs, active=None):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def reweight():
    # ---- a closed proxy of the body: voxel remesh of a copy (mesh in rest pose, world space)
    proxy = mesh.copy()
    proxy.data = mesh.data.copy()
    proxy.name = 'proxy'
    bpy.context.collection.objects.link(proxy)
    proxy.modifiers.clear()
    proxy.parent = None
    proxy.matrix_world = mesh.matrix_world.copy()
    proxy.vertex_groups.clear()
    select(proxy)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    proxy.data.remesh_voxel_size = VOXEL * height
    bpy.ops.object.voxel_remesh()
    # ---- heat weights on the proxy (the armature's own bones)
    select(proxy, rig, active=rig)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    missing = [b.name for b in rig.data.bones if b.name not in proxy.vertex_groups]
    print('PROXY verts', len(proxy.data.vertices), 'groups', len(proxy.vertex_groups), 'missing', missing)
    # ---- copy them onto the real mesh, from the nearest proxy face
    for g in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(g)
    for g in proxy.vertex_groups:
        mesh.vertex_groups.new(name=g.name)
    select(mesh)
    dt = mesh.modifiers.new('weights', 'DATA_TRANSFER')
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    bpy.ops.object.modifier_move_to_index(modifier='weights', index=0)
    bpy.ops.object.modifier_apply(modifier='weights')
    # ---- clean: left bones never move right-side vertices (and the other way), ≤ 4 bones, sum 1
    idx = {g.index: g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        x = (mesh.matrix_world @ v.co).x
        for ge in list(v.groups):
            n = idx[ge.group]
            if (n.endswith('_L') and x < -0.01 * height) or (n.endswith('_R') and x > 0.01 * height):
                ge.weight = 0.0
    # ---- the sleeves go with the arm: in T-pose they hang beside the chest, so the heat weights
    # left them on the chest and the raised arm came out from under a sleeve that stayed level.
    # Out past the shoulder joint, at arm height, the weight moves smoothly over to the arm.
    rw = rig.matrix_world
    names = [g.name for g in mesh.vertex_groups]
    gidx = {g.name: g.index for g in mesh.vertex_groups}
    for side, s in (('L', 1), ('R', -1)):
        up = rig.data.bones['UpperArm_' + side]
        sh = abs((rw @ up.head_local).x)
        arm_z = (rw @ up.head_local).z
        chain = {'UpperArm_' + side, 'Forearm_' + side, 'Hand_' + side}
        lo_x, hi_x = sh - RAMP_IN * height, sh + RAMP_OUT * height
        for v in mesh.data.vertices:
            p = mesh.matrix_world @ v.co
            if s * p.x <= 0 or not (arm_z - BAND_DOWN * height < p.z < arm_z + BAND_UP * height):
                continue
            t = min(1.0, max(0.0, (s * p.x - lo_x) / (hi_x - lo_x)))
            r = t * t * (3 - 2 * t)  # smoothstep
            if r <= 0:
                continue
            w = {names[ge.group]: ge.weight for ge in v.groups}
            arm_sum = sum(x for n, x in w.items() if n in chain)
            body_sum = sum(x for n, x in w.items() if n not in chain)
            total = arm_sum + body_sum or 1.0
            want_arm = max(arm_sum / total, r)
            for n, x in w.items():
                if n in chain:
                    mesh.vertex_groups[n].add([v.index], x / arm_sum * want_arm if arm_sum else 0.0, 'REPLACE')
                else:
                    mesh.vertex_groups[n].add([v.index], x / body_sum * (1 - want_arm) if body_sum else 0.0, 'REPLACE')
            if not arm_sum:
                mesh.vertex_groups['UpperArm_' + side].add([v.index], want_arm, 'REPLACE')
    select(mesh)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    unweighted = sum(1 for v in mesh.data.vertices if not v.groups)
    print('UNWEIGHTED', unweighted)
    bpy.data.objects.remove(proxy, do_unlink=True)


def cheer():
    """The game's «cheer» pose (src/game/runner.ts): arms swung up over the head, elbows bent a little.
    Actor axes → Blender: +x left = +X, +y up = +Z, +z forward = −Y."""
    select(rig)
    bpy.ops.object.mode_set(mode='POSE')
    # `--pose down`: standing, arms hanging 25° out (the idle pose); default: the cheer
    swing, down, elbow = {'down': (0.0, 1.18, 0.25), 'run': (0.8, 1.18, 1.2)}.get(opt('--pose'), (math.pi * 0.9, 1.18 - 0.3, 0.6))
    for side, s in (('L', 1), ('R', -1)):
        arm = Matrix.Rotation(-swing, 4, 'X') @ Matrix.Rotation(s * down, 4, 'Y')
        if '--twist' not in ARGS:
            # as the game turns it now: only the shortest turn to the same direction, no twist
            # about the arm's own length (twisting thinned the arm like a sweet wrapper)
            rest_dir = Vector((s, 0, 0))
            arm = rest_dir.rotation_difference(arm.to_3x3() @ rest_dir).to_matrix().to_4x4()
        fore = Matrix.Rotation(-s * elbow, 4, 'Z')
        if '--twist' not in ARGS:
            # as the game does it: the elbow folds the forearm towards the front (−Y in Blender)
            u = arm.to_3x3() @ Vector((s, 0, 0))
            lift = min(1.0, max(0.0, u.z / 0.6))
            axis = u.cross(Vector((-s * lift, -(1 - lift), 0)).normalized())
            fold = Matrix.Rotation(elbow, 4, axis.normalized()) if axis.length > 1e-3 else Matrix.Identity(4)
            fore = arm.inverted() @ fold @ arm
        bones = [('UpperArm_' + side, arm), ('Forearm_' + side, fore)]
        if '--twist' not in ARGS:
            # as the game does it: the hand turns the palm — towards the body on a hanging arm,
            # forwards (−Y) on a raised one. Actor −y (down) = Blender −Z.
            f = fold @ arm  # the forearm's turn in armature axes
            along = (fold.to_3x3() @ u).normalized()
            palm = f.to_3x3() @ Vector((0, 0, -1))
            up = min(1.0, max(0.0, along.z / 0.7))
            w = up * up * (3 - 2 * up)
            want = Vector((-s * (1 - w), -w, 0))
            palm -= along * palm.dot(along)
            want -= along * want.dot(along)
            twist = palm.rotation_difference(want).to_matrix().to_4x4() if palm.length > 1e-3 and want.length > 1e-3 else Matrix.Identity(4)
            bones.append(('Hand_' + side, f.inverted() @ twist @ f))
        for name, d in bones:
            pb = rig.pose.bones[name]
            bpy.context.view_layer.update()
            parent_delta = (pb.parent.matrix @ pb.parent.bone.matrix_local.inverted()).to_3x3().to_4x4()
            rest = pb.bone.matrix_local
            head = pb.parent.tail if pb.bone.use_connect else (pb.parent.matrix @ pb.parent.bone.matrix_local.inverted() @ rest.to_translation())
            rot = parent_delta @ d @ rest.to_3x3().to_4x4()
            pb.matrix = Matrix.Translation(head) @ rot
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')


def render(path):
    cheer()
    # three views side by side: front, side, back (copies of the posed character)
    views = [(rig, mesh)]
    for i, ang in enumerate((math.pi / 2, math.pi)):
        r2 = rig.copy()
        r2.data = rig.data
        m2 = mesh.copy()
        bpy.context.collection.objects.link(r2)
        bpy.context.collection.objects.link(m2)
        m2.parent = r2
        for md in m2.modifiers:
            if md.type == 'ARMATURE':
                md.object = r2
        r2.rotation_mode = 'XYZ'  # the glTF importer leaves objects in quaternion mode
        r2.rotation_euler = (rig.rotation_quaternion.to_euler() if rig.rotation_mode == 'QUATERNION' else rig.rotation_euler.copy())
        r2.rotation_euler.z += ang
        r2.location.x = (i + 1) * height * 0.8
        views.append((r2, m2))
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1500, 700
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.93, 0.9, 0.84)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = height * 2.55
    cam.location = (height * 0.8, -10, height * 0.62)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.camera = cam
    sc.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    print('RENDER', path)


if OUT:
    reweight()
    select(mesh, rig)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True, export_animations=False,
        export_image_format='WEBP', export_image_quality=85, export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=10, export_draco_position_quantization=12, export_draco_normal_quantization=8,
    )
    print('OUT', OUT, os.path.getsize(OUT))
if RENDER:
    render(RENDER)
