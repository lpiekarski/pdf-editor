import type { Point, Rect } from '../viewer/coords';

export const deg2rad = (d: number) => (d * Math.PI) / 180;

export function rotate(p: Point, deg: number): Point {
  const a = deg2rad(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * Resize a (possibly rotated) rect by dragging a handle.
 * hx/hy ∈ {-1,0,1}: which side is dragged. delta is the pointer movement in view units.
 * Rotation is clockwise degrees on screen (y down), so screen rotation == math rotation here.
 */
export function resizeRect(
  r: Rect,
  rotation: number,
  hx: number,
  hy: number,
  delta: Point,
  opts: { keepAspect?: boolean; min?: number } = {},
): Rect {
  const min = opts.min ?? 4;
  const local = rotate(delta, -rotation);
  let dw = hx * local.x;
  let dh = hy * local.y;
  if (opts.keepAspect && hx !== 0 && hy !== 0) {
    const ratio = r.width / r.height;
    // Follow the dominant axis.
    if (Math.abs(dw) / r.width > Math.abs(dh) / r.height) dh = dw / ratio;
    else dw = dh * ratio;
  }
  const w = Math.max(min, r.width + dw);
  const h = Math.max(min, r.height + dh);
  dw = w - r.width;
  dh = h - r.height;
  const shift = rotate({ x: (hx * dw) / 2, y: (hy * dh) / 2 }, rotation);
  const c = center(r);
  const nc = { x: c.x + shift.x, y: c.y + shift.y };
  return { x: nc.x - w / 2, y: nc.y - h / 2, width: w, height: h };
}

/** Angle (clockwise degrees, 0 = handle straight above centre) from centre to pointer. */
export function angleFrom(c: Point, p: Point, snap: boolean): number {
  let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  a = ((a % 360) + 360) % 360;
  const step = snap ? 15 : 0;
  if (step) a = Math.round(a / step) * step;
  else for (const s of [0, 90, 180, 270, 360]) if (Math.abs(a - s) < 3) a = s % 360;
  return a % 360;
}

export function unionRects(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.width));
  const y2 = Math.max(...rs.map((r) => r.y + r.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function clampRectToPage(r: Rect, page: { width: number; height: number }): Rect {
  const x = Math.min(Math.max(r.x, -r.width + 8), page.width - 8);
  const y = Math.min(Math.max(r.y, -r.height + 8), page.height - 8);
  return { ...r, x, y };
}
