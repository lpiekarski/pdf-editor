/**
 * Mapping between PDF user space and page-view (CSS pixel) space.
 *
 * Mirrors pdf.js PageViewport so editor overlays line up exactly with the rendered canvas,
 * but is a pure, dependency-free module usable in the export pipeline and tests.
 */
export type Matrix = [number, number, number, number, number, number];
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export interface PageGeometry {
  /** Visible box in PDF units: [x0, y0, x1, y1] (CropBox intersected with MediaBox). */
  viewBox: [number, number, number, number];
  /** Page /Rotate, normalised to 0/90/180/270. */
  rotation: number;
}

export function normalizeRotation(r: number): number {
  const n = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return n;
}

/** Transform from PDF user space to view space at the given scale (1 = 72 CSS px per inch). */
export function viewTransform(g: PageGeometry, scale: number): Matrix {
  const [x0, y0, x1, y1] = g.viewBox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let a: number, b: number, c: number, d: number;
  switch (normalizeRotation(g.rotation)) {
    case 90: a = 0; b = 1; c = 1; d = 0; break;
    case 180: a = -1; b = 0; c = 0; d = 1; break;
    case 270: a = 0; b = -1; c = -1; d = 0; break;
    default: a = 1; b = 0; c = 0; d = -1;
  }
  let ox: number, oy: number;
  if (a === 0) {
    ox = Math.abs(cy - y0) * scale;
    oy = Math.abs(cx - x0) * scale;
  } else {
    ox = Math.abs(cx - x0) * scale;
    oy = Math.abs(cy - y0) * scale;
  }
  return [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
}

/** Size of the page in view space. */
export function viewSize(g: PageGeometry, scale: number): { width: number; height: number } {
  const [x0, y0, x1, y1] = g.viewBox;
  const w = (x1 - x0) * scale;
  const h = (y1 - y0) * scale;
  return normalizeRotation(g.rotation) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  // m1 then m2 (row-vector convention, same as PDF `cm`)
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function pdfToView(g: PageGeometry, scale: number, p: Point): Point {
  return apply(viewTransform(g, scale), p);
}

export function viewToPdf(g: PageGeometry, scale: number, p: Point): Point {
  return apply(invert(viewTransform(g, scale)), p);
}

/** Axis-aligned bounding rect in view space of a PDF-space rect. */
export function pdfRectToView(g: PageGeometry, scale: number, r: Rect): Rect {
  return boundsOf([
    pdfToView(g, scale, { x: r.x, y: r.y }),
    pdfToView(g, scale, { x: r.x + r.width, y: r.y + r.height }),
  ]);
}

export function viewRectToPdf(g: PageGeometry, scale: number, r: Rect): Rect {
  return boundsOf([
    viewToPdf(g, scale, { x: r.x, y: r.y }),
    viewToPdf(g, scale, { x: r.x + r.width, y: r.y + r.height }),
  ]);
}

export function boundsOf(pts: Point[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
