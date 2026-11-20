import { useEffect } from 'react';
import { useEditor } from '../model/editorStore';
import { useView } from '../model/viewStore';
import { newId, type MarkupObject } from '../model/types';
import type { Rect } from '../viewer/coords';
import { MARKUP_TOOLS } from './factory';
import { unionRects } from './geometry';
import { useUi } from './uiStore';

/** Merge selection rects that sit on the same text line into one run per line. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = rects.filter((r) => r.width > 0.5 && r.height > 0.5).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y + last.height / 2 - (r.y + r.height / 2)) < Math.min(last.height, r.height) * 0.5;
    if (sameLine && r.x <= last.x + last.width + r.height) {
      out[out.length - 1] = unionRects([last, r]);
    } else if (sameLine && last && r.x < last.x + last.width) {
      out[out.length - 1] = unionRects([last, r]);
    } else {
      out.push(r);
    }
  }
  return out;
}

/** Turns the current text selection into highlight/underline/strikeout objects. Returns how many were created. */
export function applySelectionMarkup(kind: MarkupObject['kind']): number {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return 0;
  const zoom = useView.getState().zoom;
  const pages = [...document.querySelectorAll<HTMLElement>('.page[data-page]')];
  const byPage = new Map<number, Rect[]>();
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const cr of sel.getRangeAt(i).getClientRects()) {
      const cx = cr.left + cr.width / 2;
      const cy = cr.top + cr.height / 2;
      const pageEl = pages.find((p) => {
        const r = p.getBoundingClientRect();
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      });
      if (!pageEl) continue;
      const pr = pageEl.getBoundingClientRect();
      const idx = Number(pageEl.dataset.page);
      const list = byPage.get(idx) ?? [];
      list.push({ x: (cr.left - pr.left) / zoom, y: (cr.top - pr.top) / zoom, width: cr.width / zoom, height: cr.height / zoom });
      byPage.set(idx, list);
    }
  }
  const text = sel.toString();
  const st = useEditor.getState();
  let n = 0;
  st.change((d) => {
    for (const [page, rects] of byPage) {
      const quads = mergeLineRects(rects);
      if (!quads.length) continue;
      const o: MarkupObject = {
        id: newId(),
        kind,
        page,
        quads,
        rect: unionRects(quads),
        rotation: 0,
        opacity: 1,
        color: kind === 'highlight' ? st.style.highlightColor : kind === 'underline' ? [0.1, 0.4, 0.9] : [0.85, 0.1, 0.1],
        text,
      };
      d.objects[o.id] = o;
      d.order.push(o.id);
      n++;
    }
  });
  sel.removeAllRanges();
  return n;
}

/**
 * While a markup tool is active: on desktop, releasing the mouse after selecting text applies the
 * markup immediately; on touch devices (native selection handles) an "apply" button appears instead.
 */
export function useMarkupTool() {
  const tool = useEditor((s) => s.tool);
  useEffect(() => {
    if (!MARKUP_TOOLS.includes(tool)) {
      useUi.setState({ pendingMarkup: false });
      return;
    }
    const kind = tool as MarkupObject['kind'];
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      setTimeout(() => applySelectionMarkup(kind), 0);
    };
    const onSel = () => {
      const s = window.getSelection();
      useUi.setState({ pendingMarkup: !!s && !s.isCollapsed });
    };
    document.addEventListener('pointerup', onUp);
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('selectionchange', onSel);
    };
  }, [tool]);
}
