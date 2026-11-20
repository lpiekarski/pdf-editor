import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useDoc } from '../model/docStore';
import { pageObjects, useEditor } from '../model/editorStore';
import { newId, type EditorObject } from '../model/types';
import { pdfjs, type PageInfo, type PDFDocumentProxy } from '../viewer/pdfjs';
import { getTextContent } from '../viewer/PageView';
import { detectFields, type DetectedField, type TextItemLike } from './detect';
import { center } from '../editor/geometry';

/** Fill mode shows clickable hotspots on detected blanks. */
export const useFill = create<{ on: boolean; toggle(v?: boolean): void }>((set) => ({
  on: false,
  toggle: (v) => set((s) => ({ on: v ?? !s.on })),
}));

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<DetectedField[]>>>();
export function detectedFor(pdf: PDFDocumentProxy, info: PageInfo): Promise<DetectedField[]> {
  let m = cache.get(pdf);
  if (!m) cache.set(pdf, (m = new Map()));
  let p = m.get(info.index);
  if (!p) {
    p = (async () => {
      const page = await pdf.getPage(info.index + 1);
      const [ol, text] = await Promise.all([page.getOperatorList(), getTextContent(pdf, info.index)]);
      return detectFields(info.index, info, ol, pdfjs.OPS, text.items as TextItemLike[]);
    })().catch(() => []);
    m.set(info.index, p);
  }
  return p;
}

export function useDetected(info: PageInfo, enabled: boolean): DetectedField[] {
  const pdf = useDoc((s) => s.pdf);
  const [fields, setFields] = useState<DetectedField[]>([]);
  useEffect(() => {
    if (!pdf || !enabled) return;
    let alive = true;
    detectedFor(pdf, info).then((f) => alive && setFields(f));
    return () => {
      alive = false;
    };
  }, [pdf, info, enabled]);
  return enabled ? fields : [];
}

const inside = (o: EditorObject, f: DetectedField) => {
  const c = center(o.rect);
  return c.x >= f.rect.x && c.x <= f.rect.x + f.rect.width && c.y >= f.rect.y - 4 && c.y <= f.rect.y + f.rect.height + 4;
};

/** Text object sized and positioned to sit on a detected line / inside a box. */
export function textForField(f: DetectedField, page: number): EditorObject {
  const st = useEditor.getState().style;
  const size = Math.round(Math.min(f.fontSize, f.kind === 'box' ? f.rect.height * 0.6 : f.fontSize));
  const h = size * 1.2;
  const y = f.kind === 'box' ? f.rect.y + Math.min(4, (f.rect.height - h) / 2) : f.rect.y + f.rect.height - h - 1;
  return {
    id: newId(), kind: 'text', page, rotation: 0, opacity: 1,
    rect: { x: f.rect.x + 2, y, width: Math.max(20, f.rect.width - 4), height: h },
    text: '', font: st.font, bold: false, italic: false, size, color: st.textColor, align: 'left', background: null,
  };
}

export function fillField(f: DetectedField, page: number) {
  const st = useEditor.getState();
  if (f.kind === 'checkbox') {
    const existing = pageObjects(st, page).find((o) => o.kind === 'mark' && inside(o, f));
    if (existing) return st.remove([existing.id]);
    const s = f.rect.width * 0.85;
    const c = center(f.rect);
    st.add({ id: newId(), kind: 'mark', mark: 'check', page, rotation: 0, opacity: 1, color: st.style.markColor, rect: { x: c.x - s / 2, y: c.y - s / 2, width: s, height: s } });
    return;
  }
  const o = textForField(f, page);
  st.add(o);
  st.select([o.id]);
  st.setEditing(o.id);
}

export function FillLayer({ info, zoom }: { info: PageInfo; zoom: number }) {
  const on = useFill((s) => s.on);
  const fields = useDetected(info, on);
  const objects = useEditor(useShallow((s) => pageObjects(s, info.index)));
  if (!on || !fields.length) return null;
  return (
    <div className="fill-layer">
      {fields.map((f) => {
        const filled = objects.some((o) => (o.kind === 'text' || o.kind === 'mark') && inside(o, f));
        if (filled && f.kind !== 'checkbox') return null;
        return (
          <button
            key={f.id}
            className={`hotspot hotspot-${f.kind}${filled ? ' filled' : ''}`}
            style={{ left: f.rect.x * zoom, top: f.rect.y * zoom, width: f.rect.width * zoom, height: f.rect.height * zoom }}
            aria-label={f.kind === 'checkbox' ? 'Tick box' : 'Fill in here'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => fillField(f, info.index)}
          />
        );
      })}
    </div>
  );
}

/** Runs detection on every page (for the "make fillable" conversion and the count shown to the user). */
export async function detectAll(pdf: PDFDocumentProxy, pages: PageInfo[]): Promise<DetectedField[]> {
  const all: DetectedField[] = [];
  for (const p of pages) all.push(...(await detectedFor(pdf, p)));
  return all;
}
