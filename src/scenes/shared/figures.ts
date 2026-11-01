import {
  AnimationClip,
  Box3,
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Material,
  type Object3D,
} from 'three';

/*
 * Rigged villagers (Meshy auto-rig, Mixamo bone names) and their clips, which are delivered as
 * separate animation-only GLBs. Story figures animate themselves: each frame the figure's speed
 * over the page picks idle / walk / run and the body turns towards where it is going, so the
 * story code keeps moving figures around exactly as it did with the paper placeholders.
 * Crowds that cheer by the hundred use a cheer cycle baked into morph targets instead (one
 * instanced draw call, no skinning).
 */

export type ClipName = 'walk' | 'run' | 'cheer';

interface Figure {
  root: Object3D;
  body: Object3D;
  mixer: AnimationMixer;
  actions: Partial<Record<ClipName, AnimationAction>>;
  current: ClipName | null;
  fixed: ClipName | null;
  last: Vector3 | null;
  speed: number;
  /** Body height in world units, to judge speed in "body heights per second". */
  height: number;
  idleFor: number;
}

const figures = new Set<Figure>();
if (import.meta.env.DEV) (window as unknown as { __figures: Set<Figure> }).__figures = figures;
const tmp = new Vector3();
const tmpQ = new Quaternion();

/**
 * Animate a rigged model that sits inside `root` (the fitted wrapper). `fixed` keeps one clip
 * looping (e.g. cheering spectators); otherwise the clip follows the figure's movement.
 */
export function animateFigure(root: Object3D, clips: AnimationClip[], fixed: ClipName | null = null): void {
  const body = root.children[0] ?? root;
  let skinned = false;
  root.traverse((o) => (skinned ||= (o as SkinnedMesh).isSkinnedMesh === true));
  if (!skinned || !clips.length) return;
  const mixer = new AnimationMixer(body);
  const actions: Figure['actions'] = {};
  for (const clip of clips) {
    const name = clip.name as ClipName;
    const action = mixer.clipAction(clip);
    action.enabled = true;
    actions[name] = action;
  }
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const height = Math.max(1e-6, box.max.y - box.min.y);
  root.userData.figure = true;
  const f: Figure = { root, body, mixer, actions, current: null, fixed, last: null, speed: 0, height, idleFor: 0 };
  if (fixed) play(f, fixed, Math.random());
  figures.add(f);
}

/**
 * Add a carried item (ladder, basket) placed as the story code always did, with the carrier
 * facing local +x. An animated figure's body (modelled facing +z) is turned to face +x and the
 * item re-parented to it, so the load follows the walker's heading; carriers keep their heading
 * when they stop instead of turning back to the reader.
 */
export function carry(root: Object3D, item: Object3D): void {
  root.add(item);
  const body = root.children[0];
  if (!root.userData.figure || !body || body === item) return;
  body.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  body.attach(item);
  root.userData.keepHeading = true;
}

function play(f: Figure, name: ClipName | null, startAt = 0): void {
  if (f.current === name) return;
  const prev = f.current ? f.actions[f.current] : undefined;
  const next = name ? f.actions[name] : undefined;
  if (next) {
    next.reset();
    next.time = startAt * next.getClip().duration;
    next.play();
    if (prev) next.crossFadeFrom(prev, 0.2, false);
  } else if (prev) {
    prev.fadeOut(0.25);
  }
  f.current = name;
}

