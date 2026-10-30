/** Inline SVG icons (no icon font, no extra request). All use currentColor. */
const svg = (body: string, viewBox = '0 0 24 24') =>
  `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  soundOn: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  subtitles: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M7 12.5h4M13 12.5h4M7 15.5h7"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  scan: svg(
    '<rect x="6" y="40" width="88" height="44" rx="3" fill="#fbf8ef" stroke="#2a6fb5" stroke-width="3"/>' +
      '<path d="M50 40v44" stroke="#2a6fb5" stroke-width="2" stroke-dasharray="4 4"/>' +
      '<circle cx="72" cy="60" r="6" fill="#c8263a" stroke="none"/><circle cx="80" cy="64" r="6" fill="#c8263a" stroke="none"/>' +
      '<path d="M18 74l10-14 8 9 6-6 10 11" stroke="#5e9e4a" stroke-width="3"/>' +
      '<g class="scan-phone"><rect x="30" y="4" width="40" height="66" rx="7" fill="rgba(255,255,255,.35)" stroke="#333" stroke-width="3.5"/><path d="M36 14h28M36 60h28" stroke="#333" stroke-width="2"/></g>',
    '0 0 100 90',
  ),
  arrowUp: svg('<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>'),
  arrowDown: svg('<path d="M12 5v14M5.5 12.5L12 19l6.5-6.5"/>'),
  arrowLeft: svg('<path d="M19 12H5M11.5 5.5L5 12l6.5 6.5"/>'),
  arrowRight: svg('<path d="M5 12h14M12.5 5.5L19 12l-6.5 6.5"/>'),
  flag: svg('<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>'),
  ladder: svg('<path d="M8 3v18M16 3v18M8 7h8M8 11h8M8 15h8M8 19h8"/>'),
  book: svg('<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/>'),
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9.5 18h5"/>'),
  cherries: svg(
    '<path d="M52 8c-8 10-16 24-22 44M52 8c4 14 10 28 22 42" stroke="#5e3b1f" stroke-width="3"/>' +
      '<path d="M52 8c10-6 22-6 30 2-10 6-22 6-30-2z" fill="#5e9e4a" stroke="none"/>' +
      '<circle cx="28" cy="64" r="16" fill="#c8263a" stroke="none"/><circle cx="76" cy="62" r="16" fill="#c8263a" stroke="none"/>' +
      '<circle cx="22" cy="58" r="4" fill="#fff" opacity=".55" stroke="none"/><circle cx="70" cy="56" r="4" fill="#fff" opacity=".55" stroke="none"/>',
    '0 0 100 84',
  ),
} as const;

export type IconName = keyof typeof ICONS;
