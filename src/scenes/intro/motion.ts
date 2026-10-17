import { Matrix4, Object3D, Quaternion, Vector3, type Group } from 'three';

/**
 * Procedural character animation for the rigged villager (see scripts/prepare-villager.py).
 *
 * Layers, evaluated every frame from the rest pose:
 *  1. Body pose channels (hips, spine, head, arm FK) per action, blended smoothly between actions.
 *  2. Walk cycle driven by the distance the actor really travelled, so planted feet never slide:
 *     pelvis bob/sway/rotation, counter-rotating chest, arm swing with elbow lag, heel-toe roll.
 *  3. Leg IK onto the foot targets, then foot/toe orientation.
 *  4. Tool: pickup arc, carried on the right shoulder, keyed dig cycle (lift, thrust, press, lever, toss).
 *  5. Hand IK onto the shovel shaft, wrists turned around the shaft.
 *
 * Rotations are authored in actor axes (+X = character's left, +Y = up, +Z = forward),
 * lengths in character heights (`H`), so the code is independent of bone rolls and model scale.
 */
export type VillagerAction = 'idle' | 'walk' | 'search' | 'thanks' | 'dig';
type Side = 'L' | 'R';
type Channels = Record<string, number>;
interface ToolPose { p: Vector3; q: Quaternion }
interface DigKey { s: number; t: [number, number, number]; tilt: number; side: number; yaw: number; drop: number; spine: number; chest: number; head: number }

const TAU = Math.PI * 2;
const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0), AZ = new Vector3(0, 0, 1);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rot = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle);
/** Roll (Z), then pitch (X), then yaw (Y), all in actor axes. Positive pitch bends forward. */
const ypr = (yaw: number, pitch: number, roll: number) => rot(AY, yaw).multiply(rot(AX, pitch)).multiply(rot(AZ, roll));

const SIDES: Side[] = ['L', 'R'];
const sign = (side: Side) => (side === 'L' ? 1 : -1);

/** Standing pose. Arm "lower" brings the T-pose arms down to the sides (radians). */
const STAND: Channels = {
  hipX: 0, hipY: -.006, hipZ: 0,
  pelY: 0, pelP: 0, pelR: 0, spY: 0, spP: .03, spR: 0, chY: 0, chP: 0, chR: 0,
  nkY: 0, nkP: 0, hdY: 0, hdP: -.03, hdR: 0,
  shL: 0, lowL: 1.28, swL: .05, flexL: .22, upL: 0, wrL: .15,
  shR: 0, lowR: 1.28, swR: .05, flexR: .22, upR: 0, wrR: .15,
  ftLx: 0, ftLz: 0, ftRx: 0, ftRz: 0,
};

/** Shovel-local grip heights on the shaft (blade bottom = 0, D-grip ring at .137). */
const GRIP = { pickup: .095, carry: .112, digTop: .132, digLow: .1 };

/**
 * Dig cycle keys. Blade-bottom position `t` and timings in page units for a 0.2-tall character;
 * tilt = shaft top towards the body, side = top to the character's right, yaw = turn to the right.
 */
const DIG: DigKey[] = [
  { s: 0, t: [-.004, .006, .068], tilt: .16, side: .05, yaw: 0, drop: .03, spine: .55, chest: 0, head: .30 },
  { s: .2, t: [-.004, .032, .073], tilt: .08, side: .05, yaw: 0, drop: .0, spine: .42, chest: .06, head: .22 },
  { s: .38, t: [-.004, -.014, .068], tilt: .18, side: .05, yaw: 0, drop: .07, spine: .72, chest: 0, head: .35 },
  { s: .5, t: [-.004, -.019, .067], tilt: .22, side: .05, yaw: 0, drop: .085, spine: .75, chest: 0, head: .35 },
  { s: .67, t: [-.004, .014, .064], tilt: .34, side: .05, yaw: 0, drop: .04, spine: .60, chest: .05, head: .30 },
  { s: .83, t: [-.045, .042, .050], tilt: .26, side: .22, yaw: -.6, drop: .02, spine: .48, chest: -.42, head: .18 },
  { s: 1, t: [-.004, .006, .068], tilt: .16, side: .05, yaw: 0, drop: .03, spine: .55, chest: 0, head: .30 },
];

