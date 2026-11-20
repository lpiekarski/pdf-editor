import { create } from 'zustand';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface ViewState {
  zoom: number;
  currentPage: number; // 0-based
  /** Set when the user asks to scroll to a page; the viewer consumes it. */
  scrollRequest: { page: number; nonce: number } | null;
  /** Request a fit; the viewer computes the zoom from its own size. */
  fitRequest: { mode: 'width' | 'page'; nonce: number } | null;
  sheet: null | 'pages' | 'signatures' | 'inspector' | 'menu';
  setZoom(z: number): void;
  setCurrentPage(p: number): void;
  goToPage(p: number): void;
  fit(mode: 'width' | 'page'): void;
  setSheet(s: ViewState['sheet']): void;
}

let nonce = 0;
export const useView = create<ViewState>((set) => ({
  zoom: 1,
  currentPage: 0,
  scrollRequest: null,
  fitRequest: null,
  sheet: null,
  setZoom: (z) => set({ zoom: clampZoom(z) }),
  setCurrentPage: (p) => set({ currentPage: p }),
  goToPage: (p) => set({ scrollRequest: { page: p, nonce: ++nonce } }),
  fit: (mode) => set({ fitRequest: { mode, nonce: ++nonce } }),
  setSheet: (s) => set((st) => ({ sheet: st.sheet === s ? null : s })),
}));