/** Advance all figures; call once per frame with the story clock's delta. */
export function updateFigures(dt: number): void {
  if (dt <= 0) return;
  for (const f of figures) {
    if (!isInScene(f.root)) {
      f.idleFor += dt;
      // Pages are rebuilt for each read-through; forget figures that left the scene.
      if (f.idleFor > 3) figures.delete(f);
      continue;
    }
    f.idleFor = 0;
    f.root.getWorldPosition(tmp);
    if (!f.fixed) {
      if (f.last) {
        const dx = tmp.x - f.last.x;
        const dz = tmp.z - f.last.z;
        const v = Math.hypot(dx, dz) / dt;
        f.speed += (v - f.speed) * Math.min(1, dt * 8);
        const heights = f.speed / f.height;
        const want: ClipName | null = heights > 2.2 ? 'run' : heights > 0.35 ? 'walk' : null;
        play(f, want);
        const action = want ? f.actions[want] : undefined;
        if (action) action.timeScale = want === 'run' ? Math.min(1.6, heights / 4) + 0.4 : Math.min(1.4, heights / 1.2) + 0.3;
        // Turn the body (not the wrapper the story code positions) towards the movement.
        if (v / f.height > 0.2) {
          f.root.getWorldQuaternion(tmpQ);
          const wrapperYaw = Math.atan2(2 * (tmpQ.w * tmpQ.y + tmpQ.x * tmpQ.z), 1 - 2 * (tmpQ.y * tmpQ.y + tmpQ.x * tmpQ.x));
          const target = Math.atan2(dx, dz) - wrapperYaw;
          f.body.rotation.y += shortest(target - f.body.rotation.y) * Math.min(1, dt * 10);
        } else if (!want && !f.root.userData.keepHeading) {
          f.body.rotation.y += shortest(0 - f.body.rotation.y) * Math.min(1, dt * 3);
        }
      }
      f.last = (f.last ?? new Vector3()).copy(tmp);
    }
    f.mixer.update(dt);
  }
}

function shortest(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function isInScene(o: Object3D): boolean {
  let p: Object3D | null = o;
  while (p) {
    if ((p as { isScene?: boolean }).isScene) return true;
    p = p.parent;
  }
  return false;
}

/**
 * A cheering crowd member as an InstancedMesh: `keys` poses of the cheer clip baked into morph
 * targets of the rig's mesh (in the model's own space). Use `cheerWeights` to play the cycle.
 */
export function bakeCheerFigure(model: Object3D, clip: AnimationClip, capacity: number, keys = 4): InstancedMesh | null {
  let skinned: SkinnedMesh | null = null;
  model.traverse((o) => {
    if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
  });
  if (!skinned) return null;
  const sm = skinned as SkinnedMesh;
  const mixer = new AnimationMixer(model);
  const action = mixer.clipAction(clip).play();
  const toModel = new Matrix4();
  const count = sm.geometry.attributes.position.count;
  const poses: Float32Array[] = [];
  const v = new Vector3();
  for (let k = 0; k < keys; k++) {
    action.time = (clip.duration * k) / keys;
    mixer.update(0);
    model.updateMatrixWorld(true);
    sm.skeleton.update();
    toModel.copy(model.matrixWorld).invert().multiply(sm.matrixWorld);
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      sm.getVertexPosition(i, v).applyMatrix4(toModel);
      out.set([v.x, v.y, v.z], i * 3);
    }
    poses.push(out);
  }
  mixer.stopAllAction();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(poses[0], 3));
  for (const name of ['uv', 'normal'] as const) {
    const a = sm.geometry.getAttribute(name);
    if (a) geo.setAttribute(name, a);
  }
  if (sm.geometry.index) geo.setIndex(sm.geometry.index);
  geo.morphAttributes.position = poses.slice(1).map((p) => new BufferAttribute(p, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const im = new InstancedMesh(geo, sm.material as Material, capacity);
  im.morphTargetInfluences = new Array(keys - 1).fill(0);
  im.frustumCulled = false;
  return im;
}

const weightsHolder = new Mesh();
/** Morph weights for phase `p` (0…1 round the cheer cycle) of a figure baked with `keys` poses. */
export function cheerWeights(p: number, keys = 4): Mesh {
  const w = (weightsHolder.morphTargetInfluences ??= []);
  w.length = keys - 1;
  w.fill(0);
  const x = (((p % 1) + 1) % 1) * keys;
  const a = Math.floor(x);
  const t = x - a;
  const b = (a + 1) % keys;
  // Pose 0 is the base; poses 1…keys-1 are the morph targets.
  if (a > 0) w[a - 1] += 1 - t;
  if (b > 0) w[b - 1] += t;
  return weightsHolder;
}
