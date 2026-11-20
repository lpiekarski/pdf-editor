import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';

type Pt = [number, number, number]; // x, y, pressure

export interface DrawPadHandle {
  clear(): void;
  isEmpty(): boolean;
  /** Renders the strokes at `scale`× resolution on a transparent canvas. */
  render(scale?: number): HTMLCanvasElement;
}

function pathFor(points: Pt[], size: number, realPressure: boolean) {
  const outline = getStroke(points, { size, thinning: 0.6, smoothing: 0.55, streamline: 0.5, simulatePressure: !realPressure, last: true });
  const p = new Path2D();
  outline.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

/** Signature drawing pad: mouse, finger or stylus (with real pen pressure when available). */
export const DrawPad = forwardRef<DrawPadHandle, { color: string; onChange?(empty: boolean): void }>(function DrawPad({ color, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ pts: Pt[]; pen: boolean }[]>([]);
  const [, force] = useState(0);
  const SIZE = 4.5;

  const redraw = () => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    if (c.width !== Math.round(width * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    for (const s of strokes.current) ctx.fill(pathFor(s.pts, SIZE, s.pen));
  };

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas.current!);
    return () => ro.disconnect();
  });

  useImperativeHandle(ref, () => ({
    clear() {
      strokes.current = [];
      redraw();
      force((n) => n + 1);
      onChange?.(true);
    },
    isEmpty: () => strokes.current.length === 0,
    render(scale = 3) {
      const { width, height } = canvas.current!.getBoundingClientRect();
      const c = document.createElement('canvas');
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      const ctx = c.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.fillStyle = color;
      for (const s of strokes.current) ctx.fill(pathFor(s.pts, SIZE, s.pen));
      return c;
    },
  }));

  return (
    <canvas
      ref={canvas}
      className="draw-pad"
      aria-label="Draw your signature here"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        strokes.current.push({ pts: [[e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5]], pen: e.pointerType === 'pen' });
        redraw();
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const r = e.currentTarget.getBoundingClientRect();
        const s = strokes.current[strokes.current.length - 1];
        // Coalesced events give smoother strokes on fast pens/fingers.
        const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ev of evs) s.pts.push([ev.clientX - r.left, ev.clientY - r.top, ev.pressure || 0.5]);
        redraw();
      }}
      onPointerUp={() => onChange?.(strokes.current.length === 0)}
    />
  );
});
