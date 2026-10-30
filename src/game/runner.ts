import { AnimationMixer, BoxGeometry, CapsuleGeometry, Group, MathUtils, Quaternion, SphereGeometry, Vector3, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { ladder } from '../scenes/shared/placeholders';
import { mesh } from '../scenes/shared/placeholders';
import { PALETTE } from '../scenes/shared/palette';

/**
 * Race character (player and rivals). Units are metres, the runner faces −z.
 *
 * Placeholder: a papercut-style figure with pivots named `leg_L`, `leg_R`, `arm_L`, `arm_R`,
 * `torso` and a `carry` slot on the right shoulder for the ladder. The rigged runner
 * (scripts/prepare-race-runner.py: bones `Hips`, `Spine`, `Chest`, `Head`, `Thigh_L`, `Shin_L`,
 * `UpperArm_L`, `Forearm_L` …, facing +z) is driven by the same pose channels. A delivered GLB with clips
 * named like `RunnerPose` (run, jump, slide, stumble, idle, climb, pick, cheer) is played with
 * an AnimationMixer instead; without clips the same procedural pose code drives its bones.
 */
export type RunnerPose = 'idle' | 'run' | 'jump' | 'slide' | 'stumble' | 'climb' | 'pick' | 'cheer';
export type Reach = 'up' | 'down' | 'left' | 'right' | null;

export const LADDER_LENGTH = 4.2;
const STRIDE = 1.5;

export function runnerPlaceholder(shirt: number, seed = 0): Group {
  const g = new Group();
  g.name = 'runner';
  const hips = new Group();
  hips.name = 'hips';
  hips.position.y = 0.92;
  g.add(hips);

  const torso = new Group();
  torso.name = 'torso';
  hips.add(torso);
  const chest = mesh(new CapsuleGeometry(0.2, 0.42, 3, 8), shirt, 'body');
  chest.position.y = 0.36;
  const head = mesh(new SphereGeometry(0.17, 10, 8), PALETTE.skin, 'head');
  head.position.y = 0.86;
  const hair = mesh(new SphereGeometry(0.175, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0x5a3a22, 0x2b2d42, 0xd9a441][seed % 3]);
  hair.position.y = 0.88;
  torso.add(chest, head, hair);
  // Zug colours: white–blue headband for the player and rivals alike.
  const band = mesh(new BoxGeometry(0.36, 0.05, 0.36), PALETTE.zugBlue);
  band.position.y = 0.95;
  torso.add(band);

  const limb = (name: string, x: number, y: number, len: number, r: number, color: number, parent: Object3D, foot?: number) => {
    const pivot = new Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    const part = mesh(new CapsuleGeometry(r, len - 2 * r, 2, 6), color);
    part.position.y = -len / 2;
    pivot.add(part);
    if (foot !== undefined) {
      const shoe = mesh(new BoxGeometry(0.14, 0.08, 0.26), foot);
      shoe.position.set(0, -len, -0.05);
      pivot.add(shoe);
    }
    parent.add(pivot);
    return pivot;
  };
  limb('leg_L', -0.11, 0, 0.88, 0.085, 0x34495e, hips, 0x3a2a1a);
  limb('leg_R', 0.11, 0, 0.88, 0.085, 0x34495e, hips, 0x3a2a1a);
  limb('arm_L', -0.27, 0.52, 0.62, 0.065, shirt, torso);
  limb('arm_R', 0.27, 0.52, 0.62, 0.065, shirt, torso);

  const carry = new Group();
  carry.name = 'carry';
  carry.position.set(0.3, 0.62, 0);
  torso.add(carry);
  return g;
}

/** A wooden picking ladder in metres, standing along +y, rails at ±x. */
export function gameLadder(): Group {
  const l = ladder(0.075);
  l.scale.setScalar(LADDER_LENGTH / 0.075);
  // A child's ladder: ≈ 0.5 m between the rails.
  l.scale.x *= 0.65;
  const g = new Group();
  g.name = 'ladder';
  g.add(l);
  return g;
}

interface Joint {
  node: Object3D;
  x: number;
  z: number;
}

/** Pose channels shared by the placeholder and the rig. Angles in radians, `+` = forward. */
interface Pose {
  hipsY: number;
  /** Torso lean, + = backwards. */
  lean: number;
  legL: number;
  legR: number;
  kneeL: number;
  kneeR: number;
  /** Arm swing from hanging down, + = forwards and up. */
  armL: number;
  armR: number;
  /** Sideways raise (placeholder sign convention: left negative, right positive). */
  armLz: number;
  armRz: number;
  elbowL: number;
  elbowR: number;
}

const HIPS_Y = 0.92;
const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
const AZ = new Vector3(0, 0, 1);
const qa = (axis: Vector3, a: number) => new Quaternion().setFromAxisAngle(axis, a);

/**
 * Sets bone rotations in actor axes (+x = character's left, +y up, +z forward), independent of
 * bone rolls: each bone's rotation is a delta on top of its parent's, measured from the T-pose.
 */
class RigDriver {
  private bones = new Map<string, Object3D>();
  private restC = new Map<Object3D, Quaternion>();
  private parentInv = new Map<Object3D, Quaternion>();

  constructor(actor: Object3D) {
    actor.updateMatrixWorld(true);
    const actorInv = actor.getWorldQuaternion(new Quaternion()).invert();
    const inActor = (o: Object3D) => actorInv.clone().multiply(o.getWorldQuaternion(new Quaternion()));
    actor.traverse((o) => {
      if ((o as { isBone?: boolean }).isBone) this.bones.set(o.name, o);
    });
    for (const b of this.bones.values()) {
      this.restC.set(b, inActor(b));
      this.parentInv.set(b, inActor(b.parent!).invert());
    }
  }

  static fits(model: Object3D): boolean {
    let found = false;
    model.traverse((o) => {
      if ((o as { isBone?: boolean }).isBone && o.name === 'Hips') found = true;
    });
    return found;
  }

  set(name: string, d: Quaternion): void {
    const b = this.bones.get(name);
    if (b) b.quaternion.copy(this.parentInv.get(b)!).multiply(d).multiply(this.restC.get(b)!);
  }

  apply(p: Pose): void {
    // Forward lean of the actor is a positive rotation about +x; the pose channel leans back.
    this.set('Hips', new Quaternion());
    this.set('Spine', qa(AX, -p.lean * 0.5));
    this.set('Chest', qa(AX, -p.lean * 0.5));
    this.set('Neck', new Quaternion());
    this.set('Head', qa(AX, p.lean * 0.35));
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      const leg = side === 'L' ? p.legL : p.legR;
      const knee = side === 'L' ? p.kneeL : p.kneeR;
      const swing = side === 'L' ? p.armL : p.armR;
      const raise = Math.abs(side === 'L' ? p.armLz : p.armRz);
      const elbow = side === 'L' ? p.elbowL : p.elbowR;
      // Legs hang along −y: a forward swing turns them towards +z.
      this.set('Thigh_' + side, qa(AX, -leg));
      this.set('Shin_' + side, qa(AX, knee));
      this.set('Foot_' + side, qa(AX, -knee * 0.3));
      // T-pose arm → down to the side, then swung forward; the elbow bends towards the front.
      this.set('UpperArm_' + side, qa(AX, -swing).multiply(qa(AZ, -s * Math.max(0, 1.35 - raise))));
      this.set('Forearm_' + side, qa(AY, -s * elbow));
    }
  }
}

