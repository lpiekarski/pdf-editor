/**
 * Heuristic detection of fillable regions on PDFs that have no form fields:
 * underlines ("Name: ________" drawn as lines or as underscore characters), small square boxes
 * (checkboxes), larger boxes (text areas / signature boxes) and "Label:" followed by blank space.
 *
 * Works on vector PDFs. Scanned pages contain only an image, so nothing is found there and the
 * user falls back to placing text manually.
 */
import type { Matrix, PageGeometry, Rect } from '../viewer/coords';
import { multiply, pdfRectToView, viewSize } from '../viewer/coords';

export type DetectedKind = 'line' | 'checkbox' | 'box';

export interface DetectedField {
  id: string;
  page: number;
  kind: DetectedKind;
  /** View units (top-left origin, page rotation applied). */
  rect: Rect;
  /** Suggested font size for text placed here. */
  fontSize: number;
}

export interface OperatorListLike {
  fnArray: number[];
  argsArray: unknown[];
}

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export interface OpsCodes {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
}

interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type PdfBox = { x0: number; y0: number; x1: number; y1: number };

const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Collects line segments and closed rectangles (in PDF user space) from a pdf.js operator list. */
export function extractGeometry(ol: OperatorListLike, ops: OpsCodes): { segs: Seg[]; rects: PdfBox[] } {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const segs: Seg[] = [];
  const rects: PdfBox[] = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i] as unknown[];
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === ops.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === ops.constructPath) {
      const data = (args?.[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      // Decode: 0 moveTo(x,y) 1 lineTo(x,y) 2 curveTo(6) 3 quadTo(4) 4 close
      const pts: { x: number; y: number }[] = [];
      let start: { x: number; y: number } | null = null;
      let cur: { x: number; y: number } | null = null;
      let curved = false;
      let closed = false;
      const pathSegs: Seg[] = [];
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === 0) {
          cur = start = apply(ctm, data[k], data[k + 1]);
          pts.push(cur);
          k += 2;
        } else if (op === 1) {
          const p = apply(ctm, data[k], data[k + 1]);
          if (cur) pathSegs.push({ x0: cur.x, y0: cur.y, x1: p.x, y1: p.y });
          cur = p;
          pts.push(p);
          k += 2;
        } else if (op === 2) {
          curved = true;
          cur = apply(ctm, data[k + 4], data[k + 5]);
          k += 6;
        } else if (op === 3) {
          curved = true;
          cur = apply(ctm, data[k + 2], data[k + 3]);
          k += 4;
        } else if (op === 4) {
          if (cur && start) pathSegs.push({ x0: cur.x, y0: cur.y, x1: start.x, y1: start.y });
          closed = true;
          cur = start;
        } else break; // unknown encoding: stop
      }
      // Axis-aligned rectangle (4 or 5 points, closed or returning to start). Its edges are not lines.
      let isRect = false;
      if (!curved && pts.length >= 4 && pts.length <= 5) {
        const xs = [...new Set(pts.map((p) => Math.round(p.x * 2) / 2))];
        const ys = [...new Set(pts.map((p) => Math.round(p.y * 2) / 2))];
        const back = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1;
        if (xs.length === 2 && ys.length === 2 && (closed || back || pts.length === 4)) {
          rects.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
          isRect = true;
        }
      }
      if (!isRect) segs.push(...pathSegs);
    }
  }
  return { segs, rects };
}

let seq = 0;
const nid = () => `d${++seq}`;

function iou(a: Rect, b: Rect) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
}

