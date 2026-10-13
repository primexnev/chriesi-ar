/**
 * Contract for the small games inside the story (brief §2 "Game layer").
 * Hard rules: cannot be failed, no score, always resolves so the story continues.
 * The final game form is decided after the SW04 paper test — swap implementations freely.
 */
export interface Minigame {
  /** Resolves when the game is complete (by play or by the idle auto-finish). */
  run(): Promise<void>;
  dispose(): void;
}