export class Runner {
  readonly root = new Group();
  readonly ladder = gameLadder();
  pose: RunnerPose = 'idle';
  reach: Reach = null;
  /** Ladder on the shoulder (true) or handed over to the orchard code (false). */
  carrying = true;
  private stride = 0;
  private t = 0;
  private hips: Object3D | null;
  private torso: Object3D | null;
  private carry: Object3D | null;
  private joints: Record<'legL' | 'legR' | 'armL' | 'armR', Joint | null>;
  private mixer: AnimationMixer | null = null;
  private actions = new Map<string, AnimationAction>();
  private playing: AnimationAction | null = null;
  private rig: RigDriver | null = null;
  /** Rigged models: carries the y offset of the pose (bob, slide), the ladder rides along. */
  private body: Group | null = null;
  private cur: Pose = { hipsY: HIPS_Y, lean: 0, legL: 0, legR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, elbowL: 0, elbowR: 0 };

  constructor(readonly model: Object3D, clips: AnimationClip[] = []) {
    if (RigDriver.fits(model) && !clips.length) {
      // The rigged runner faces +z; the race runs towards −z.
      this.rig = new RigDriver(model);
      this.body = new Group();
      const wrap = new Group();
      wrap.rotation.y = Math.PI;
      wrap.add(model);
      const carry = new Group();
      carry.name = 'carry';
      // Outside the (big) head, on top of the right shoulder.
      carry.position.set(0.3, 1.02, 0);
      this.body.add(wrap, carry);
      this.root.add(this.body);
    } else this.root.add(model);
    const find = (n: string) => model.getObjectByName(n) ?? null;
    const joint = (n: string): Joint | null => {
      const node = find(n);
      return node ? { node, x: node.rotation.x, z: node.rotation.z } : null;
    };
    this.hips = find('hips');
    this.torso = find('torso');
    this.carry = find('carry');
    this.joints = { legL: joint('leg_L'), legR: joint('leg_R'), armL: joint('arm_L'), armR: joint('arm_R') };
    if (clips.length) {
      this.mixer = new AnimationMixer(model);
      for (const c of clips) this.actions.set(c.name.toLowerCase(), this.mixer.clipAction(c));
    }
    this.shoulderLadder();
  }

