import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import type { StoryClock } from '../../core/clock';

let texture: CanvasTexture | null = null;

function ringTexture(): CanvasTexture {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.lineWidth = 10;
  g.strokeStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.strokeStyle = '#c8263a';
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Pulsing ring that says "tap here" without words. Always faces the camera. */
export class TapMarker {
  readonly sprite: Sprite;
  private off: (() => void) | null = null;

  constructor(
    private readonly clock: StoryClock,
    private readonly size = 0.05,
  ) {
    this.sprite = new Sprite(new SpriteMaterial({ map: ringTexture(), transparent: true, depthTest: false }));
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    this.sprite.raycast = () => {}; // never steals taps
  }

  show(): void {
    this.sprite.visible = true;
    this.off?.();
    this.off = this.clock.onUpdate((_dt, t) => {
      const k = (t * 1.4) % 1;
      this.sprite.scale.setScalar(this.size * (0.7 + k * 0.6));
      this.sprite.material.opacity = 1 - k;
    });
  }

  hide(): void {
    this.sprite.visible = false;
    this.off?.();
    this.off = null;
  }
}
