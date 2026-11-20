import { useEffect, useState, type CSSProperties } from 'react';
import { useDoc } from '../model/docStore';
import { useEditor, type FormValue } from '../model/editorStore';
import type { PageInfo, PDFDocumentProxy } from '../viewer/pdfjs';
import { pdfRectToView } from '../viewer/coords';
import { loadWidgets, type Widget } from './acroform';

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<Widget[]>>>();
export function widgetsFor(pdf: PDFDocumentProxy, page: number): Promise<Widget[]> {
  let m = cache.get(pdf);
  if (!m) cache.set(pdf, (m = new Map()));
  let p = m.get(page);
  if (!p) m.set(page, (p = loadWidgets(pdf, page)));
  return p;
}

export function usePageWidgets(page: number): Widget[] {
  const pdf = useDoc((s) => s.pdf);
  const [w, setW] = useState<Widget[]>([]);
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    widgetsFor(pdf, page).then((x) => alive && setW(x));
    return () => {
      alive = false;
    };
  }, [pdf, page]);
  return w;
}

/** HTML inputs over the page's AcroForm widgets. Values live in the editor store (undoable). */
export function FormLayer({ info, zoom, lockedBy }: { info: PageInfo; zoom: number; lockedBy?: (name: string) => string | null }) {
  const widgets = usePageWidgets(info.index);
  const values = useEditor((s) => s.formValues);
  if (!widgets.length) return null;
  return (
    <div className="form-layer">
      {widgets.map((w) => {
        if (w.kind === 'signature' || w.kind === 'button') return null;
        const r = pdfRectToView(info, zoom, { x: w.rect[0], y: w.rect[1], width: w.rect[2] - w.rect[0], height: w.rect[3] - w.rect[1] });
        const value: FormValue = values[w.name] ?? w.value;
        const lockOwner = lockedBy?.(w.name) ?? null;
        const locked = w.readOnly || !!lockOwner;
        const fontPx = (w.fontSize || Math.min(12, Math.max(6, (r.height / zoom) * (w.multiline ? 0.35 : 0.68)))) * zoom;
        const style: CSSProperties = { left: r.x, top: r.y, width: r.width, height: r.height, fontSize: fontPx, textAlign: w.align };
        const set = (v: FormValue) => useEditor.getState().setFormValue(w.name, v);
        const common = { className: `field field-${w.kind}${w.required ? ' required' : ''}`, style, disabled: locked, 'aria-label': w.name, 'data-field': w.name, title: lockOwner ? `${w.name} — locked by the signature of ${lockOwner}` : w.name };
        switch (w.kind) {
          case 'text':
            if (w.multiline)
              return <textarea key={w.id} {...common} value={String(value)} maxLength={w.maxLen ?? undefined} onChange={(e) => set(e.target.value)} />;
            return (
              <input
                key={w.id}
                {...common}
                type={w.password ? 'password' : 'text'}
                value={String(value)}
                maxLength={w.maxLen ?? undefined}
                style={w.comb && w.maxLen ? { ...style, letterSpacing: r.width / w.maxLen - fontPx * 0.6, paddingLeft: (r.width / w.maxLen - fontPx * 0.6) / 2, fontFamily: 'monospace' } : style}
                onChange={(e) => set(e.target.value)}
              />
            );
          case 'checkbox':
            return (
              <label key={w.id} {...common}>
                <input type="checkbox" checked={value === true} disabled={locked} onChange={(e) => set(e.target.checked)} aria-label={w.name} />
                <span className="tick" style={{ fontSize: r.height * 0.85 }}>✓</span>
              </label>
            );
          case 'radio':
            return (
              <label key={w.id} {...common}>
                <input type="radio" name={`r-${w.name}`} checked={value === w.onValue} disabled={locked} onChange={() => set(w.onValue ?? '')} aria-label={`${w.name} ${w.onValue}`} />
                <span className="dot" />
              </label>
            );
          case 'combo':
            return (
              <select key={w.id} {...common} value={String(Array.isArray(value) ? value[0] ?? '' : value)} onChange={(e) => set(e.target.value)}>
                {!w.options.some((o) => o.value === value) && <option value={String(value)}>{String(value)}</option>}
                {w.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            );
          case 'list':
            return (
              <select
                key={w.id}
                {...common}
                multiple={w.multiSelect}
                size={Math.max(2, Math.floor(r.height / (fontPx * 1.3)))}
                value={w.multiSelect ? (Array.isArray(value) ? value : [String(value)]) : String(Array.isArray(value) ? value[0] ?? '' : value)}
                onChange={(e) => set(w.multiSelect ? [...e.target.selectedOptions].map((o) => o.value) : [e.target.value])}
              >
                {w.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            );
        }
      })}
    </div>
  );
}
