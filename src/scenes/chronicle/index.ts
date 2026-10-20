import { Color, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { LineId } from '../../audio/narrator';
import { easeOut } from '../../core/clock';
import type { StoryContext } from '../../story/context';
import type { IntroWorld } from '../intro';
import { heightAt } from '../intro/landscape';
import { PickingGame } from '../scene1/picking-game';
import { cherryTree } from '../shared/placeholders';
import { allmendEra, bakeryEra, declineEra, marketEra, prehistoryEra, romanEra, todayEra } from './eras';
import { PAGE_D, PAGE_W, PopupBook, YearSign, type Era } from './popup';
import { Pacing, stirPrompt, tapPrompt } from './prompt';

/*
 * «Die Geschichte der Zuger Chriesi»: continues on the intro meadow. The book from the chest
 * becomes a pop-up book; each page shows one moment of cherry history in Canton Zug
 * (facts: docs/research-zuger-chriesi.md, script: docs/storyboard-narration.md).
 * Watching time is budgeted to ≈ 4:20 including the intro; play time comes on top.
 */

const LINES: LineId[] = [
  'book_open',
  'prehist',
  'roman_mill',
  'roman_prompt',
  'roman_cherries',
  'roman_flood',
  'roman_dig',
  'market',
  'allmend_watch',
  'bell_prompt',
  'bell_rung',
  'ladder_prompt',
  'pick_prompt',
  'pick_hint',
  'pick_bird',
  'pick_done',
  'cake_intro',
  'cake_prompt',
  'cake_done',
  'decline',
  'revival',
  'race_today',
  'plant_prompt',
  'outro',
];

/** Where the open book lies on the meadow (intro root space) and where the villager watches from. */
const BOOK_AT = new Vector3(0, 0, 0.125);
const WATCH_AT = new Vector3(-0.275, 0, 0.205);
/** Seed hovers next to the year sign while the book is open (book space). */
const SEED_GUIDE = new Vector3(0.088, 0.16, -PAGE_D / 2 + 0.006);

const DAY = { sky: new Color(0xeaf3ff), hemi: 1.8, sun: 2.4 };
const OLD = new Color(0xfbe6c4);
const NIGHT = { sky: new Color(0x6f86c0), hemi: 0.55, sun: 0.3 };

export interface ChronicleOptions {
  /** 0 plays everything after the intro; 1–7 jumps straight to that page (review / testing). */
  startEra?: number;
}

export async function runChronicle(ctx: StoryContext, intro: IntroWorld, opts: ChronicleOptions = {}): Promise<{ dispose(): void }> {
  const { stage, narrator, sfx } = ctx;
  const clock = stage.clock;
  const startEra = opts.startEra ?? 0;
  void narrator.preload(LINES);
  const pacing = new Pacing(clock);

  // The meadow is not perfectly flat: rest the book on the highest point under it.
  let ground = 0;
  for (let x = -PAGE_W; x <= PAGE_W; x += 0.02) {
    for (let z = -PAGE_D / 2; z <= PAGE_D / 2; z += 0.02) ground = Math.max(ground, heightAt(BOOK_AT.x + x, BOOK_AT.z + z));
  }
  BOOK_AT.y = ground;
  const margin = 0.012;
  const restoreGrass = intro.land.clearArea(
    BOOK_AT.x - PAGE_W - margin,
    BOOK_AT.z - PAGE_D / 2 - margin,
    BOOK_AT.x + PAGE_W + margin,
    BOOK_AT.z + PAGE_D / 2 + margin,
  );

  const book = new PopupBook(clock);
  intro.root.add(book.group);
  const sign = new YearSign(clock);
  sign.group.position.z = -PAGE_D / 2 + 0.004;
  book.pages.add(sign.group);
  const bookFocus = BOOK_AT.clone().add(new Vector3(-0.04, 0.05, 0));

  // ---- light: old pages get a warm paper tone; night for the cherry guard
  const { hemi, light } = intro;
  const lightTo = (sky: Color, h: number, s: number, ms: number) => {
    const fromSky = hemi.color.clone();
    const fromH = hemi.intensity;
    const fromS = light.intensity;
    return clock.tween(ms, (k) => {
      hemi.color.copy(fromSky).lerp(sky, k);
      hemi.intensity = fromH + (h - fromH) * k;
      light.intensity = fromS + (s - fromS) * k;
    });
  };
  /** The modern village on the far shore is hidden on pages before it existed. */
  const setVillage = (visible: boolean) =>
    intro.land.group.children.forEach((o) => {
      if (/^(house_|clock_tower)/.test(o.name)) o.visible = visible;
    });

  // ---- the seed: the thread through all pages
  const { treasure, seed, halo } = intro;
  treasure.userData.bob = false;
  treasure.position.y = 0;
  const seedHome = new Vector3();
  const offSeed = clock.onUpdate((_dt, t) => {
    if (!treasure.userData.guide) return;
    seed.position.copy(seedHome).y += Math.sin(t * 2) * 0.004;
    seed.rotation.y = t;
    halo.position.copy(seed.position);
    halo.rotation.z = t * 0.6;
  });
  const flySeed = async (to: Vector3, ms: number) => {
    treasure.userData.guide = false;
    const from = seed.position.clone();
    await clock.tween(ms, (k) => {
      seed.position.lerpVectors(from, to, k).y += Math.sin(k * Math.PI) * 0.06;
      halo.position.copy(seed.position);
    });
    seedHome.copy(to);
    treasure.userData.guide = true;
  };
  const guideSpot = () => BOOK_AT.clone().add(SEED_GUIDE);

  // ---- 0 · the book leaves the chest, lands on the meadow and opens
  if (startEra === 0) {
    pacing.mark('book');
    const s = 0.065 / (PAGE_W + 0.008);
    const from = intro.book.getWorldPosition(new Vector3());
    intro.root.worldToLocal(from);
    from.x += (s * PAGE_W) / 2;
    book.group.position.copy(from);
    book.group.scale.setScalar(s);
    intro.book.visible = false;
    ctx.focus(bookFocus, 0.6);
    const flight = clock.tween(2400, (k) => {
      book.group.position.lerpVectors(from, BOOK_AT, k);
      book.group.position.y += Math.sin(k * Math.PI) * 0.12;
      book.group.scale.setScalar(s + (1 - s) * k);
    });
    const chestDown = clock.tween(1600, (k) => {
      intro.chest.position.y = 0.005 - k * 0.05;
      intro.pit.scale.setScalar(Math.max(0.001, 1 - k));
    });
    const step = (async () => {
      await intro.walk(WATCH_AT.x, WATCH_AT.z);
      await intro.turnTo(Math.atan2(BOOK_AT.x - WATCH_AT.x, BOOK_AT.z - WATCH_AT.z));
    })();
    await Promise.all([flight, chestDown, step, flySeed(guideSpot(), 2400)]);
    intro.chest.visible = false;
    intro.pit.visible = false;
    sfx.page();
    await Promise.all([book.open(), narrator.say('book_open')]);
  } else {
    // Jump straight to a page: book already open, villager watching.
    book.group.position.copy(BOOK_AT);
    book.openNow();
    intro.book.visible = false;
    intro.chest.visible = false;
    intro.pit.visible = false;
    intro.actor.position.copy(WATCH_AT);
    intro.actor.rotation.y = Math.atan2(BOOK_AT.x - WATCH_AT.x, BOOK_AT.z - WATCH_AT.z);
    seed.position.copy(guideSpot());
    seedHome.copy(guideSpot());
    treasure.userData.guide = true;
    ctx.focus(bookFocus, 0.6);
  }

  // ---- pages
  let current: Era | null = null;
  const show = async (era: Era, title: string, sub: string) => {
    if (current) {
      await current.fold();
      sfx.page();
      await Promise.all([book.flip(), sign.set(title, sub)]);
      current.dispose();
    } else {
      await sign.set(title, sub);
    }
    book.pages.add(era.group);
    current = era;
    sfx.page();
    await era.rise();
  };
  /** Redraws the sign only when the text changes (counters call this every frame). */
  let signText = '';
  const signDraw = (title: string, sub: string) => {
    if (title + sub === signText) return;
    signText = title + sub;
    sign.draw(title, sub);
  };

  const pages: Array<() => Promise<void>> = [
    // 1 · Zug-Sumpf
    async () => {
      setVillage(false);
      await Promise.all([lightTo(OLD, DAY.hemi, DAY.sun, 1200), show(prehistoryEra(clock), 'um 1000 v. Chr.', 'Am Ufer des Zugersees')]);
      await narrator.say('prehist');
    },
    // 2 · Cham-Hagendorn
    async () => {
      setVillage(false);
      const roman = romanEra(clock);
      await show(roman.era, 'um 200 n. Chr.', 'Hagendorn bei Cham');
      await narrator.say('roman_mill');
      await tapPrompt(ctx, pacing, {
        targets: [roman.wheel],
        line: 'roman_prompt',
        icon: 'wheel',
        label: 'Wasserrad drehen',
        markerOffset: new Vector3(0, 0.026, 0.01),
      });
      roman.setWheelSpeed(4.5);
      await narrator.say('roman_cherries');
      sfx.rain(5.5);
      await Promise.all([roman.flood(), narrator.say('roman_flood')]);
      roman.setWheelSpeed(0);
      await sign.set('1944', 'Ausgrabung in Cham');
      await Promise.all([roman.excavate(), narrator.say('roman_dig')]);
    },
    // 3 · Chriesimärt 1627
    async () => {
      setVillage(true);
      await show(marketEra(clock), '1627', 'Chriesimärt in Zug');
      await narrator.say('market');
    },
    // 4 · Allmend and Chriesigloggä, 1711
    async () => {
      const allmend = allmendEra(clock, sfx);
      allmend.setNight(true);
      await Promise.all([lightTo(NIGHT.sky, NIGHT.hemi, NIGHT.sun, 1000), show(allmend.era, '1711', 'Allmend in Zug')]);
      await narrator.say('allmend_watch');
      allmend.setNight(false);
      await lightTo(OLD, DAY.hemi, DAY.sun, 1400);
      await tapPrompt(ctx, pacing, {
        targets: [allmend.tower],
        line: 'bell_prompt',
        icon: 'bell',
        label: 'Glocke läuten',
        markerOffset: new Vector3(0, 0.125, 0),
      });
      void allmend.ringBell();
      await Promise.all([narrator.say('bell_rung'), allmend.rush()]);
      const chosen = await tapPrompt(ctx, pacing, {
        targets: allmend.trees,
        line: 'ladder_prompt',
        icon: 'tree',
        label: 'Baum wählen',
        markerOffset: new Vector3(0, 0.085, 0.03),
        markerSize: 0.05,
      });
      const world = await allmend.leanLadders(chosen);
      const prompt = narrator.say('pick_prompt');
      await pacing.waiting(() => new PickingGame(ctx, world, prompt, { cheer: null, hint: 'pick_hint', bird: 'pick_bird' }).run());
      sfx.fanfare();
      await narrator.say('pick_done');
    },
    // 5 · Zuger Kirschtorte, 1915
    async () => {
      const bakery = bakeryEra(clock);
      await Promise.all([lightTo(DAY.sky, DAY.hemi, DAY.sun, 1200), show(bakery.era, '1915', 'Konditorei in Zug')]);
      await narrator.say('cake_intro');
      await stirPrompt(ctx, pacing, bakery.bowl, 'cake_prompt', bakery.stir);
      sfx.fanfare();
      await bakery.revealCake();
      await narrator.say('cake_done');
    },
    // 6 · 1950 → 2000
    async () => {
      const decline = declineEra(clock);
      await show(decline.era, '1950', 'Zug wächst');
      await Promise.all([narrator.say('decline'), decline.play((year) => signDraw(String(year), 'Zug wächst'))]);
    },
    // 7 · new trees and the Chriesisturm today
    async () => {
      const today = todayEra(clock, sfx);
      await show(today.era, '2008', 'Neue Chriesibäume');
      await Promise.all([narrator.say('revival'), today.plant((n) => signDraw(String(n), 'neue Chriesibäume'))]);
      await sign.set('heute', 'Chriesisturm in Zug');
      await Promise.all([narrator.say('race_today'), today.race()]);
    },
  ];
  for (let i = Math.max(0, startEra - 1); i < pages.length; i++) {
    pacing.mark(`page ${i + 1}`);
    await pages[i]();
  }

  // ---- finale: the book closes and goes; the seed is planted where the chest was
  pacing.mark('finale');
  if (current) {
    await (current as Era).fold();
    (current as Era).dispose();
    current = null;
  }
  await book.close();
  const bookFrom = book.group.position.clone();
  const digSpot = intro.digSpot;
  const above = digSpot.clone().add(new Vector3(0, 0.06, 0));
  intro.pit.visible = true;
  intro.pit.scale.setScalar(0.55);
  await Promise.all([
    clock.tween(1200, (k) => {
      book.group.position.copy(bookFrom).y += k * 0.18;
      book.group.scale.setScalar(Math.max(0.001, 1 - easeOut(k)));
    }),
    flySeed(above, 1400),
    (async () => {
      await intro.walk(0.02, 0.07);
      await intro.turnTo(Math.PI / 2);
    })(),
  ]);
  book.group.visible = false;
  restoreGrass();
  ctx.focus(new Vector3(0.06, 0.08, 0.07), 0.62);

  // Big invisible tap volume around the small seed.
  const seedHit = new Mesh(new SphereGeometry(0.045, 8, 6), new MeshBasicMaterial({ visible: false }));
  seedHit.position.copy(above);
  treasure.add(seedHit);
  await tapPrompt(ctx, pacing, { targets: [seedHit], line: 'plant_prompt', icon: 'seed', label: 'Chriesistein pflanzen', markerOffset: new Vector3() });
  seedHit.removeFromParent();
  seedHit.geometry.dispose();
  (seedHit.material as MeshBasicMaterial).dispose();

  treasure.userData.guide = false;
  await clock.tween(700, (k) => {
    seed.position.lerpVectors(above, digSpot.clone().setY(0.006), k);
    halo.position.copy(seed.position);
    halo.scale.setScalar(Math.max(0.001, 1 - k));
  });
  intro.motion.action = 'dig';
  await intro.digStroke();
  await intro.digStroke();
  intro.motion.action = 'idle';
  seed.visible = false;
  halo.visible = false;
  intro.mound.visible = true;
  intro.mound.scale.set(0.5, 0.12, 0.35);
  intro.pit.visible = false;

  // The new tree grows out of the mound.
  const tree = cherryTree(1.15, 77);
  const treeRoot = new Group();
  treeRoot.position.copy(digSpot).setY(heightAt(digSpot.x, digSpot.z));
  treeRoot.add(tree);
  intro.root.add(treeRoot);
  const cherries: Mesh[] = [];
  const crown = tree.userData.crown as Array<{ x: number; y: number; z: number; r: number }>;
  const cherryGeo = new SphereGeometry(0.006, 7, 5);
  const red = new MeshBasicMaterial({ color: 0xc8263a });
  for (let i = 0; i < 16; i++) {
    const c = crown[i % crown.length];
    const a = i * 2.4;
    const m = new Mesh(cherryGeo, red);
    m.position.set(c.x + Math.cos(a) * c.r * 0.9, c.y - 0.01 + Math.sin(i * 1.7) * c.r * 0.4, c.z + Math.abs(Math.sin(a)) * c.r * 0.9);
    m.scale.setScalar(0.001);
    treeRoot.add(m);
    cherries.push(m);
  }
  const s = tree.scale.x;
  sfx.page();
  const grow = clock.tween(3200, (k) => tree.scale.setScalar(Math.max(0.001, s * easeOut(k))));
  intro.motion.action = 'thanks';
  await Promise.all([
    grow.then(async () => {
      sfx.fanfare();
      await clock.tween(900, (k) => cherries.forEach((m, i) => m.scale.setScalar(Math.max(0.001, easeOut(Math.min(1, k * 2 - i / 16))))));
    }),
    narrator.say('outro'),
  ]);
  intro.motion.action = 'idle';
  ctx.focus(null);

  const report = pacing.report();
  if (import.meta.env.DEV) {
    console.info(
      `[chronicle] total ${report.total.toFixed(1)} s · waiting for the child ${report.waited.toFixed(1)} s · animation ${report.animation.toFixed(1)} s`,
      report.marks.map(([l, t]) => `${l} @ ${t.toFixed(1)} s`).join(' · '),
    );
  }
  (window as unknown as { __chronicle?: unknown }).__chronicle = report;

  return {
    dispose() {
      offSeed();
      book.dispose();
      sign.dispose();
      treeRoot.removeFromParent();
      treeRoot.traverse((o) => (o as Mesh).geometry?.dispose());
      red.dispose();
      intro.dispose();
    },
  };
}