  shoulderLadder(): void {
    this.carrying = true;
    // Flat on the shoulder, pointing ahead (−z): reads as a ladder from the chase camera.
    this.ladder.rotation.set(-Math.PI / 2, 0, 0);
    this.ladder.position.set(0.12, 0, LADDER_LENGTH * 0.42);
    // A model without a `carry` node gets the ladder at shoulder height on the root.
    if (!this.carry) this.ladder.position.set(0.42, 1.5, LADDER_LENGTH * 0.42);
    (this.carry ?? this.root).add(this.ladder);
  }

  /** `speed` in m/s drives the stride so feet do not slide. */
  update(dt: number, speed = 0): void {
    this.t += dt;
    this.stride += speed * dt;
    if (this.mixer && this.playClip()) {
      this.mixer.update(dt * (this.pose === 'run' ? Math.max(0.6, speed / 6.5) : 1));
      return;
    }
    this.procedural(dt, speed);
  }

  private playClip(): boolean {
    const a = this.actions.get(this.pose) ?? (this.pose === 'stumble' ? this.actions.get('run') : undefined);
    if (!a) return false;
    if (a !== this.playing) {
      a.reset().fadeIn(0.15).play();
      this.playing?.fadeOut(0.15);
      this.playing = a;
    }
    return true;
  }

