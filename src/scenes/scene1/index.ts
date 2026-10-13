import { Vector3 } from 'three';
import { CONFIG } from '../../config';
import type { LineId } from '../../audio/narrator';
import type { StoryContext } from '../../story/context';
import { TapMarker } from '../shared/marker';
import { PickingGame } from './picking-game';
import { buildScene1World, LAYOUT, type Scene1World } from './world';

const LINES: LineId[] = [
  's1_intro',
  's1_square',
  's1_bell_prompt',
  's1_bell_hint',
  's1_bell_rung',
  's1_race',
  's1_arrive',
  's1_pick_prompt',
  's1_pick_hint',
  's1_starling',
  's1_pick_cheer',
  's1_basket_full',
  's1_ending',
  's1_visit',
];

/** Resolves on the first tap on `target`, or never; `cancel` unregisters. */
function tapOnce(ctx: StoryContext, target: Parameters<StoryContext['stage']['addTapTarget']>[0]) {
  let off = () => {};
  const promise = new Promise<'tap'>((resolve) => {
    off = ctx.stage.addTapTarget(target, () => {
      off();
      resolve('tap');
    });
  });
  return { promise, cancel: () => off() };
}

/** The bell: tap to ring. A hint after a while, and it rings by itself if nobody taps. */
async function bellBeat(ctx: StoryContext, world: Scene1World): Promise<void> {
  const clock = ctx.stage.clock;
  const marker = new TapMarker(clock, 0.07);
  world.root.add(marker.sprite);
  world.root.updateMatrixWorld(true);
  marker.sprite.position.copy(world.root.worldToLocal(world.bell.getWorldPosition(new Vector3())));
  marker.sprite.position.y -= 0.012;

  const tap = tapOnce(ctx, world.tower);
  marker.show();
  ctx.focus(new Vector3(LAYOUT.tower.x, 0.1, LAYOUT.tower.z), 0.55);
  await ctx.narrator.say('s1_bell_prompt');

  const timeout = (ms: number) => clock.wait(ms).then(() => 'timeout' as const);
  let result = await Promise.race([tap.promise, timeout(CONFIG.bellHintAfterMs)]);
  if (result === 'timeout') {
    await ctx.narrator.say('s1_bell_hint');
    result = await Promise.race([tap.promise, timeout(CONFIG.bellAutoRingAfterMs - CONFIG.bellHintAfterMs)]);
  }
  tap.cancel();
  marker.hide();
  world.root.remove(marker.sprite);
  await world.ringBell();
}

/**
 * Scene 1 — «vom Chriesibaum»: the Chriesisturm and the harvest.
 * Linear story beats; the only interactions are the bell and the picking game.
 */
export async function runScene1(ctx: StoryContext): Promise<Scene1World> {
  const { narrator, stage } = ctx;
  const clock = stage.clock;
  const world = buildScene1World(ctx);
  void narrator.preload(LINES);

  await clock.wait(800);
  ctx.focus(null);
  await narrator.say('s1_intro');

  ctx.focus(new Vector3(LAYOUT.fountain.x + 0.06, 0.04, LAYOUT.fountain.z), 0.6);
  await narrator.say('s1_square');

  await bellBeat(ctx, world);
  world.cheer();
  await narrator.say('s1_bell_rung');

  ctx.focus(new Vector3(0, 0.03, 0.08), 0.85);
  await Promise.all([narrator.say('s1_race'), world.runRace()]);
  world.cheer();
  await narrator.say('s1_arrive');

  ctx.focus(new Vector3(LAYOUT.heroTree.x - 0.03, 0.1, LAYOUT.heroTree.z + 0.05), 0.5);
  // Picking may start while the prompt is still being spoken; the game queues its own lines after it.
  const prompt = narrator.say('s1_pick_prompt');
  await new PickingGame(ctx, world, prompt).run();

  ctx.sfx.fanfare();
  await narrator.say('s1_basket_full');
  ctx.focus(null);
  await narrator.say('s1_ending');
  await narrator.say('s1_visit');
  return world;
}
