import { CONFIG } from '../config';
import type { AudioEngine } from '../audio/audio-engine';
import { Narrator } from '../audio/narrator';
import { Sfx } from '../audio/sfx';
import { linear, StoryClock } from '../core/clock';
import { Hud } from '../ui/hud';
import type { Subtitles } from '../ui/subtitles';

/**
 * 2D fallback for devices without WebGL: the spread as a flat papercut SVG
 * with the same narration, subtitles, bell and picking interactions.
 * Kept deliberately simple — it must work on anything that runs a browser.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const SCENE = `
<svg class="scene2d" viewBox="0 0 420 297" role="img" aria-label="Zug mit Altstadt, Brücke und Chriesibäumen">
  <rect width="420" height="297" fill="#fbf8ef"/>
  <rect width="420" height="140" fill="#cfe6f5"/>
  <g class="sun"><circle cx="360" cy="38" r="18" fill="#ffd166"/></g>
  <polygon fill="#b9c6d6" points="0,120 20,70 45,95 70,52 95,90 125,60 150,92 180,48 210,88 240,58 270,94 300,55 330,90 360,62 390,96 420,70 420,120"/>
  <polygon fill="#dfe6ee" points="0,124 30,88 55,104 85,74 115,104 150,80 185,108 220,78 255,106 290,84 325,108 360,86 395,106 420,92 420,124"/>
  <path fill="#6f9a5b" d="M0 132 C60 96 140 100 210 112 C280 122 350 112 420 118 L420 140 L0 140Z"/>
  <path fill="#5b95cf" d="M0 136 Q30 130 60 136 T120 136 T180 136 T240 136 T300 136 T360 136 T420 136 L420 160 L0 160Z"/>
  <path fill="#5b95cf" d="M205 158 C215 190 200 215 212 240 C222 262 208 280 214 297 L236 297 C230 280 244 262 234 240 C222 215 238 190 228 158Z"/>
  <ellipse cx="92" cy="222" rx="80" ry="40" fill="#d9cfb8"/>
  <g class="houses">
    <rect x="18" y="168" width="34" height="34" fill="#f4eedc"/><polygon points="14,168 35,148 56,168" fill="#b4553a"/>
    <rect x="58" y="160" width="30" height="40" fill="#f2d8b0"/><polygon points="54,160 73,140 92,160" fill="#b4553a"/>
    <rect x="94" y="166" width="34" height="34" fill="#dfe7ea"/><polygon points="90,166 111,146 132,166" fill="#b4553a"/>
  </g>
  <g class="tower">
    <rect x="140" y="104" width="22" height="96" fill="#f4eedc"/>
    <polygon points="136,104 151,80 166,104" fill="#2a6fb5"/>
    <circle cx="151" cy="128" r="6" fill="#fff" stroke="#333" stroke-width="1"/>
  </g>
  <g class="bell" role="button" tabindex="0" aria-label="Glocke läuten">
    <circle cx="151" cy="112" r="16" fill="transparent"/>
    <path class="bell-body" d="M145 118 Q145 106 151 106 Q157 106 157 118 L159 120 L143 120Z" fill="#d4a52c"/>
  </g>
  <g class="fountain"><ellipse cx="92" cy="226" rx="22" ry="8" fill="#5b95cf" stroke="#d9cfb8" stroke-width="3"/><rect x="89" y="206" width="6" height="18" fill="#d9cfb8"/></g>
  <path class="race-path" d="M60 262 C120 262 150 258 180 252 L262 252 C285 256 300 258 318 246" fill="none" stroke="#e2c99a" stroke-width="9" stroke-linecap="round"/>
  <path d="M176 262 L180 248 L262 248 L266 262 Z M190 262 a10 9 0 0 1 20 0 Z M220 262 a10 9 0 0 1 20 0 Z" fill="#d9cfb8" fill-rule="evenodd"/>
  <g class="arch"><rect x="128" y="236" width="2" height="30" fill="#a8743f"/><rect x="140" y="236" width="2" height="30" fill="#a8743f"/><rect x="128" y="236" width="14" height="3" fill="#fff"/><rect x="128" y="239" width="14" height="3" fill="#2a6fb5"/><rect x="128" y="242" width="14" height="3" fill="#fff"/></g>
  <ellipse cx="345" cy="232" rx="70" ry="28" fill="#8fbf5a"/>
  <rect x="340" y="186" width="9" height="50" fill="#7a5230"/>
  <g class="crown"><circle cx="344" cy="168" r="34" fill="#5e9e4a"/><circle cx="318" cy="182" r="22" fill="#447a37"/><circle cx="372" cy="180" r="24" fill="#447a37"/></g>
  <g class="cherries"></g>
  <g class="basket"><path d="M286 252 L292 270 L314 270 L320 252Z" fill="#a8743f"/><path d="M288 252 Q303 236 318 252" fill="none" stroke="#a8743f" stroke-width="2"/></g>
  <g class="basket-contents"></g>
  <g class="runner"><line x1="-14" y1="-14" x2="14" y2="-18" stroke="#a8743f" stroke-width="3"/><rect x="-4" y="-14" width="8" height="12" rx="4" fill="#2a6fb5"/><circle cx="0" cy="-18" r="4" fill="#f0c8a0"/></g>
</svg>`;

export async function run2D(uiEl: HTMLElement, stageEl: HTMLElement, audio: AudioEngine, subtitles: Subtitles): Promise<void> {
  stageEl.innerHTML = SCENE;
  stageEl.classList.add('is-2d');
  const svg = stageEl.querySelector('svg')!;
  const clock = new StoryClock();
  const narrator = new Narrator(audio, clock, subtitles);
  const sfx = new Sfx(audio);
  const hud = new Hud(uiEl);

  let last = performance.now();
  const loop = (now: number) => {
    clock.tick((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clock.pause();
      audio.suspend();
    } else {
      clock.resume();
      audio.resume();
    }
  });

  const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
  const runner = q<SVGGElement>('.runner');
  const path = q<SVGPathElement>('.race-path');
  const pathLen = path.getTotalLength();
  const placeRunner = (k: number) => {
    const p = path.getPointAtLength(k * pathLen);
    runner.setAttribute('transform', `translate(${p.x} ${p.y})`);
  };

  for (;;) {
    placeRunner(0);
    await clock.wait(600);
    await narrator.say('s1_intro');
    await narrator.say('s1_square');

    // Bell
    const bell = q<SVGGElement>('.bell');
    bell.classList.add('pulse');
    const tapped = onActivate(bell);
    await narrator.say('s1_bell_prompt');
    const t1 = await Promise.race([tapped.promise, clock.wait(CONFIG.bellHintAfterMs).then(() => 'timeout')]);
    if (t1 === 'timeout') {
      await narrator.say('s1_bell_hint');
      await Promise.race([tapped.promise, clock.wait(CONFIG.bellAutoRingAfterMs - CONFIG.bellHintAfterMs)]);
    }
    tapped.cancel();
    bell.classList.remove('pulse');
    bell.classList.add('swing');
    sfx.bell(0);
    sfx.bell(0.9);
    sfx.bell(1.8);
    await clock.wait(2400);
    bell.classList.remove('swing');
    await narrator.say('s1_bell_rung');

    // Race
    await Promise.all([narrator.say('s1_race'), clock.tween(7000, placeRunner, linear)]);
    await narrator.say('s1_arrive');

    // Picking
    await pickCherries(svg, clock, narrator, sfx);
    sfx.fanfare();
    await narrator.say('s1_basket_full');
    await narrator.say('s1_ending');
    await narrator.say('s1_visit');

    await new Promise<void>((resolve) => {
      const btn = hud.showAction({ icon: 'replay', label: 'Nochmals abspielen', onClick: () => (btn.remove(), resolve()) });
    });
    svg.querySelector('.basket-contents')!.replaceChildren();
  }
}

function onActivate(el: Element) {
  let cancel = () => {};
  const promise = new Promise<'tap'>((resolve) => {
    const handler = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      cancel();
      resolve('tap');
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', handler);
    cancel = () => {
      el.removeEventListener('click', handler);
      el.removeEventListener('keydown', handler);
    };
  });
  return { promise, cancel: () => cancel() };
}

async function pickCherries(svg: SVGSVGElement, clock: StoryClock, narrator: Narrator, sfx: Sfx): Promise<void> {
  const layer = svg.querySelector('.cherries')!;
  const basket = svg.querySelector('.basket-contents')!;
  const spots: Array<[number, number]> = [
    [330, 150], [352, 160], [368, 172], [322, 176], [344, 186], [306, 186], [380, 188], [338, 142],
  ];
  let remaining = spots.length;
  let picked = 0;
  let lastTap = clock.time;
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));

  const pick = (c: SVGGElement, x: number, y: number) => {
    if (c.dataset.picked) return;
    c.dataset.picked = '1';
    lastTap = clock.time;
    sfx.pop(picked++);
    remaining--;
    const tx = 296 + (picked % 4) * 4;
    const ty = 254 - Math.floor(picked / 4) * 4;
    void clock
      .tween(600, (k) => {
        const px = x + (tx - x) * k;
        const py = y + (ty - y) * k - Math.sin(k * Math.PI) * 30;
        c.setAttribute('transform', `translate(${px - x} ${py - y})`);
      }, linear)
      .then(() => {
        c.remove();
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(tx));
        dot.setAttribute('cy', String(ty));
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', '#c8263a');
        basket.appendChild(dot);
        sfx.plop();
        if (remaining === 0) done();
      });
  };

  const cherries = spots.map(([x, y]) => {
    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute('class', 'cherry2d');
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', 'Chriesi pflücken');
    g.innerHTML = `<circle cx="${x}" cy="${y}" r="14" fill="transparent"/><circle cx="${x}" cy="${y}" r="5.5" fill="#c8263a"/><path d="M${x} ${y - 5} q2 -6 5 -8" stroke="#447a37" stroke-width="1.2" fill="none"/>`;
    const act = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      pick(g, x, y);
    };
    g.addEventListener('click', act);
    g.addEventListener('keydown', act);
    layer.appendChild(g);
    return { g, x, y };
  });

  const prompt = narrator.say('s1_pick_prompt');
  let hinted = false;
  let auto = false;
  const off = clock.onUpdate(() => {
    const idle = (clock.time - lastTap) * 1000;
    if (!hinted && idle > CONFIG.pickIdleHintAfterMs) {
      hinted = true;
      void prompt.then(() => narrator.say('s1_pick_hint'));
    }
    if (!auto && idle > CONFIG.pickAutoFinishAfterMs) {
      auto = true;
      void (async () => {
        for (const c of cherries) {
          pick(c.g, c.x, c.y);
          await clock.wait(400);
        }
      })();
    }
  });
  await Promise.all([finished, prompt]);
  off();
}
