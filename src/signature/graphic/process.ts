/** Image helpers for graphical signatures: trimming, background removal, rendering typed names. */
import { cssFont } from '../../fonts';
import type { FontId } from '../../model/types';

export interface PngResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  dataUrl: string;
}

export async function canvasToPng(c: HTMLCanvasElement): Promise<PngResult> {
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height, dataUrl: c.toDataURL('image/png') };
}

/** Crops transparent margins (keeps `pad` px). Returns null when the canvas is empty. */
export function trimCanvas(src: HTMLCanvasElement, pad = 8): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Makes a photographed/scanned signature transparent: estimates the paper colour from the image
 * border, then maps pixels close to it to transparent with a soft ramp (no jagged edges), and
 * optionally recolours the ink.
 */
export function removeBackground(src: HTMLCanvasElement, opts: { ink?: [number, number, number] | null; tolerance?: number } = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // Paper colour = median luminance of the outer border.
  const lum: number[] = [];
  const at = (x: number, y: number) => {
    const i = (y * c.width + x) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  };
  for (let x = 0; x < c.width; x += 2) lum.push(at(x, 0), at(x, c.height - 1));
  for (let y = 0; y < c.height; y += 2) lum.push(at(0, y), at(c.width - 1, y));
  lum.sort((a, b) => a - b);
  const paper = lum[Math.floor(lum.length / 2)] ?? 255;
  const tol = opts.tolerance ?? 0.35;
  const hi = paper * (1 - tol * 0.25); // above: fully transparent
  const lo = paper * (1 - tol); // below: fully opaque
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const a = l >= hi ? 0 : l <= lo ? 1 : (hi - l) / (hi - lo);
    d[i + 3] = Math.round(d[i + 3] * a);
    if (opts.ink) {
      d[i] = opts.ink[0] * 255;
      d[i + 1] = opts.ink[1] * 255;
      d[i + 2] = opts.ink[2] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function fileToCanvas(file: Blob, maxSide = 1600): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** Renders a typed name in a script font at high resolution. */
export async function renderTyped(text: string, font: FontId, color: [number, number, number]): Promise<HTMLCanvasElement | null> {
  if (!text.trim()) return null;
  const f = cssFont(font, false, false);
  const px = 120;
  await document.fonts.load(`${px}px ${f.fontFamily}`, text);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${px}px ${f.fontFamily}`;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  c.width = w;
  c.height = Math.ceil(px * 1.8);
  const ctx2 = c.getContext('2d')!;
  ctx2.font = `${px}px ${f.fontFamily}`;
  ctx2.fillStyle = `rgb(${color.map((v) => Math.round(v * 255)).join(',')})`;
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, px / 2, c.height / 2);
  return trimCanvas(c, 6);
}