export function detectFields(
  page: number,
  g: PageGeometry,
  ol: OperatorListLike,
  ops: OpsCodes,
  text: TextItemLike[],
): DetectedField[] {
  const { segs, rects } = extractGeometry(ol, ops);
  const pageView = viewSize(g, 1);
  const toView = (b: PdfBox) => pdfRectToView(g, 1, { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
  const out: DetectedField[] = [];

  // Text item boxes in view space (for "is this area blank?" checks and label detection).
  const textBoxes = text
    .filter((t) => t.str.trim())
    .map((t) => {
      const size = Math.hypot(t.transform[2], t.transform[3]) || t.height || 10;
      const b = toView({ x0: t.transform[4], y0: t.transform[5] - size * 0.25, x1: t.transform[4] + t.width, y1: t.transform[5] + size * 0.85 });
      return { t, size, b };
    });
  const hasTextIn = (r: Rect) =>
    textBoxes.some(({ t, b }) => !/^[_.\s…]+$/.test(t.str) && iou(r, b) > 0 && b.x < r.x + r.width - 2 && b.x + b.width > r.x + 2 && b.y < r.y + r.height - 2 && b.y + b.height > r.y + 2);

  const nearbyFont = (r: Rect) => {
    const near = textBoxes.filter(({ b }) => Math.abs(b.y + b.height - (r.y + r.height)) < 30).map(({ size }) => size);
    return near.length ? Math.min(14, Math.max(8, near[0])) : 11;
  };

  // 1. Horizontal lines → write-on-the-line fields.
  for (const s of segs) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    if (len < 40) continue;
    const v = toView({ x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) });
    const horizontal = v.height < 1.5;
    if (!horizontal || v.width > pageView.width * 0.92) continue;
    const fs = nearbyFont(v);
    const r = { x: v.x, y: v.y - fs * 1.35, width: v.width, height: fs * 1.35 };
    if (hasTextIn(r)) continue;
    out.push({ id: nid(), page, kind: 'line', rect: r, fontSize: fs });
  }

  // 2. Rectangles → checkboxes (small squares) or boxes (larger, empty).
  for (const b of rects) {
    const v = toView(b);
    if (v.width > pageView.width * 0.92 || v.height > pageView.height * 0.5) continue;
    if (v.width >= 6 && v.width <= 24 && Math.abs(v.width - v.height) <= 3) {
      out.push({ id: nid(), page, kind: 'checkbox', rect: v, fontSize: v.height });
    } else if (v.width >= 40 && v.height >= 12 && !hasTextIn(v)) {
      out.push({ id: nid(), page, kind: 'box', rect: v, fontSize: Math.min(12, Math.max(8, v.height * 0.6)) });
    }
  }

  // 3. Underscore / dot leaders typed as text ("Phone: ________").
  for (const { t, size } of textBoxes) {
    for (const m of t.str.matchAll(/_{3,}|\.{6,}|…{3,}/g)) {
      const k0 = m.index! / t.str.length;
      const k1 = (m.index! + m[0].length) / t.str.length;
      const x0 = t.transform[4] + t.width * k0;
      const x1 = t.transform[4] + t.width * k1;
      const v = toView({ x0, y0: t.transform[5], x1, y1: t.transform[5] + 0.1 });
      const fs = Math.min(14, Math.max(8, size));
      out.push({ id: nid(), page, kind: 'line', rect: { x: v.x, y: v.y - fs * 1.2, width: v.width, height: fs * 1.35 }, fontSize: fs });
    }
  }

  // 4. "Label:" followed by blank space on the same line.
  for (const { t, size, b } of textBoxes) {
    if (!/:\s*$/.test(t.str) || t.str.length > 40) continue;
    const startX = b.x + b.width + 4;
    const sameLine = textBoxes.filter((o) => o.b !== b && Math.abs(o.b.y - b.y) < size * 0.6 && o.b.x >= startX - 1);
    const endX = Math.min(pageView.width - 36, ...sameLine.map((o) => o.b.x - 4));
    if (endX - startX < 60) continue;
    const r = { x: startX, y: b.y, width: endX - startX, height: b.height };
    if (out.some((o) => intersects(o.rect, r))) continue; // the blank already has a drawn line/box
    out.push({ id: nid(), page, kind: 'line', rect: r, fontSize: Math.min(14, Math.max(8, size)) });
  }

  // Merge duplicates (e.g. a drawn line under a "Label:" gap): keep the earlier, more precise one.
  const merged: DetectedField[] = [];
  for (const f of out) {
    if (merged.some((m) => iou(m.rect, f.rect) > 0.3 || (m.kind === f.kind && overlapX(m.rect, f.rect) > 0.6 && Math.abs(m.rect.y - f.rect.y) < 8))) continue;
    merged.push(f);
  }
  return merged;
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function overlapX(a: Rect, b: Rect) {
  const o = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  return o / Math.min(a.width, b.width);
}
