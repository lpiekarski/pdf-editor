import type { Point, Rect } from '../viewer/coords';
import { newId, type EditorObject, type ToolId } from '../model/types';
import type { ToolStyle } from '../model/editorStore';

export const DEFAULT_TEXT_WIDTH = 180;

export function formatDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Tools that create an object with a single tap/click at a point. */
export function createAtPoint(tool: ToolId, page: number, p: Point, st: ToolStyle): EditorObject | null {
  const base = { id: newId(), page, rotation: 0, opacity: 1 };
  switch (tool) {
    case 'text':
    case 'date': {
      const h = st.size * 1.2;
      return {
        ...base,
        kind: 'text',
        rect: { x: p.x, y: p.y - h / 2, width: tool === 'date' ? st.size * 6 : DEFAULT_TEXT_WIDTH, height: h },
        text: tool === 'date' ? formatDate() : '',
        font: st.font,
        bold: st.bold,
        italic: st.italic,
        size: st.size,
        color: st.textColor,
        align: 'left',
        background: null,
      };
    }
    case 'check':
    case 'cross':
    case 'dot': {
      const s = Math.max(8, st.size);
      return { ...base, kind: 'mark', mark: tool, color: st.markColor, rect: { x: p.x - s / 2, y: p.y - s / 2, width: s, height: s } };
    }
    case 'note':
      return { ...base, kind: 'note', text: '', color: [1, 0.85, 0.3], rect: { x: p.x - 10, y: p.y - 10, width: 20, height: 20 } };
    default:
      return null;
  }
}

/** Tools that create an object by dragging a box (a tap gives a default size). */
export function createFromDrag(tool: ToolId, page: number, r: Rect, st: ToolStyle, a: Point, b: Point): EditorObject | null {
  const base = { id: newId(), page, rotation: 0, opacity: 1 };
  const tiny = r.width < 4 && r.height < 4;
  switch (tool) {
    case 'rect':
    case 'ellipse':
    case 'whiteout': {
      const rect = tiny ? { x: a.x - 50, y: a.y - 30, width: 100, height: 60 } : r;
      if (tool === 'whiteout') return { ...base, kind: 'whiteout', color: [1, 1, 1], rect };
      return { ...base, kind: 'shape', shape: tool, stroke: st.stroke, fill: st.fill, strokeWidth: st.strokeWidth, rect };
    }
    case 'line':
    case 'arrow': {
      if (tiny) b = { x: a.x + 100, y: a.y };
      const pad = Math.max(2, st.strokeWidth * 3);
      const rect = {
        x: Math.min(a.x, b.x) - pad,
        y: Math.min(a.y, b.y) - pad,
        width: Math.abs(a.x - b.x) + 2 * pad,
        height: Math.abs(a.y - b.y) + 2 * pad,
      };
      const rel = (p: Point) => ({ x: (p.x - rect.x) / rect.width, y: (p.y - rect.y) / rect.height });
      return { ...base, kind: 'shape', shape: tool, stroke: st.stroke, fill: null, strokeWidth: st.strokeWidth, rect, from: rel(a), to: rel(b) };
    }
    default:
      return null;
  }
}

export function inkFromPoints(page: number, pts: Point[], st: ToolStyle): EditorObject | null {
  if (pts.length < 2) return null;
  const pad = st.inkWidth * 2;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const rect = {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + 2 * pad,
    height: Math.max(...ys) - Math.min(...ys) + 2 * pad,
  };
  return {
    id: newId(),
    page,
    rotation: 0,
    opacity: 1,
    kind: 'ink',
    color: st.inkColor,
    width: st.inkWidth,
    rect,
    paths: [pts.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y }))],
  };
}

export const DRAG_TOOLS: ToolId[] = ['rect', 'ellipse', 'line', 'arrow', 'whiteout'];
export const POINT_TOOLS: ToolId[] = ['text', 'date', 'check', 'cross', 'dot', 'note'];
export const MARKUP_TOOLS: ToolId[] = ['highlight', 'underline', 'strikeout'];
/** Tools that stay active after use (repetitive work like ticking boxes or drawing). */
export const STICKY_TOOLS: ToolId[] = ['ink', 'check', 'cross', 'dot', 'highlight', 'underline', 'strikeout'];
