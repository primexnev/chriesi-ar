import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { Dir } from './input';

/** What each arrow does, as the child hears it. */
export const DIR_WORD: Record<Dir, string> = { up: 'Spring!', down: 'Ducken!', left: 'Links!', right: 'Rechts!' };

const ROTATION: Record<Dir, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

function paint(dir: Dir, word: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 340;
  const g = c.getContext('2d')!;
  // Round badge with a thick arrow, the same arrow as on the button below.
  g.fillStyle = '#c8263a';
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.save();
  g.translate(128, 128);
  g.rotate(ROTATION[dir]);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 26;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, 62);
  g.lineTo(0, -58);
  g.moveTo(-50, -10);
  g.lineTo(0, -62);
  g.lineTo(50, -10);
  g.stroke();
  g.restore();
  // Word underneath on a cream pill.
  g.fillStyle = '#f4eedc';
  g.beginPath();
  g.roundRect(14, 262, 228, 70, 35);
  g.fill();
  g.fillStyle = '#382719';
  g.font = 'bold 44px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(word, 128, 299);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Floating sign above the next obstacle: arrow + word. In AR the child looks at the page,
 * not at the screen corners, so the instruction has to live in the scene itself.
 */
export class ArrowSign {
  readonly sprite: Sprite;
  private textures = new Map<Dir, CanvasTexture>();
  private material: SpriteMaterial;
  private dir: Dir | null = null;

  constructor(
    private readonly size = 1.5,
    private readonly words: Record<Dir, string> = DIR_WORD,
  ) {
    this.material = new SpriteMaterial({ depthTest: false, transparent: true });
    this.sprite = new Sprite(this.material);
    this.sprite.scale.set(size, size * (340 / 256), 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  show(dir: Dir | null, x = 0, y = 0, z = 0, pulse = 0): void {
    this.sprite.visible = dir !== null;
    if (!dir) return;
    if (dir !== this.dir) {
      let t = this.textures.get(dir);
      if (!t) {
        t = paint(dir, this.words[dir]);
        this.textures.set(dir, t);
      }
      this.material.map = t;
      this.material.needsUpdate = true;
      this.dir = dir;
    }
    this.sprite.position.set(x, y, z);
    const s = this.size * (1 + pulse * 0.12);
    this.sprite.scale.set(s, s * (340 / 256), 1);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.textures.forEach((t) => t.dispose());
    this.material.dispose();
  }
}
