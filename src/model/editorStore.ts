import { create } from 'zustand';
import type { Color, EditorObject, FontId, StoredImage, ToolId } from './types';
import { newId } from './types';

interface Snapshot {
  objects: Record<string, EditorObject>;
  order: string[];
  formValues: Record<string, FormValue>;
}

export type FormValue = string | boolean | string[];

export interface ToolStyle {
  font: FontId;
  size: number;
  bold: boolean;
  italic: boolean;
  textColor: Color;
  stroke: Color;
  fill: Color | null;
  strokeWidth: number;
  inkColor: Color;
  inkWidth: number;
  highlightColor: Color;
  markColor: Color;
}

interface EditorState extends Snapshot {
  tool: ToolId;
  /** Tool stays active after creating an object (double-click / long-press on a tool). */
  toolLocked: boolean;
  selection: string[];
  editingId: string | null;
  style: ToolStyle;
  images: Record<string, StoredImage>;
  past: Snapshot[];
  future: Snapshot[];
  /** Merge key of the last history entry (consecutive edits with the same key collapse). */
  lastMerge: { key: string; at: number } | null;
  dirty: boolean;

  setTool(tool: ToolId, locked?: boolean): void;
  select(ids: string[]): void;
  setEditing(id: string | null): void;
  setStyle(patch: Partial<ToolStyle>): void;

  /** All document changes go through here so they are undoable. */
  change(fn: (draft: Snapshot) => void, mergeKey?: string): void;
  add(obj: EditorObject): void;
  update(id: string, patch: Partial<EditorObject>, mergeKey?: string): void;
  updateMany(ids: string[], fn: (o: EditorObject) => Partial<EditorObject>, mergeKey?: string): void;
  remove(ids: string[]): void;
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
  setFormValue(name: string, v: FormValue): void;
  addImage(img: Omit<StoredImage, 'id' | 'url'>): StoredImage;
  undo(): void;
  redo(): void;
  reset(): void;
}

const HISTORY_LIMIT = 200;
const MERGE_WINDOW_MS = 1500;

const clone = (s: Snapshot): Snapshot => ({
  objects: { ...s.objects },
  order: [...s.order],
  formValues: { ...s.formValues },
});

const initialStyle: ToolStyle = {
  font: 'sans',
  size: 12,
  bold: false,
  italic: false,
  textColor: [0, 0, 0],
  stroke: [0.85, 0.1, 0.1],
  fill: null,
  strokeWidth: 2,
  inkColor: [0.05, 0.15, 0.6],
  inkWidth: 2,
  highlightColor: [1, 0.9, 0.2],
  markColor: [0, 0, 0],
};

export const useEditor = create<EditorState>((set, get) => ({
  objects: {},
  order: [],
  formValues: {},
  tool: 'select',
  toolLocked: false,
  selection: [],
  editingId: null,
  style: initialStyle,
  images: {},
  past: [],
  future: [],
  lastMerge: null,
  dirty: false,

  setTool: (tool, locked = false) => set({ tool, toolLocked: locked, selection: [], editingId: null }),
  select: (ids) => set((s) => ({ selection: ids, editingId: s.editingId && ids.includes(s.editingId) ? s.editingId : null })),
  setEditing: (id) => set({ editingId: id }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),

  change(fn, mergeKey) {
    const s = get();
    const before: Snapshot = { objects: s.objects, order: s.order, formValues: s.formValues };
    const draft = clone(before);
    fn(draft);
    const now = Date.now();
    const merge = !!mergeKey && s.lastMerge?.key === mergeKey && now - s.lastMerge.at < MERGE_WINDOW_MS;
    set({
      ...draft,
      past: merge ? s.past : [...s.past.slice(-HISTORY_LIMIT + 1), before],
      future: [],
      lastMerge: mergeKey ? { key: mergeKey, at: now } : null,
      dirty: true,
    });
  },

  add(obj) {
    get().change((d) => {
      d.objects[obj.id] = obj;
      d.order.push(obj.id);
    });
  },

  update(id, patch, mergeKey) {
    get().change((d) => {
      const o = d.objects[id];
      if (o) d.objects[id] = { ...o, ...patch } as EditorObject;
    }, mergeKey);
  },

  updateMany(ids, fn, mergeKey) {
    get().change((d) => {
      for (const id of ids) {
        const o = d.objects[id];
        if (o) d.objects[id] = { ...o, ...fn(o) } as EditorObject;
      }
    }, mergeKey);
  },

  remove(ids) {
    if (!ids.length) return;
    get().change((d) => {
      for (const id of ids) delete d.objects[id];
      d.order = d.order.filter((x) => !ids.includes(x));
    });
    set((s) => ({ selection: s.selection.filter((x) => !ids.includes(x)), editingId: null }));
  },

  bringToFront(ids) {
    get().change((d) => {
      d.order = [...d.order.filter((x) => !ids.includes(x)), ...d.order.filter((x) => ids.includes(x))];
    });
  },

  sendToBack(ids) {
    get().change((d) => {
      d.order = [...d.order.filter((x) => ids.includes(x)), ...d.order.filter((x) => !ids.includes(x))];
    });
  },

  setFormValue(name, v) {
    get().change((d) => {
      d.formValues[name] = v;
    }, `form:${name}`);
  },

  addImage(img) {
    const id = newId();
    const url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime }));
    const stored: StoredImage = { ...img, id, url };
    set((s) => ({ images: { ...s.images, [id]: stored } }));
    return stored;
  },

  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      ...prev,
      past: s.past.slice(0, -1),
      future: [{ objects: s.objects, order: s.order, formValues: s.formValues }, ...s.future],
      selection: s.selection.filter((id) => prev.objects[id]),
      editingId: null,
      lastMerge: null,
      dirty: true,
    });
  },

  redo() {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      ...next,
      past: [...s.past, { objects: s.objects, order: s.order, formValues: s.formValues }],
      future: s.future.slice(1),
      selection: s.selection.filter((id) => next.objects[id]),
      editingId: null,
      lastMerge: null,
      dirty: true,
    });
  },

  reset() {
    set({
      objects: {},
      order: [],
      formValues: {},
      selection: [],
      editingId: null,
      images: {},
      past: [],
      future: [],
      lastMerge: null,
      dirty: false,
      tool: 'select',
    });
  },
}));

/** Objects of one page in z-order. */
export function pageObjects(s: Pick<EditorState, 'objects' | 'order'>, page: number): EditorObject[] {
  return s.order.map((id) => s.objects[id]).filter((o) => o && o.page === page);
}
