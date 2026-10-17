// node tests/intro-motion.mjs — checks the villager motion without a browser.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Bone, Group, Object3D, Vector3 } from 'three';
import { VillagerMotion } from '../src/scenes/intro/motion.ts';

const bytes = readFileSync(new URL('../public/assets/models/villager.glb', import.meta.url));
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const joints = new Set(doc.skins.flatMap((s) => s.joints));
const build = () => {
  const nodes = doc.nodes.map((n, i) => {
    const o = joints.has(i) ? new Bone() : new Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  doc.nodes.forEach((n, i) => (n.children ?? []).forEach((j) => nodes[i].add(nodes[j])));
  const root = new Group(), actor = new Group(), model = new Group(), tool = new Group();
  doc.scenes[doc.scene ?? 0].nodes.forEach((i) => model.add(nodes[i]));
  root.add(actor, tool); actor.add(model); model.scale.setScalar(.2); tool.scale.setScalar(.85);
  return { root, actor, model, tool };
};

for (const name of ['Hips', 'Chest', 'Head', 'UpperArm_L', 'Hand_R', 'Thigh_L', 'Foot_R', 'Toe_L']) {
  assert(doc.nodes.some((n) => n.name === name), `rig is missing ${name}`);
}

// 1) Hands stay on the shaft while carrying (walking) and through whole dig strokes,
//    also when the page (root) is rotated and scaled as in AR.
{
  const { root, actor, model, tool } = build();
  const motion = new VillagerMotion(root, actor, model, tool);
  motion.beginPickup(); motion.pickup = 1;
  let time = 0, maxError = 0;
  for (const transformed of [false, true]) {
    if (transformed) { root.rotation.set(.25, .4, -.15); root.scale.setScalar(1.7); root.position.set(.2, .3, -.4); }
    for (const action of ['walk', 'dig']) {
      motion.action = action;
      for (let i = 0; i < 360; i++) {
        time += 1 / 120;
        if (action === 'walk') actor.position.z += .14 / 120;
        motion.digPhase = (i % 132) / 131;
        root.updateMatrixWorld(true);
        motion.update(1 / 120, time);
        if (i < 100) continue;
        maxError = Math.max(maxError, motion.gripError);
      }
    }
  }
  assert(maxError < .004, `hand leaves the shaft by ${maxError}`);
  console.log('Maximum hand-to-shaft error (page units):', maxError.toFixed(5));
}

// 2) Walking at constant speed: a planted foot must not slide over the meadow.
{
  const { root, actor, model, tool } = build();
  const motion = new VillagerMotion(root, actor, model, tool);
  motion.action = 'walk';
  let time = 0, previous = null, maxSlide = 0, measurements = 0, lowest = Infinity;
  for (let i = 0; i < 900; i++) {
    actor.position.z += .14 / 120; time += 1 / 120;
    root.updateMatrixWorld(true);
    motion.update(1 / 120, time);
    root.updateMatrixWorld(true);
    const ball = model.getObjectByName('Toe_L').getWorldPosition(new Vector3());
    lowest = Math.min(lowest, ball.y);
    if (i > 200 && previous && Math.abs(ball.y - previous.y) < 1e-6 && ball.y < lowest + 1e-3) {
      maxSlide = Math.max(maxSlide, Math.hypot(ball.x - previous.x, ball.z - previous.z));
      measurements++;
    }
    previous = ball;
  }
  assert(measurements > 50, `too few planted frames: ${measurements}`);
  assert(maxSlide < .0003, `planted foot slides: ${maxSlide}`);
  console.log('Maximum planted-foot drift per frame:', maxSlide.toExponential(2), 'over', measurements, 'frames');
}
