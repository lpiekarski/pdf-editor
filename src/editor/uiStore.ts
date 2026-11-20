import { create } from 'zustand';

/** Transient editor UI state that is not part of the document (and not undoable). */
interface UiState {
  menu: { x: number; y: number; ids: string[] } | null;
  noteOpen: string | null;
  /** Touch devices: a markup tool is active and text is selected → show "apply" button. */
  pendingMarkup: boolean;
  toast: string | null;
  openMenu(x: number, y: number, ids: string[]): void;
  closeMenu(): void;
  showToast(msg: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const useUi = create<UiState>((set) => ({
  menu: null,
  noteOpen: null,
  pendingMarkup: false,
  toast: null,
  openMenu: (x, y, ids) => set({ menu: { x, y, ids } }),
  closeMenu: () => set({ menu: null }),
  showToast(msg) {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));
