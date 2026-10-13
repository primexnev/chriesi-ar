declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

  export interface MindARAnchor {
    group: Group;
    targetIndex: number;
    onTargetFound: (() => void) | null;
    onTargetLost: (() => void) | null;
    onTargetUpdate: (() => void) | null;
  }

  export class MindARThree {
    constructor(options: {
      container: HTMLElement;
      imageTargetSrc: string;
      maxTrack?: number;
      uiLoading?: 'yes' | 'no';
      uiScanning?: 'yes' | 'no';
      uiError?: 'yes' | 'no';
      filterMinCF?: number;
      filterBeta?: number;
      warmupTolerance?: number;
      missTolerance?: number;
    });
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    start(): Promise<void>;
    stop(): void;
    addAnchor(targetIndex: number): MindARAnchor;
  }
}

declare module 'mind-ar/dist/mindar-image.prod.js' {
  export class Compiler {
    compileImageTargets(images: HTMLImageElement[], progress: (percent: number) => void): Promise<unknown>;
    exportData(): Promise<ArrayBuffer>;
  }
}
