import {
  Box3,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { easeOut } from '../core/clock';
import type { Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import { cherry, mat, mesh } from '../scenes/shared/placeholders';
import type { GameEnv } from './env';
import type { Dir } from './input';
import type { Racer } from './racer';
import { textTexture } from './world';

/*
 * «Chriesi-Chuchi»: the finish line is a kitchen. The town folds away, the kitchen unfolds
 * like a pop-up page, and the cherries become Chriesi-Konfitüre in four quick stations:
 * wash (← → alternating), pit (↓ on time), cook (↑ → ↓ ← stir), fill the jars (↓ start / ↓ stop).
 * All positions are relative to the kitchen root; the table runs along x.
 */
export const WASH_PRESSES = 12;
export const PIT_COUNT = 8;
export const STIR_ROUNDS = 5;
export const JARS = 3;

const TABLE_Y = 1.0;
/** Page units per metre: the whole room on the page, and a slightly closer view per station. */
export const KITCHEN_SCALE = 0.06;
/**
 * Stations stay inside the page: the room (11 × 8.5 m) must fit the spread, so nothing is cut
 * open by the page edges (cut walls flicker in AR and read badly from a 45° angle).
 */
const STATION_SCALE = 0.08;
const ROOM_HALF_W = 5.5;
const ROOM_CENTER_Z = -0.75;
const WALL_H = 3.6;
/** Top of the floor slab in the generated room, as a share of its height. */
const ROOM_FLOOR = 0.071;
const JAM = new Color(0x6e0c22);
const FRESH = new Color(PALETTE.cherry);

export interface Kitchen {
  root: Group;
  /** Pop-up: walls and furniture fold up from flat. */
  unfold(env: GameEnv, ms: number): Promise<void>;
  run(env: GameEnv, racer: Racer): Promise<number[]>;
  dispose(): void;
}

interface Station {
  at: Vector3;
  /** Sideways offset of the cook from the station (keeps tall props out of the way). */
  standX?: number;
}

export function buildKitchen(models?: Models): Kitchen {
  const root = new Group();
  root.name = 'kitchen';
  const pieces: Array<{ o: Object3D; axis: 'x' | 'z'; from: number }> = [];
  const fold = (o: Object3D, axis: 'x' | 'z', from: number) => {
    pieces.push({ o, axis, from });
    o.rotation[axis] = from;
  };

  // ---- room: the generated kitchen (Meshy) when it is there, rising from the page like a pop-up
  const rising: Object3D[] = [];
  const room = models?.get('kitchenRoom', () => new Group());
  if (room && room.children.length) {
    room.updateMatrixWorld(true);
    const b = new Box3().setFromObject(room);
    const s = (2 * ROOM_HALF_W) / (b.max.x - b.min.x);
    room.scale.setScalar(s);
    // Floor top level with the page; the room is open towards the reader and on the right.
    room.position.set(-((b.min.x + b.max.x) / 2) * s, -(b.min.y + ROOM_FLOOR * (b.max.y - b.min.y)) * s, ROOM_CENTER_Z - ((b.min.z + b.max.z) / 2) * s);
    const pivot = new Group();
    pivot.add(room);
    pivot.scale.y = 0.02;
    root.add(pivot);
    rising.push(pivot);
  } else {
    // ---- procedural room: floor, back wall with window, two side walls
    const floor = mesh(new BoxGeometry(11, 0.1, 8.5), 0xc9a27a);
    floor.position.set(0, -0.05, -0.75);
    root.add(floor);
    const wall = (w: number, h: number, color: number) => {
      const p = new Group();
      const m = mesh(new BoxGeometry(w, h, 0.15), color);
      m.position.y = h / 2;
      p.add(m);
      return p;
    };
    const back = wall(11, WALL_H, PALETTE.cream);
    back.position.set(0, 0, -5);
    const window_ = mesh(new PlaneGeometry(2.6, 1.4), 0xbfe0f5);
    window_.position.set(-2.2, 2.45, 0.09);
    const lakeView = mesh(new PlaneGeometry(2.6, 0.5), PALETTE.lake);
    lakeView.position.set(-2.2, 2.0, 0.11);
    const frame = mesh(new BoxGeometry(2.8, 0.12, 0.12), PALETTE.wood);
    frame.position.set(-2.2, 1.72, 0.1);
    const shelf = mesh(new BoxGeometry(3.4, 0.1, 0.5), PALETTE.wood);
    shelf.position.set(2.6, 2.3, 0.3);
    back.add(window_, lakeView, frame, shelf);
    for (let i = 0; i < 4; i++) {
      const j = mesh(new CylinderGeometry(0.18, 0.18, 0.42, 10), mat(0x8e1a29));
      j.position.set(1.4 + i * 0.75, 2.56, 0.3);
      back.add(j);
    }
    // Tiles behind the worktop.
    for (let x = -5; x < 5.4; x += 0.55) {
      const t = mesh(new PlaneGeometry(0.5, 0.5), (Math.round(x / 0.55) % 2 ? 0xffffff : 0xdfe7ea));
      t.position.set(x + 0.25, 1.4, 0.08);
      back.add(t);
    }
    root.add(back);
    fold(back, 'x', -Math.PI / 2);
    for (const side of [-1, 1]) {
      const w = wall(8.5, WALL_H, 0xf2d8b0);
      w.rotation.order = 'ZYX';
      w.rotation.y = Math.PI / 2;
      w.position.set(side * 5.5, 0, -0.75);
      root.add(w);
      fold(w, 'z', side * (Math.PI / 2));
    }

  }

  // ---- table and stations
  const table = new Group();
  const top = mesh(new BoxGeometry(7, 0.12, 2), PALETTE.wood);
  top.position.y = TABLE_Y - 0.06;
  table.add(top);
  for (const [x, z] of [
    [-3.3, -0.85],
    [3.3, -0.85],
    [-3.3, 0.85],
    [3.3, 0.85],
  ]) {
    const leg = mesh(new BoxGeometry(0.14, TABLE_Y - 0.12, 0.14), 0x7a5230);
    leg.position.set(x, (TABLE_Y - 0.12) / 2, z);
    table.add(leg);
  }
  const cloth = mesh(new PlaneGeometry(7.04, 0.4), mat(PALETTE.cherry, { side: DoubleSide }));
  cloth.position.set(0, TABLE_Y - 0.25, 1.01);
  table.add(cloth);
  table.position.z = 0;
  root.add(table);
  fold(table, 'x', -Math.PI / 2);

  const stations: Record<'wash' | 'pit' | 'cook' | 'fill', Station> = {
    wash: { at: new Vector3(-2.4, TABLE_Y, 0.1) },
    pit: { at: new Vector3(-0.6, TABLE_Y, 0.1) },
    cook: { at: new Vector3(1.2, TABLE_Y, 0.1) },
    fill: { at: new Vector3(2.8, TABLE_Y, 0.1), standX: 1.0 },
  };

  // Wash bowl with water and cherries.
  const bowl = new Group();
  bowl.position.copy(stations.wash.at);
  const bowlWall = mesh(new CylinderGeometry(0.55, 0.38, 0.32, 16, 1, true), mat(0xdfe7ea, { side: DoubleSide }));
  bowlWall.position.y = 0.16;
  const water = mesh(new CircleGeometry(0.52, 18), new MeshLambertMaterial({ color: 0x8cc4ea, transparent: true, opacity: 0.8 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.26;
  bowl.add(bowlWall, water);
  const washCherries: Object3D[] = [];
  for (let i = 0; i < 9; i++) {
    const c = cherry();
    c.scale.setScalar(8);
    const a = i * 2.4;
    c.position.set(Math.cos(a) * 0.28 * Math.sqrt(i / 9), 0.27, Math.sin(a) * 0.28 * Math.sqrt(i / 9));
    bowl.add(c);
    washCherries.push(c);
  }
  root.add(bowl);

  // Pitting board with plunger.
  const board = new Group();
  board.position.copy(stations.pit.at);
  const plank = mesh(new BoxGeometry(1.7, 0.06, 0.6), 0xe0b98a);
  plank.position.y = 0.03;
  const mark = mesh(new BoxGeometry(0.05, 0.065, 0.6), PALETTE.cherry);
  mark.position.y = 0.035;
  const press = new Group();
  const plunger = mesh(new CylinderGeometry(0.05, 0.05, 0.4, 8), 0x9aa3ad);
  plunger.position.y = 0.2;
  const knob = mesh(new SphereGeometry(0.11, 10, 6), PALETTE.zugBlue);
  knob.position.y = 0.45;
  press.add(plunger, knob);
  press.position.y = 0.32;
  const stand = mesh(new BoxGeometry(0.1, 0.95, 0.1), 0x9aa3ad);
  stand.position.set(0, 0.47, -0.32);
  const arm = mesh(new BoxGeometry(0.1, 0.08, 0.36), 0x9aa3ad);
  arm.position.set(0, 0.9, -0.16);
  const dish = mesh(new CylinderGeometry(0.22, 0.16, 0.08, 12), 0xffffff);
  dish.position.set(-0.6, 0.04, 0.55);
  board.add(plank, mark, press, stand, arm, dish);
  root.add(board);

  // Cooktop with pot and spoon.
  const stove = new Group();
  stove.position.copy(stations.cook.at);
  const plate = mesh(new BoxGeometry(1.1, 0.12, 0.9), 0x2b2d42);
  plate.position.y = 0.06;
  const burner = mesh(new CylinderGeometry(0.34, 0.34, 0.02, 16), new MeshBasicMaterial({ color: 0xff6a3d }));
  burner.position.y = 0.13;
  const pot = mesh(new CylinderGeometry(0.42, 0.38, 0.5, 16, 1, true), mat(0xb8c2cc, { side: DoubleSide }));
  pot.position.y = 0.39;
  const jamMat = new MeshLambertMaterial({ color: FRESH.clone() });
  const jam = mesh(new CircleGeometry(0.4, 18), jamMat);
  jam.rotation.x = -Math.PI / 2;
  jam.position.y = 0.52;
  const spoon = new Group();
  spoon.position.y = 0.52;
  const handle = mesh(new CylinderGeometry(0.03, 0.03, 0.9, 6), PALETTE.wood);
  handle.position.set(0.22, 0.35, 0);
  handle.rotation.z = -0.45;
  spoon.add(handle);
  stove.add(plate, burner, pot, jam, spoon);
  root.add(stove);

  // Jars waiting at the filling station, a jug above the first one.
  const jarGroup = new Group();
  jarGroup.position.copy(stations.fill.at);
  const label = new MeshLambertMaterial({ map: textTexture('Zuger Chriesi', '#f4eedc', '#c8263a', 512, 160) });
  const glass = new MeshLambertMaterial({ color: 0xe8f4fb, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false });
  const jars = Array.from({ length: JARS }, (_, i) => {
    const g = new Group();
    const body = new Mesh(new CylinderGeometry(0.2, 0.2, 0.46, 14, 1, true), glass);
    body.position.y = 0.23;
    const fill = new Mesh(new CylinderGeometry(0.19, 0.19, 0.44, 14), new MeshLambertMaterial({ color: JAM }));
    fill.position.y = 0.01;
    fill.scale.y = 0.001;
    fill.visible = false;
    const lid = mesh(new CylinderGeometry(0.22, 0.22, 0.07, 14), [PALETTE.cherry, 0xffffff][i % 2]);
    lid.position.y = 0.9;
    lid.visible = false;
    const tag = new Mesh(new CylinderGeometry(0.205, 0.205, 0.16, 14, 1, true, -0.9, 1.8), label);
    tag.position.y = 0.24;
    tag.visible = false;
    g.add(body, fill, lid, tag);
    g.position.set(0.55 + i * 0.5, 0, -0.35);
    jarGroup.add(g);
    return { g, fill, lid, tag };
  });
  const jug = new Group();
  const jugBody = mesh(new CylinderGeometry(0.22, 0.28, 0.5, 12), 0xb8c2cc);
  const spout = mesh(new BoxGeometry(0.12, 0.08, 0.3), 0xb8c2cc);
  spout.position.set(0, 0.18, 0.28);
  jug.add(jugBody, spout);
  jug.position.set(0, 1.25, -0.4);
  jug.rotation.x = 0.35;
  const stream = new Mesh(new CylinderGeometry(0.035, 0.035, 1, 6), new MeshLambertMaterial({ color: JAM }));
  stream.visible = false;
  jarGroup.add(jug, stream);
  root.add(jarGroup);
  const props = [bowl, board, stove, jarGroup];
  props.forEach((p) => p.scale.setScalar(0.001));

  /** Kitchen point → course coordinates (the kitchen root is only translated). */
  const toCourse = (v: Vector3) => v.clone().add(root.position);
  /** Lean the view towards one station, as far as the whole room still fits on the page. */
  const frameStation = (env: GameEnv, s: Station, scale = STATION_SCALE) => {
    const slack = Math.max(0, 0.5 / scale - ROOM_HALF_W);
    const x = Math.min(slack, Math.max(-slack, s.at.x));
    env.view.frame(toCourse(new Vector3(x, 0, ROOM_CENTER_Z)), scale, 3);
  };

  /** The cook stands behind the table, facing the camera, at a station. */
  const standAt = async (env: GameEnv, racer: Racer, s: Station) => {
    const r = racer.runner.root;
    const to = toCourse(new Vector3(s.at.x + (s.standX ?? 0), 0, -1.55));
    const from = r.position.clone();
    racer.scripted = true;
    racer.scriptSpeed = 5;
    racer.runner.pose = 'run';
    r.rotation.y = to.x > from.x ? -Math.PI / 2 : Math.PI / 2;
    await env.clock.tween(Math.max(250, from.distanceTo(to) * 160), (k) => r.position.lerpVectors(from, to, k));
    racer.scriptSpeed = 0;
    racer.runner.pose = 'pick';
    r.rotation.y = Math.PI;
    frameStation(env, s);
  };

  /** Generic press loop: `expect()` returns the arrow wanted now; `onHit` advances. */
  const pressLoop = async (env: GameEnv, total: number, expect: (i: number) => Dir, onHit: (i: number) => Promise<void> | void, hintAll = false) => {
    for (let i = 0; i < total; i++) {
      const want = expect(i);
      env.pad.hint(want, hintAll || i < 4);
      env.hud.showPrompt(want);
      for (;;) {
        const got = await env.pad.next();
        if (got === want) break;
        env.pad.shake(got);
        env.sfx.miss();
      }
      await onHit(i);
    }
    env.pad.hint(null);
    env.hud.showPrompt(null);
  };

  return {
    root,
    async unfold(env, ms) {
      await Promise.all([
        ...rising.map((o) => env.clock.tween(ms * 0.7, (k) => (o.scale.y = 0.02 + 0.98 * easeOut(k)))),
        ...pieces.map(({ o, axis, from }, i) =>
          env.clock.wait(i * 120).then(() => env.clock.tween(ms * 0.6, (k) => (o.rotation[axis] = from * (1 - easeOut(k))))),
        ),
      ]);
      env.sfx.page();
      await Promise.all(
        props.map((p, i) => env.clock.wait(i * 110).then(() => env.clock.tween(380, (k) => p.scale.setScalar(Math.max(0.001, easeOut(k)))))),
      );
    },

    async run(env, racer) {
      const { clock, pad, hud, sfx } = env;
      const splits: number[] = [];
      let t0 = clock.time;
      const lap = () => {
        splits.push(clock.time - t0);
        t0 = clock.time;
      };
      pad.only(['up', 'down', 'left', 'right']);

      // ---- 1 · wash: ← → alternating
      hud.setStage('Waschen');
      await standAt(env, racer, stations.wash);
      hud.toast('Chriesi waschen!', 'good', 1200);
      hud.setCounter(`0 / ${WASH_PRESSES}`, 'cherries');
      await pressLoop(
        env,
        WASH_PRESSES,
        (i) => (i % 2 ? 'right' : 'left'),
        (i) => {
          sfx.splash();
          racer.runner.reach = i % 2 ? 'right' : 'left';
          const dx = i % 2 ? 0.07 : -0.07;
          washCherries.forEach((c, k) => {
            const x0 = c.position.x;
            void clock.tween(160, (t) => (c.position.x = x0 + (dx - x0 * 0.3) * t * (0.6 + (k % 3) * 0.2)));
          });
          water.rotation.y = dx * 2;
          hud.setCounter(`${i + 1} / ${WASH_PRESSES}`, 'cherries');
        },
        true,
      );
      racer.runner.reach = null;
      sfx.fanfare();
      lap();

      // ---- 2 · pit: cherries slide under the press, ↓ when one is on the red mark
      hud.setStage('Entsteinen');
      await standAt(env, racer, stations.pit);
      hud.toast('Drück, wenn die Chriesi unter der Presse ist!', 'good', 1800);
      hud.setCounter(`0 / ${PIT_COUNT}`, 'cherries');
      const belt: Array<{ c: Object3D; pitted: boolean }> = [];
      const SPACING = 0.42;
      const SPEED = 0.32;
      const LOOP = SPACING * 6;
      for (let i = 0; i < 6; i++) {
        const c = cherry();
        c.scale.setScalar(8);
        c.position.set(0, 0.14, 0);
        board.add(c);
        belt.push({ c, pitted: false });
      }
      const beltStart = clock.time;
      const xOf = (i: number) => 0.85 - ((((clock.time - beltStart) * SPEED + i * SPACING) % LOOP + LOOP) % LOOP);
      const offBelt = clock.onUpdate(() =>
        belt.forEach((b, i) => {
          if (b.pitted) return;
          const x = xOf(i);
          b.c.visible = x > -0.85 && x < 0.85;
          b.c.position.x = x;
        }),
      );
      let pitted = 0;
      pad.hint('down');
      hud.showPrompt('down');
      while (pitted < PIT_COUNT) {
        await pad.next(['down']);
        void clock.tween(200, (k) => (press.position.y = 0.32 - Math.sin(k * Math.PI) * 0.2));
        const hit = belt.findIndex((b, i) => !b.pitted && Math.abs(xOf(i)) < 0.15);
        if (hit < 0) {
          sfx.miss();
          hud.toast('Zu früh!', 'bad', 450);
          continue;
        }
        const b = belt[hit];
        b.pitted = true;
        pitted++;
        sfx.pop(pitted);
        hud.setCounter(`${pitted} / ${PIT_COUNT}`, 'cherries');
        const stone = mesh(new SphereGeometry(0.035, 6, 4), PALETTE.stone);
        stone.position.set(0, 0.16, 0);
        board.add(stone);
        const from = b.c.position.clone();
        void clock.tween(380, (k) => {
          stone.position.set(-0.6 * k, 0.16 + Math.sin(k * Math.PI) * 0.3, 0.55 * k);
          b.c.position.set(from.x, from.y + k * 0.25, from.z + k * 0.2);
          b.c.scale.setScalar(Math.max(0.001, 8 * (1 - k)));
        });
        // A fresh cherry takes its place on the belt, so there is always one coming.
        void clock.wait(400).then(() => {
          stone.removeFromParent();
          b.pitted = false;
          b.c.scale.setScalar(8);
          b.c.position.set(0, 0.14, 0);
        });
      }
      offBelt();
      belt.forEach((b) => b.c.removeFromParent());
      pad.hint(null);
      hud.showPrompt(null);
      sfx.fanfare();
      lap();

      // ---- 3 · cook: stir ↑ → ↓ ← as fast as possible
      hud.setStage('Kochen');
      await standAt(env, racer, stations.cook);
      hud.toast('Schnell rühren!', 'good', 1200);
      const order: Dir[] = ['up', 'right', 'down', 'left'];
      hud.setCounter(`0 / ${STIR_ROUNDS}`, 'replay');
      await pressLoop(
        env,
        STIR_ROUNDS * 4,
        (i) => order[i % 4],
        (i) => {
          const a0 = spoon.rotation.y;
          void clock.tween(110, (k) => (spoon.rotation.y = a0 - (Math.PI / 2) * k));
          racer.runner.reach = order[i % 4];
          jamMat.color.copy(FRESH).lerp(JAM, (i + 1) / (STIR_ROUNDS * 4));
          if (i % 4 === 3) {
            sfx.plop();
            hud.setCounter(`${(i + 1) / 4} / ${STIR_ROUNDS}`, 'replay');
          }
        },
        true,
      );
      racer.runner.reach = null;
      sfx.fanfare();
      lap();

      // ---- 4 · fill: ↓ starts pouring, ↓ again stops — stop in the green band
      hud.setStage('Abfüllen');
      await standAt(env, racer, stations.fill);
      hud.toast('Füll die Gläser bis zum Strich!', 'good', 1600);
      pad.only(['down']);
      const ZONE: [number, number] = [0.74, 0.97];
      for (let j = 0; j < JARS; j++) {
        const jar = jars[j];
        hud.setCounter(`${j} / ${JARS}`, 'cherries');
        // Slide this jar under the jug.
        const jx = jar.g.position.x;
        await clock.tween(300, (k) => (jar.g.position.x = jx + (0 - jx) * k));
        let level = 0;
        let done = false;
        while (!done) {
          hud.setGauge(level, ZONE, true);
          pad.hint('down');
          hud.showPrompt('down', level ? 'Weiter' : 'Giessen');
          await pad.next(['down']);
          // Pouring until the next press (or overflow).
          hud.showPrompt('down', 'Stopp!');
          stream.visible = true;
          stream.position.set(0, 0.72, -0.35);
          stream.scale.y = 0.75;
          let overflow = false;
          const off = clock.onUpdate((dt) => {
            level += dt * 0.38;
            jar.fill.visible = true;
            jar.fill.scale.y = Math.max(0.001, Math.min(1, level));
            jar.fill.position.y = 0.01 + (0.44 * Math.min(1, level)) / 2;
            hud.setGauge(Math.min(1, level), ZONE, true);
            if (level > 1.04) overflow = true;
          });
          await Promise.race([
            pad.next(['down']),
            new Promise<void>((res) => {
              const o = clock.onUpdate(() => {
                if (overflow) {
                  o();
                  res();
                }
              });
            }),
          ]);
          off();
          stream.visible = false;
          if (overflow) {
            sfx.splash();
            hud.toast('Übergelaufen!', 'bad', 1100);
            await clock.wait(1100);
            level = 0.9;
            jar.fill.scale.y = level;
            jar.fill.position.y = 0.01 + (0.44 * level) / 2;
            done = true;
          } else if (level >= ZONE[0]) {
            sfx.pop(j * 3);
            hud.toast(level <= ZONE[1] ? 'Perfekt!' : 'Fast!', 'good', 700);
            done = true;
          } else {
            hud.toast('Mehr!', 'bad', 500);
          }
        }
        hud.setGauge(null);
        jar.lid.visible = true;
        jar.tag.visible = true;
        await clock.tween(260, (k) => (jar.lid.position.y = 0.9 - (0.9 - 0.49) * easeOut(k)));
        // Finished jars go to the front row.
        const fromP = jar.g.position.clone();
        void clock.tween(350, (k) => jar.g.position.set(fromP.x + (-1.3 + j * 0.5 - fromP.x) * k, 0, fromP.z + (0.35 - fromP.z) * k));
      }
      pad.hint(null);
      hud.showPrompt(null);
      hud.setCounter(`${JARS} / ${JARS}`, 'cherries');
      lap();
      sfx.fanfare();
      racer.runner.pose = 'cheer';
      const fin = { at: stations.fill.at.clone().add(new Vector3(-0.8, 0, 0.3)) };
      frameStation(env, fin);
      return splits;
    },

    dispose() {
      root.removeFromParent();
      root.traverse((o) => (o as Mesh).geometry?.dispose());
      jamMat.dispose();
      label.map?.dispose();
      label.dispose();
      glass.dispose();
    },
  };
}