export class VillagerMotion {
  action: VillagerAction = 'idle';
  /** Set by beginPickup(); the shovel then follows the hands. */
  held = false;
  /** 0 → 1 while picking up the shovel (reach, grasp, lift onto the shoulder). */
  pickup = 0;
  /** 0 → 1 per dig stroke. */
  digPhase = 0;

  private readonly root: Group;
  private readonly actor: Group;
  private readonly tool: Object3D;
  private readonly bones = new Map<string, Object3D>();
  private readonly restLocal = new Map<Object3D, Quaternion>();
  private readonly restC = new Map<Object3D, Quaternion>();
  private readonly restCInv = new Map<Object3D, Quaternion>();
  private readonly hipsRest: Vector3;
  private readonly H: number;
  private readonly page: number;
  private readonly leg = new Map<Side, { ankle: Vector3; ball: Vector3; heel: Vector3 }>();
  private readonly palm = new Map<Side, number>();
  private readonly carryHand: Vector3;
  private readonly carryRest: Vector3;
  private readonly stride: number;
  private pose: Channels = { ...STAND };
  private phase = 0;
  private walkWeight = 0;
  private leftGrip = 0;
  private prevPosition: Vector3;
  private prevYaw: number;
  private toolMode = 'free';
  private toolFrom: ToolPose | null = null;
  private toolBlend = 1;
  private toolStart: ToolPose | null = null;
  private lastTool: ToolPose | null = null;
  /** Largest palm-to-shaft distance of the last frame (page units); used by tests. */
  gripError = 0;

  constructor(root: Group, actor: Group, model: Object3D, tool: Object3D) {
    this.root = root; this.actor = actor; this.tool = tool;
    root.updateMatrixWorld(true);
    model.traverse((o) => { if ((o as { isBone?: boolean }).isBone) this.bones.set(o.name, o); });
    const actorQInv = actor.getWorldQuaternion(new Quaternion()).invert();
    for (const bone of this.bones.values()) {
      this.restLocal.set(bone, bone.quaternion.clone());
      const c = actorQInv.clone().multiply(bone.getWorldQuaternion(new Quaternion()));
      this.restC.set(bone, c);
      this.restCInv.set(bone, c.clone().invert());
    }
    const at = (name: string) => this.toActor(this.bone(name)?.getWorldPosition(new Vector3()) ?? new Vector3());
    this.hipsRest = this.bone('Hips')?.position.clone() ?? new Vector3();
    const head = at('Head'), hips = at('Hips');
    // Hips sit at .37 of the height in prepare-villager.py.
    this.H = hips.y > 0 ? hips.y / .37 : Math.max(head.y / .75, 1e-3);
    this.page = this.H / .2;
    this.stride = .62 * this.H;
    for (const side of SIDES) {
      const ankle = at('Foot_' + side), ball = at('Toe_' + side);
      ball.y = 0;
      const heel = new Vector3(ankle.x, 0, ankle.z + .02 * this.H);
      this.leg.set(side, { ankle, ball, heel });
      const hand = at('Hand_' + side), forearm = at('Forearm_' + side);
      this.palm.set(side, hand.distanceTo(forearm) * .32);
    }
    // Shovel carried on the right shoulder: hand in front, shaft resting on top of the shoulder.
    const k = this.page;
    const chest = this.bone('Chest')!;
    const toChest = (v: Vector3) => chest.worldToLocal(actor.localToWorld(v.clone()));
    this.carryHand = toChest(new Vector3(-.031 * k, .112 * k, .042 * k));
    this.carryRest = toChest(new Vector3(-.029 * k, .141 * k, -.004 * k));
    this.prevPosition = actor.position.clone();
    this.prevYaw = actor.rotation.y;
  }

