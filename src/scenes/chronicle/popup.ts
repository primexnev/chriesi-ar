import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
  type Object3D,
} from 'three';
import { easeInOut, type StoryClock } from '../../core/clock';
import { mat, mesh } from '../shared/placeholders';
import { PALETTE } from '../shared/palette';

/*
 * The pop-up book of the chronicle. It lies open on the intro meadow; every era is a set of
 * paper pieces that fold up out of its pages and fold back down before the page turns.
 * Book space: origin at the spine on the page surface, x across the spread, +z towards the reader.
 */

export const PAGE_W = 0.21;
export const PAGE_D = 0.24;
const COVER_T = 0.005;
const BLOCK_T = 0.007;
/** Height of the open pages above the book's base. */
export const PAGE_Y = COVER_T + BLOCK_T;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Overshoots a little before settling: the springy snap of a pop-up page. */
export const backOut = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** Disposes geometries of everything below `root`, plus the given owned materials. */
export function disposeTree(root: Object3D, materials: Material[] = []): void {
  root.traverse((o) => (o as Mesh).geometry?.dispose());
  materials.forEach((m) => m.dispose());
}

function coverTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 600;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4eedc';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d6ab53';
  g.lineWidth = 14;
  g.strokeRect(24, 24, c.width - 48, c.height - 48);
  g.fillStyle = '#c8263a';
  g.textAlign = 'center';
  g.font = '600 64px Georgia, serif';
  g.fillText('Die Geschichte', 256, 190);
  g.fillText('der Zuger', 256, 270);
  g.font = 'bold 92px Georgia, serif';
  g.fillText('Chriesi', 256, 380);
  // Two cherries on a stem.
  g.strokeStyle = '#5e3b1f';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(256, 430);
  g.quadraticCurveTo(230, 470, 222, 500);
  g.moveTo(256, 430);
  g.quadraticCurveTo(275, 470, 290, 495);
  g.stroke();
  g.fillStyle = '#c8263a';
  for (const [x, y] of [
    [222, 515],
    [292, 510],
  ]) {
    g.beginPath();
    g.arc(x, y, 22, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class PopupBook {
  /** Moved and scaled as a whole (flight from the chest, final exit). */
  readonly group = new Group();
  /** Era content goes here: origin at the spine on the page surface. */
  readonly pages = new Group();
  private readonly cover = new Group();
  private readonly leaf = new Group();
  private readonly owned: Material[] = [];

  constructor(private readonly clock: StoryClock) {
    this.group.name = 'popup-book';
    const red = mat(PALETTE.cherry);
    const paper = mat(PALETTE.paper);
    const box = (w: number, h: number, d: number, m: Material, x: number, y: number, parent: Object3D) => {
      const b = mesh(new BoxGeometry(w, h, d), m);
      b.position.set(x, y, 0);
      parent.add(b);
      return b;
    };
    // Left half rests on the meadow.
    box(PAGE_W + 0.008, COVER_T, PAGE_D + 0.01, red, -(PAGE_W / 2 + 0.004), COVER_T / 2, this.group);
    box(PAGE_W, BLOCK_T, PAGE_D, paper, -PAGE_W / 2, COVER_T + BLOCK_T / 2, this.group);
    // Right half hinges at the spine on the page surface; rotation.z = π closes the book.
    this.cover.position.y = PAGE_Y;
    box(PAGE_W + 0.008, COVER_T, PAGE_D + 0.01, red, PAGE_W / 2 + 0.004, COVER_T / 2 - PAGE_Y, this.cover);
    box(PAGE_W, BLOCK_T, PAGE_D, paper, PAGE_W / 2, -BLOCK_T / 2, this.cover);
    // Title on the outside of the cover, readable when the book is closed.
    const titleMat = new MeshBasicMaterial({ map: coverTexture() });
    this.owned.push(titleMat);
    const title = new Mesh(new PlaneGeometry(PAGE_W * 0.86, PAGE_D * 0.86), titleMat);
    title.rotation.set(Math.PI / 2, 0, Math.PI);
    title.position.set(PAGE_W / 2 + 0.004, -PAGE_Y - 0.0002, 0);
    this.cover.add(title);
    this.cover.rotation.z = Math.PI;
    // Single leaf used for page turns.
    this.leaf.position.y = PAGE_Y;
    box(PAGE_W - 0.004, 0.0015, PAGE_D - 0.004, paper, PAGE_W / 2, 0.00075, this.leaf);
    this.leaf.visible = false;
    this.pages.position.y = PAGE_Y;
    this.pages.visible = false;
    this.group.add(this.cover, this.leaf, this.pages);
  }

  async open(ms = 1300): Promise<void> {
    await this.clock.tween(ms, (k) => (this.cover.rotation.z = Math.PI * (1 - k)));
    this.pages.visible = true;
  }

  async close(ms = 1100): Promise<void> {
    this.pages.visible = false;
    await this.clock.tween(ms, (k) => (this.cover.rotation.z = Math.PI * k));
  }

  /** Opens instantly (for `?era=`). */
  openNow(): void {
    this.cover.rotation.z = 0;
    this.pages.visible = true;
  }

  /** One leaf turns from the right page to the left. */
  async flip(ms = 850): Promise<void> {
    this.leaf.visible = true;
    await this.clock.tween(ms, (k) => {
      this.leaf.rotation.z = Math.PI * k;
      // A slight lift in the middle of the turn so the leaf never cuts the pages.
      this.leaf.position.y = PAGE_Y + Math.sin(k * Math.PI) * 0.004;
    });
    this.leaf.visible = false;
    this.leaf.rotation.z = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group, this.owned);
  }
}

interface Piece {
  hinge: Group;
  delay: number;
  flat: boolean;
}

/**
 * One era: paper pieces standing on the pages. `stand` pieces fold up from lying flat
 * (top towards the back of the book); `lay` pieces (water, paving) grow out of the page.
 */
export class Era {
  readonly group = new Group();
  private readonly pieces: Piece[] = [];
  private readonly offs: Array<() => void> = [];
  private readonly owned: Material[] = [];

  constructor(
    protected readonly clock: StoryClock,
    name: string,
  ) {
    this.group.name = name;
    this.group.visible = false;
  }

  /** Stand `obj` on the page at (x, z). The returned hinge can be moved later (runners, guards). */
  stand(obj: Object3D, x: number, z: number, delay = 0, rotY = 0): Group {
    const hinge = new Group();
    hinge.position.set(x, 0, z);
    obj.rotation.y += rotY;
    hinge.add(obj);
    this.group.add(hinge);
    this.pieces.push({ hinge, delay, flat: false });
    this.setPiece(hinge, false, 0);
    return hinge;
  }

  /** Flat piece on the page (water, paving, meadow). */
  lay(obj: Object3D, x: number, z: number, delay = 0): Group {
    const hinge = new Group();
    hinge.position.set(x, 0, z);
    hinge.add(obj);
    this.group.add(hinge);
    this.pieces.push({ hinge, delay, flat: true });
    this.setPiece(hinge, true, 0);
    return hinge;
  }

  /** Material created by the era (not from the shared placeholder cache); disposed with it. */
  own<M extends Material>(m: M): M {
    this.owned.push(m);
    return m;
  }

  /** Per-frame animation in story time, removed on dispose. */
  tick(fn: (dt: number, t: number) => void): void {
    this.offs.push(this.clock.onUpdate(fn));
  }

  async rise(ms = 1100): Promise<void> {
    this.group.visible = true;
    await this.animate(ms, true);
  }

  async fold(ms = 650): Promise<void> {
    await this.animate(ms, false);
    this.group.visible = false;
  }

  /** Fold a single piece up or down (e.g. a tree giving way to a house). */
  async toggle(hinge: Group, up: boolean, ms = 600): Promise<void> {
    const piece = this.pieces.find((p) => p.hinge === hinge);
    if (!piece) return;
    await this.clock.tween(ms, (k) => this.setPiece(hinge, piece.flat, up ? backOut(k) : 1 - k), (t) => t);
  }

  dispose(): void {
    this.offs.forEach((off) => off());
    this.group.removeFromParent();
    disposeTree(this.group, this.owned);
  }

  private animate(ms: number, up: boolean): Promise<void> {
    // Each piece takes 45 % of the time; delays (0–1) spread the starts over the rest.
    const span = 0.45;
    return this.clock.tween(
      ms,
      (k) => {
        for (const p of this.pieces) {
          const local = clamp01((k - p.delay * (1 - span)) / span);
          this.setPiece(p.hinge, p.flat, up ? backOut(local) : 1 - easeInOut(local));
        }
      },
      (t) => t,
    );
  }

  /** k = 0 lying flat / invisible, 1 = standing. */
  private setPiece(hinge: Group, flat: boolean, k: number): void {
    hinge.visible = k > 0.001;
    if (flat) {
      const s = Math.max(0.001, k);
      hinge.scale.set(s, 1, s);
    } else {
      hinge.rotation.x = -(Math.PI / 2) * (1 - k);
    }
  }
}

/** Paper sign above the back edge of the book: year and place of the current page. */
export class YearSign {
  readonly group = new Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly board: Mesh;
  private readonly material: MeshBasicMaterial;

  constructor(private readonly clock: StoryClock) {
    this.canvas.width = 512;
    this.canvas.height = 200;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true });
    this.board = new Mesh(new PlaneGeometry(0.13, 0.0508), this.material);
    this.board.position.y = 0.15;
    const post = new CylinderGeometry(0.0016, 0.0016, 0.13, 5);
    for (const x of [-0.055, 0.055]) {
      const p = mesh(post, PALETTE.wood);
      p.position.set(x, 0.065, -0.002);
      this.group.add(p);
    }
    this.group.add(this.board);
    this.group.visible = false;
  }

  draw(title: string, sub: string): void {
    const g = this.canvas.getContext('2d')!;
    const { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f4eedc';
    g.strokeStyle = '#c8263a';
    g.lineWidth = 10;
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 36);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#c8263a';
    let size = 84;
    do g.font = `bold ${size}px Georgia, serif`;
    while (g.measureText(title).width > w - 60 && (size -= 4) > 30);
    g.fillText(title, w / 2, 102);
    g.fillStyle = '#382719';
    g.font = '36px Georgia, serif';
    g.fillText(sub, w / 2, 160);
    this.texture.needsUpdate = true;
  }

  /** Turns the board edge-on, swaps the text, turns it back. */
  async set(title: string, sub: string, ms = 600): Promise<void> {
    if (!this.group.visible) {
      this.draw(title, sub);
      this.group.visible = true;
      await this.clock.tween(ms, (k) => this.group.scale.setScalar(Math.max(0.001, backOut(k))), (t) => t);
      return;
    }
    await this.clock.tween(ms / 2, (k) => (this.board.rotation.y = (Math.PI / 2) * k));
    this.draw(title, sub);
    await this.clock.tween(ms / 2, (k) => (this.board.rotation.y = (Math.PI / 2) * (1 - k)));
  }

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group, [this.material]);
    this.texture.dispose();
  }
}
