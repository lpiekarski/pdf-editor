import { getStroke } from 'perfect-freehand';
import type { Point } from '../viewer/coords';

/** Outline polygon of a freehand stroke (same on screen and in the PDF). */
export function strokeOutline(points: Point[], width: number): Point[] {
  const out = getStroke(
    points.map((p) => [p.x, p.y]),
    { size: width * 1.6, thinning: 0.5, smoothing: 0.5, streamline: 0.4, simulatePressure: true, last: true },
  );
  return out.map(([x, y]) => ({ x, y }));
}

export function outlineToSvgPath(pts: Point[]): string {
  if (!pts.length) return '';
  const d = pts.reduce(
    (acc, p, i, arr) => {
      const n = arr[(i + 1) % arr.length];
      acc.push(`${p.x.toFixed(2)},${p.y.toFixed(2)} ${((p.x + n.x) / 2).toFixed(2)},${((p.y + n.y) / 2).toFixed(2)}`);
      return acc;
    },
    [`M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} Q`],
  );
  return d.join(' ') + ' Z';
}