  /** The shovel is about to be picked up: remember where it stands. */
  beginPickup(): void {
    this.root.updateMatrixWorld(true);
    this.toolStart = this.toolPoseFromObject();
    this.held = true;
    this.pickup = 0;
  }

  // ------------------------------------------------------------------ helpers

  private bone(name: string): Object3D | undefined { return this.bones.get(name); }
  private toActor(world: Vector3): Vector3 { return this.actor.worldToLocal(world); }
  private toWorld(local: Vector3): Vector3 { return this.actor.localToWorld(local.clone()); }

  /** Rotate a bone by `q`, given in actor axes, relative to its parent's posed frame. */
  private setRot(name: string, q: Quaternion): void {
    const b = this.bone(name);
    if (!b) return;
    b.quaternion.copy(this.restLocal.get(b)!).multiply(this.restCInv.get(b)!).multiply(q).multiply(this.restC.get(b)!);
  }

  /** Give a bone an absolute orientation `q * rest`, in actor space. */
  private setActorRot(b: Object3D, q: Quaternion): void {
    const world = this.actor.getWorldQuaternion(new Quaternion()).multiply(q).multiply(this.restC.get(b)!);
    b.quaternion.copy(b.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    b.updateWorldMatrix(false, true);
  }

  private aim(bone: Object3D, child: Object3D, target: Vector3): void {
    const start = bone.getWorldPosition(new Vector3());
    const current = child.getWorldPosition(new Vector3()).sub(start).normalize();
    const desired = target.clone().sub(start).normalize();
    const world = new Quaternion().setFromUnitVectors(current, desired).multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }

  /** Two-bone IK in world space; `pole` decides which way the middle joint bends. */
  private solve(first: string, second: string, end: string, target: Vector3, pole: Vector3): void {
    const a = this.bone(first), b = this.bone(second), c = this.bone(end);
    if (!a || !b || !c) return;
    const p = a.getWorldPosition(new Vector3()), q = b.getWorldPosition(new Vector3()), r = c.getWorldPosition(new Vector3());
    const upper = p.distanceTo(q), lower = q.distanceTo(r);
    const dir = target.clone().sub(p), raw = dir.length();
    if (raw < 1e-8) return;
    dir.divideScalar(raw);
    const d = Math.max(Math.abs(upper - lower) + 1e-6, Math.min(raw, upper + lower - 1e-6));
    const endpoint = p.clone().addScaledVector(dir, d);
    const along = (upper * upper - lower * lower + d * d) / (2 * d);
    const bend = pole.clone().sub(p);
    bend.addScaledVector(dir, -bend.dot(dir)).normalize();
    const elbow = p.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
    this.aim(a, b, elbow);
    this.aim(b, c, endpoint);
  }

  private toolPoseFromObject(): ToolPose {
    const m = new Matrix4().copy(this.actor.matrixWorld).invert().multiply(this.tool.matrixWorld);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    m.decompose(p, q, s);
    return { p, q };
  }

  private applyToolPose(pose: ToolPose): void {
    const parent = this.tool.parent!;
    const world = new Matrix4().copy(this.actor.matrixWorld).multiply(new Matrix4().compose(pose.p, pose.q, new Vector3(1, 1, 1)));
    const local = new Matrix4().copy(parent.matrixWorld).invert().multiply(world);
    const scale = this.tool.scale.clone();
    local.decompose(this.tool.position, this.tool.quaternion, new Vector3());
    this.tool.scale.copy(scale);
    this.tool.updateWorldMatrix(false, true);
  }

  /** Shaft length from tool-local units to actor units. */
  private get toolScale(): number { return this.tool.scale.y / this.actor.scale.y; }

  private gripPoint(pose: ToolPose, height: number): Vector3 {
    return new Vector3(0, height * this.toolScale, 0).applyQuaternion(pose.q).add(pose.p);
  }

  /** Tool pose whose shaft passes through `grip` (at `height`) along direction `axis`. */
  private poseThrough(grip: Vector3, axis: Vector3, height: number, yaw = 0): ToolPose {
    const y = axis.clone().normalize();
    const x = AX.clone().applyQuaternion(rot(AY, yaw));
    x.addScaledVector(y, -x.dot(y)).normalize();
    const z = new Vector3().crossVectors(x, y);
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    return { p: grip.clone().addScaledVector(y, -height * this.toolScale), q };
  }

  private carryPose(): ToolPose {
    const chest = this.bone('Chest')!;
    const hand = this.toActor(chest.localToWorld(this.carryHand.clone()));
    const rest = this.toActor(chest.localToWorld(this.carryRest.clone()));
    return this.poseThrough(hand, hand.clone().sub(rest), GRIP.carry);
  }

  private digKey(s: number): DigKey {
    s = ((s % 1) + 1) % 1;
    let i = 0;
    while (i < DIG.length - 2 && s > DIG[i + 1].s) i++;
    const k0 = DIG[Math.max(0, i - 1)], k1 = DIG[i], k2 = DIG[i + 1], k3 = DIG[Math.min(DIG.length - 1, i + 2)];
    const u = (s - k1.s) / (k2.s - k1.s);
    // Catmull-Rom keeps the shovel on a smooth arc through every key.
    const cr = (a: number, b: number, c: number, d: number) =>
      .5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
    const f = (key: keyof Omit<DigKey, 's' | 't'>) => cr(k0[key], k1[key], k2[key], k3[key]);
    return {
      s, t: [0, 1, 2].map((j) => cr(k0.t[j], k1.t[j], k2.t[j], k3.t[j])) as [number, number, number],
      tilt: f('tilt'), side: f('side'), yaw: f('yaw'), drop: f('drop'), spine: f('spine'), chest: f('chest'), head: f('head'),
    };
  }

  private digPose(key: DigKey): ToolPose {
    const k = this.page;
    const q = rot(AY, key.yaw).multiply(rot(AX, -key.tilt)).multiply(rot(AZ, key.side));
    return { p: new Vector3(key.t[0] * k, key.t[1] * k, key.t[2] * k), q };
  }

  // ------------------------------------------------------------------ pose targets

  private target(time: number): Channels {
    const c: Channels = { ...STAND };
    // Idle life: breathing and a slow weight shift.
    const breath = Math.sin(time * TAU / 3.4);
    c.chP -= .018 * breath; c.shL += .02 * breath; c.shR += .02 * breath;
    c.hipX += .004 * Math.sin(time * TAU / 6.5);
    c.pelR += .02 * Math.sin(time * TAU / 6.5);
    c.hdY += .06 * Math.sin(time * .41) * Math.sin(time * .23);
    switch (this.action) {
      case 'walk':
        c.spP += .05; c.hdP -= .02;
        break;
      case 'search': {
        // Looking around with holds, the chest follows the head.
        const look = Math.tanh(2.4 * Math.sin(time * TAU / 3.8)) / Math.tanh(2.4);
        c.hdY += .55 * look; c.nkY += .2 * look; c.chY += .22 * look;
        c.hdP += .18; c.spP += .08;
        if (!this.held) {
          // Hand shading the eyes.
          c.lowR = .25; c.swR = 1.05; c.flexR = 2.15; c.wrR = -.3;
        }
        break;
      }
      case 'thanks': {
        const side: Side = this.held ? 'L' : 'R';
        c['low' + side] = -.85; c['sw' + side] = .35; c['flex' + side] = .15;
        c['up' + side] = 1.0 + .38 * Math.sin(time * 13);
        c.hipY += .006 * Math.abs(Math.sin(time * 6.5));
        c.chP -= .06; c.hdP -= .08; c.hdR += .08 * Math.sin(time * 3.2);
        break;
      }
      case 'dig': {
        const key = this.digKey(this.digPhase);
        c.hipY -= key.drop * .45; c.hipZ -= .015 + key.spine * .03; c.spP = key.spine * .55; c.chP = key.spine * .45;
        c.chY = key.chest * .6; c.spY = key.chest * .4; c.hdP = key.head - key.spine * .5; c.hdY = -key.chest * .3;
        c.ftLx = .02; c.ftLz = .07; c.ftRx = -.015; c.ftRz = -.06;
        c.lowL = 1.0; c.swL = .6; c.flexL = .5;
        c.lowR = 1.0; c.swR = .6; c.flexR = .5;
        break;
      }
    }
    if (this.held && this.action !== 'dig' && this.pickup < 1) {
      const k = this.pickup;
      const bend = smooth(k / .38) * (1 - smooth((k - .5) / .42));
      c.hipY -= .05 * bend; c.spP += .42 * bend; c.chP += .12 * bend; c.hdP += .25 * bend;
      c.ftLz += .06 * bend; c.ftRz -= .03 * bend;
      c.lowL -= .15 * bend; c.swL += .35 * bend; c.flexL += .3 * bend;
    }
    if (this.held && this.action !== 'dig') {
      // Free left arm a little more relaxed while the right one carries.
      c.swL += .04;
    }
    return c;
  }

  /** Walk-cycle offsets for the body channels (scaled by the walk weight). */
  private walkLayer(c: Channels, w: number): void {
    const p = this.phase;
    const cos = (x: number) => Math.cos(TAU * x);
    c.hipY += w * (-.008 + .0075 * cos(2 * (p - .3)));
    c.hipX += w * .006 * cos(p - .3);
    c.pelY += w * -.11 * cos(p);
    c.pelR += w * .055 * cos(p - .3);
    c.spP += w * .015 * cos(2 * (p - .1));
    const swing = -cos(p - .04);
    const lag = -cos(p - .1);
    for (const side of SIDES) {
      const s = side === 'L' ? 1 : -1;
      const carried = side === 'R' && this.held && this.action !== 'dig';
      const amount = carried ? 0 : 1;
      c['sw' + side] += w * amount * .34 * s * swing;
      c['flex' + side] += w * amount * (.12 + .22 * Math.max(0, s * lag));
      c['low' + side] -= w * amount * .04;
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, time: number): void {
    if (dt <= 0) return;
    // ---- locomotion measured from the real root motion
    const moved = this.actor.position.distanceTo(this.prevPosition);
    let turned = this.actor.rotation.y - this.prevYaw;
    turned = Math.atan2(Math.sin(turned), Math.cos(turned));
    this.prevPosition.copy(this.actor.position);
    this.prevYaw = this.actor.rotation.y;
    const turnTravel = Math.abs(turned) * .16 * this.H;
    const speed = (moved + turnTravel) / dt;
    this.phase = (this.phase + (moved + turnTravel) / this.stride) % 1;
    const walkTarget = clamp(speed / (.35 * this.H));
    this.walkWeight += (walkTarget - this.walkWeight) * (1 - Math.exp(-dt * 9));

    // ---- body channels: smooth towards the action's pose
    const target = this.target(time);
    const follow = 1 - Math.exp(-dt * (this.action === 'dig' ? 16 : 8));
    for (const key in target) this.pose[key] += (target[key] - this.pose[key]) * follow;
    const c: Channels = { ...this.pose };
    this.walkLayer(c, this.walkWeight);
    // Counter-rotation up the spine keeps the head looking ahead.
    c.spY -= c.pelY * .6; c.chY -= c.pelY * .65;
    c.spR -= c.pelR * .8;
    const net = c.pelY + c.spY + c.chY;
    c.nkY -= net * .45; c.hdY -= net * .45;
    this.applyLookAt(c);

    // ---- FK from rest
    for (const [b, q] of this.restLocal) b.quaternion.copy(q);
    const hips = this.bone('Hips');
    if (hips) {
      hips.position.copy(this.hipsRest);
      this.root.updateMatrixWorld(true);
      const delta = this.toWorld(new Vector3(c.hipX * this.H, c.hipY * this.H, c.hipZ * this.H)).sub(this.toWorld(new Vector3()));
      const parentQInv = hips.parent!.getWorldQuaternion(new Quaternion()).invert();
      const parentScale = hips.parent!.getWorldScale(new Vector3());
      hips.position.add(delta.applyQuaternion(parentQInv).divide(parentScale));
    }
    this.setRot('Hips', ypr(c.pelY, c.pelP, c.pelR));
    this.setRot('Spine', ypr(c.spY, c.spP, c.spR));
    this.setRot('Chest', ypr(c.chY, c.chP, c.chR));
    this.setRot('Neck', ypr(c.nkY, c.nkP, 0));
    this.setRot('Head', ypr(c.hdY, c.hdP, c.hdR));
    for (const side of SIDES) {
      const s = sign(side);
      this.setRot('Shoulder_' + side, rot(AZ, s * c['sh' + side]));
      this.setRot('UpperArm_' + side, rot(AX, -c['sw' + side]).multiply(rot(AZ, -s * c['low' + side])));
      this.setRot('Forearm_' + side, rot(AZ, s * c['up' + side]).multiply(rot(AY, -s * c['flex' + side])));
      this.setRot('Hand_' + side, rot(AY, -s * c['wr' + side]));
    }
    this.root.updateMatrixWorld(true);

    this.legs(c);
    this.hands(dt);
  }

  private applyLookAt(c: Channels): void {
    let focus: Vector3 | null = null;
    if (this.held && this.action !== 'dig' && this.pickup < .55 && this.toolStart) focus = this.gripPoint(this.toolStart, GRIP.pickup);
    if (!focus) return;
    const eye = new Vector3(0, .85 * this.H, .02 * this.H);
    const d = focus.sub(eye);
    const yaw = Math.atan2(d.x, d.z), pitch = Math.atan2(-d.y, Math.hypot(d.x, d.z));
    const w = this.pickup < .45 ? 1 : 1 - smooth((this.pickup - .45) / .1);
    c.hdY += clamp(yaw, -.8, .8) * .5 * w; c.nkY += clamp(yaw, -.8, .8) * .3 * w;
    c.hdP += clamp(pitch - c.spP - c.chP, -.2, .6) * .6 * w;
  }

  // ------------------------------------------------------------------ legs

  private legs(c: Channels): void {
    const w = this.walkWeight;
    for (const side of SIDES) {
      const s = sign(side);
      const rest = this.leg.get(side)!;
      const q = (this.phase + (side === 'R' ? .5 : 0)) % 1;
      // Stance 60 %: the foot moves back exactly as fast as the body moves forward.
      let z: number, lift = 0, pitch: number;
      const L = this.stride;
      if (q < .6) {
        z = .3 * L - q * L;
        pitch = q < .08 ? -.22 * (1 - q / .08) : q > .42 ? .55 * smooth((q - .42) / .18) : 0;
      } else {
        const u = (q - .6) / .4;
        z = -.3 * L + .6 * L * (1 - Math.cos(Math.PI * u)) / 2;
        lift = .055 * this.H * Math.sin(Math.PI * Math.pow(u, .8));
        pitch = lerp(.55, -.22, smooth(u * 1.15));
      }
      const stand = new Vector3(rest.ankle.x + c['ft' + side + 'x'] * this.H, rest.ankle.y, rest.ankle.z + c['ft' + side + 'z'] * this.H);
      const walk = new Vector3(rest.ankle.x * .85, rest.ankle.y + lift, rest.ankle.z + z);
      const flat = stand.clone().lerp(walk, w);
      const footPitch = pitch * w;
      // Heel-toe roll: pivot around the ball (heel up) or the heel (toes up).
      const pivot = (footPitch > 0 ? rest.ball : rest.heel).clone().sub(rest.ankle).add(flat);
      const ankle = flat.clone().sub(pivot).applyAxisAngle(AX, footPitch).add(pivot);
      const hip = this.toActor(this.bone('Thigh_' + side)!.getWorldPosition(new Vector3()));
      const pole = hip.clone().add(new Vector3(s * .02 * this.H, -.25 * this.H, .6 * this.H));
      this.solve('Thigh_' + side, 'Shin_' + side, 'Foot_' + side, this.toWorld(ankle), this.toWorld(pole));
      const foot = this.bone('Foot_' + side), toe = this.bone('Toe_' + side);
      if (foot) this.setActorRot(foot, rot(AX, footPitch));
      if (toe) this.setActorRot(toe, rot(AX, Math.min(footPitch, 0)));
    }
  }

  // ------------------------------------------------------------------ tool + hands

  private hands(dt: number): void {
    this.gripError = 0;
    if (!this.held) { this.lastTool = null; this.toolMode = 'free'; return; }
    const digging = this.action === 'dig';
    const mode = digging ? 'dig' : this.pickup < 1 ? 'pickup' : 'carry';
    if (mode !== this.toolMode) {
      this.toolFrom = this.toolMode === 'free' ? null : this.lastTool;
      this.toolBlend = 0;
      this.toolMode = mode;
    }
    this.toolBlend += dt;
    let pose: ToolPose;
    let rightHeight = GRIP.carry, rightWeight = 1;
    const k = this.pickup;
    if (mode === 'dig') {
      pose = this.digPose(this.digKey(this.digPhase));
      rightHeight = GRIP.digTop;
    } else if (mode === 'pickup' && this.toolStart) {
      // Reach, grasp at .45, then lift along an arc onto the shoulder while the grip slides up.
      rightWeight = smooth(k / .4);
      const u = smooth((k - .45) / .55);
      const carry = this.carryPose();
      const from = this.gripPoint(this.toolStart, GRIP.pickup), to = this.gripPoint(carry, GRIP.carry);
      const grip = from.clone().lerp(to, u).add(new Vector3(0, .09 * this.H * Math.sin(Math.PI * u), .04 * this.H * Math.sin(Math.PI * u)));
      // Swing the blade up and back in the body's plane (not the shortest, sideways path).
      const ys = AY.clone().applyQuaternion(this.toolStart.q), yc = AY.clone().applyQuaternion(carry.q);
      let swing = Math.atan2(yc.z, yc.y) - Math.atan2(ys.z, ys.y);
      if (swing < 0) swing += TAU;
      const q = rot(AX, swing * u).multiply(this.toolStart.q).slerp(carry.q, u * u * u);
      rightHeight = lerp(GRIP.pickup, GRIP.carry, u);
      pose = { p: grip.clone().sub(new Vector3(0, rightHeight * this.toolScale, 0).applyQuaternion(q)), q };
    } else {
      pose = this.carryPose();
    }
    if (this.toolFrom && this.toolBlend < .45) {
      const b = smooth(this.toolBlend / .45);
      pose = { p: this.toolFrom.p.clone().lerp(pose.p, b), q: this.toolFrom.q.clone().slerp(pose.q, b) };
    }
    if (mode !== 'pickup' || k > .45) this.applyToolPose(pose);
    this.lastTool = { p: pose.p.clone(), q: pose.q.clone() };
    const shownPose = mode === 'pickup' && k <= .45 && this.toolStart ? this.toolStart : pose;

    this.leftGrip += ((digging ? 1 : 0) - this.leftGrip) * (1 - Math.exp(-dt * 10));
    this.grip('R', shownPose, rightHeight, rightWeight);
    if (this.leftGrip > .01) this.grip('L', shownPose, GRIP.digLow, this.leftGrip, GRIP.digTop - .012);
  }

  /** Put a hand around the shaft at `height`, blended with its FK position by `weight`. */
  private grip(side: Side, pose: ToolPose, height: number, weight: number, slideTo = height): void {
    const hand = this.bone('Hand_' + side), forearm = this.bone('Forearm_' + side), upper = this.bone('UpperArm_' + side);
    if (!hand || !forearm || !upper || weight <= 0) return;
    const s = sign(side);
    const palmLen = this.palm.get(side)! * this.actor.getWorldScale(new Vector3()).x;
    const fkWrist = hand.getWorldPosition(new Vector3());
    const shoulder = upper.getWorldPosition(new Vector3());
    // A hand that cannot reach slides up the shaft (like a real lower hand during a deep thrust).
    const armLen = shoulder.distanceTo(forearm.getWorldPosition(new Vector3())) + forearm.getWorldPosition(new Vector3()).distanceTo(fkWrist);
    const tooFar = (h: number) => this.toWorld(this.gripPoint(pose, h)).distanceTo(shoulder) > (armLen + palmLen) * .97;
    if (slideTo > height && tooFar(height)) {
      let lo = height, hi = slideTo;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (tooFar(mid)) lo = mid; else hi = mid; }
      height = hi;
    }
    const grip = this.toWorld(this.gripPoint(pose, height));
    const axis = this.toWorld(this.gripPoint(pose, height + .01)).sub(grip).normalize();
    const pole = this.toWorld(this.toActor(shoulder.clone()).add(new Vector3(s * .35 * this.H, -.25 * this.H, -.35 * this.H)));
    // Reach assist: the collarbone follows a far target.
    const reach = grip.distanceTo(shoulder) / (shoulder.distanceTo(forearm.getWorldPosition(new Vector3())) + forearm.getWorldPosition(new Vector3()).distanceTo(fkWrist) + palmLen);
    if (reach > .85) {
      const clav = this.bone('Shoulder_' + side);
      if (clav) {
        const toTarget = this.toActor(grip.clone()).sub(this.toActor(clav.getWorldPosition(new Vector3()))).normalize();
        const along = AX.clone().multiplyScalar(s);
        const q = new Quaternion().setFromUnitVectors(along, toTarget);
        const assist = new Quaternion().slerp(q, clamp((reach - .85) * 1.6, 0, .35) * weight);
        clav.quaternion.multiply(this.restCInv.get(clav)!.clone().multiply(assist).multiply(this.restC.get(clav)!));
        clav.updateWorldMatrix(false, true);
      }
    }
    // Fingers point across the shaft; two passes let the wrist settle.
    for (let pass = 0; pass < 2; pass++) {
      const elbow = forearm.getWorldPosition(new Vector3());
      const along = (pass === 0 ? grip.clone().sub(this.bone('UpperArm_' + side)!.getWorldPosition(new Vector3())) : hand.getWorldPosition(new Vector3()).sub(elbow)).normalize();
      const fingers = along.addScaledVector(axis, -along.dot(axis)).normalize();
      const wrist = grip.clone().addScaledVector(fingers, -palmLen);
      this.solve('UpperArm_' + side, 'Forearm_' + side, 'Hand_' + side, fkWrist.clone().lerp(wrist, weight), pole);
      if (pass === 1) {
        const current = this.toWorld(this.toActor(hand.getWorldPosition(new Vector3()))).sub(elbow).normalize();
        const handQ = hand.getWorldQuaternion(new Quaternion());
        const turn = new Quaternion().setFromUnitVectors(current, fingers);
        const world = new Quaternion().slerp(turn, weight).multiply(handQ);
        hand.quaternion.copy(hand.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
        hand.updateWorldMatrix(false, true);
      }
    }
    if (weight > .99) {
      const wrist = hand.getWorldPosition(new Vector3());
      const scale = this.root.getWorldScale(new Vector3()).x;
      const err = Math.abs(wrist.distanceTo(grip) - palmLen) / scale;
      this.gripError = Math.max(this.gripError, err);
    }
  }
}