  private procedural(dt: number, speed: number): void {
    const phase = (this.stride / STRIDE) * Math.PI;
    const k = 1 - Math.exp(-dt * 16);
    const target: Pose = { hipsY: HIPS_Y, lean: 0, legL: 0, legR: 0, kneeL: 0.05, kneeR: 0.05, armL: 0, armR: 0, armLz: 0, armRz: 0, elbowL: 0.25, elbowR: 0.25 };
    const swing = Math.min(1, speed / 5);
    switch (this.pose) {
      case 'run':
        target.legL = Math.sin(phase) * 0.9 * swing;
        target.legR = -Math.sin(phase) * 0.9 * swing;
        target.armL = -Math.sin(phase) * 0.8 * swing;
        target.armR = Math.sin(phase) * 0.8 * swing;
        target.hipsY = HIPS_Y + Math.abs(Math.cos(phase)) * 0.07 * swing;
        target.lean = -0.18 * swing;
        // The trailing leg folds up, the arms bend like a runner's.
        target.kneeL = 0.25 + Math.max(0, -target.legL) * 1.4;
        target.kneeR = 0.25 + Math.max(0, -target.legR) * 1.4;
        target.elbowL = target.elbowR = 1.2;
        break;
      case 'jump':
        target.legL = 1.1;
        target.legR = 0.3;
        target.armL = 2.4;
        target.armR = 2.4;
        target.lean = -0.1;
        target.kneeL = 1.2;
        target.kneeR = 0.6;
        break;
      case 'slide':
        target.hipsY = 0.42;
        target.lean = 0.95;
        target.legL = 1.35;
        target.legR = 1.2;
        target.armL = 0.6;
        target.armR = 0.6;
        target.kneeL = 0.1;
        target.kneeR = 0.3;
        break;
      case 'stumble':
        target.lean = -0.55 + Math.sin(this.t * 22) * 0.12;
        target.legL = 0.6;
        target.legR = -0.4;
        target.armL = 1.8;
        target.armR = 1.4;
        target.armLz = -0.8;
        target.armRz = 0.8;
        target.hipsY = 0.84;
        break;
      case 'climb': {
        const c = Math.sin(this.t * 7);
        target.armL = 2.5 + c * 0.4;
        target.armR = 2.5 - c * 0.4;
        target.legL = 0.7 + c * 0.5;
        target.legR = 0.7 - c * 0.5;
        target.kneeL = 1.1 + c * 0.5;
        target.kneeR = 1.1 - c * 0.5;
        target.elbowL = target.elbowR = 0.6;
        break;
      }
      case 'pick':
        target.armL = 0.5;
        target.armR = 0.5;
        target.legL = 0.15;
        if (this.reach === 'up') target.armR = target.armL = Math.PI * 0.95;
        else if (this.reach === 'left') {
          target.armLz = -1.5;
          target.armL = 0.4;
        } else if (this.reach === 'right') {
          target.armRz = 1.5;
          target.armR = 0.4;
        } else if (this.reach === 'down') {
          target.armL = target.armR = 0.9;
          target.lean = -0.45;
        }
        break;
      case 'cheer':
        target.armL = Math.PI * 0.9 + Math.sin(this.t * 9) * 0.2;
        target.armR = Math.PI * 0.9 - Math.sin(this.t * 9) * 0.2;
        target.armLz = -0.3;
        target.armRz = 0.3;
        target.hipsY = HIPS_Y + Math.abs(Math.sin(this.t * 6)) * 0.08;
        break;
      default:
        target.armL = Math.sin(this.t * 2) * 0.05;
        target.armR = -Math.sin(this.t * 2) * 0.05;
    }
    // The right hand holds the ladder on the shoulder while running.
    if (this.carrying && this.pose !== 'cheer' && this.pose !== 'stumble') {
      target.armR = Math.PI * 0.82;
      target.armRz = 0.25;
    }

    const lerp = (a: number, b: number) => MathUtils.lerp(a, b, k);
    const c = this.cur;
    for (const key of Object.keys(c) as Array<keyof Pose>) c[key] = lerp(c[key], target[key]);
    if (this.rig && this.body) {
      this.body.position.y = c.hipsY - HIPS_Y;
      this.rig.apply(c);
      return;
    }
    if (this.hips) this.hips.position.y = lerp(this.hips.position.y, target.hipsY);
    if (this.torso) this.torso.rotation.x = lerp(this.torso.rotation.x, target.lean);
    const set = (j: Joint | null, x: number, z = 0) => {
      if (!j) return;
      j.node.rotation.x = lerp(j.node.rotation.x, j.x + x);
      j.node.rotation.z = lerp(j.node.rotation.z, j.z + z);
    };
    set(this.joints.legL, target.legL);
    set(this.joints.legR, target.legR);
    set(this.joints.armL, target.armL, target.armLz);
    set(this.joints.armR, target.armR, target.armRz);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}
