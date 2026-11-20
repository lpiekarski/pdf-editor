import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IconOpen = (p: P) => (
  <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const IconSave = (p: P) => (
  <svg {...base(p)}><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" /></svg>
);
export const IconZoomIn = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
);
export const IconZoomOut = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
);
export const IconFitWidth = (p: P) => (
  <svg {...base(p)}><path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3" /></svg>
);
export const IconPages = (p: P) => (
  <svg {...base(p)}><rect x="4" y="3" width="7" height="9" rx="1" /><rect x="13" y="3" width="7" height="9" rx="1" /><rect x="4" y="14" width="7" height="7" rx="1" /><rect x="13" y="14" width="7" height="7" rx="1" /></svg>
);
export const IconSelect = (p: P) => (
  <svg {...base(p)}><path d="M5 3l14 8-6 2-2 6z" /></svg>
);
export const IconText = (p: P) => (
  <svg {...base(p)}><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg>
);
export const IconImage = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></svg>
);
export const IconShape = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="10" height="10" rx="1" /><circle cx="16" cy="16" r="5" /></svg>
);
export const IconPen = (p: P) => (
  <svg {...base(p)}><path d="M3 21c3-1 5-3 7-6s5-8 8-10c1 1 1 2 0 3-3 3-8 6-11 9" /></svg>
);
export const IconHighlight = (p: P) => (
  <svg {...base(p)}><path d="M9 11l-5 5v4h4l5-5M15 5l4 4-6 6-4-4z" /></svg>
);
export const IconNote = (p: P) => (
  <svg {...base(p)}><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /></svg>
);
export const IconWhiteout = (p: P) => (
  <svg {...base(p)}><rect x="3" y="7" width="18" height="10" rx="1" strokeDasharray="3 2" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M5 12l5 5L20 7" /></svg>
);
export const IconSign = (p: P) => (
  <svg {...base(p)}><path d="M3 17c3-6 5 2 8-3s4 4 7 0M3 21h18" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconUndo = (p: P) => (
  <svg {...base(p)}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
);
export const IconRedo = (p: P) => (
  <svg {...base(p)}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconMore = (p: P) => (
  <svg {...base(p)}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
);
export const IconSliders = (p: P) => (
  <svg {...base(p)}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
);
export const IconForm = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h4M7 14h10" /></svg>
);
export const IconSeal = (p: P) => (
  <svg {...base(p)}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5" /><path d="M14 3l5 5h-5z" /><circle cx="17" cy="15" r="3" /><path d="M15.5 17.6 15 22l2-1 2 1-.5-4.4" /></svg>
);
