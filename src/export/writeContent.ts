/**
 * Draws editor objects into a page's content stream (flattened, permanent).
 * Each object is drawn in its own local frame (origin bottom-left of its box, y up, view units)
 * mapped to PDF user space by one `cm`, so rotated pages and rotated objects need no special cases.
 */
import {
  PDFDocument, PDFPage, PDFFont, PDFImage, rgb, LineCapStyle,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Color, EditorObject, StoredImage, TextObject } from '../model/types';
import { invert, multiply, viewTransform, type Matrix, type PageGeometry, type Point } from '../viewer/coords';
import { fontFile, loadFontBytes, loadMetrics } from '../fonts';
import { layoutText } from '../editor/textLayout';
import { strokeOutline, outlineToSvgPath } from '../editor/ink';
import { arrowHead } from '../editor/ObjectView';
import { deg2rad } from '../editor/geometry';

export const pdfColor = (c: Color) => rgb(c[0], c[1], c[2]);

/** local (box, y-up) → PDF user space. */
export function objectMatrix(o: Pick<EditorObject, 'rect' | 'rotation'>, g: PageGeometry): Matrix {
  const { x, y, width: w, height: h } = o.rect;
  const local: Matrix = [1, 0, 0, -1, x, y + h];
  const cx = x + w / 2;
  const cy = y + h / 2;
  const a = deg2rad(o.rotation || 0);
  const rot: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
  const aroundCenter = multiply(multiply([1, 0, 0, 1, -cx, -cy], rot), [1, 0, 0, 1, cx, cy]);
  return multiply(multiply(local, aroundCenter), invert(viewTransform(g, 1)));
}

/** Caches embedded fonts/images per document. */
export class ResourceCache {
  private fonts = new Map<string, Promise<PDFFont>>();
  private images = new Map<string, Promise<PDFImage>>();
  constructor(private readonly doc: PDFDocument, private readonly store: Record<string, StoredImage>) {
    doc.registerFontkit(fontkit);
  }
  font(file: string): Promise<PDFFont> {
    let p = this.fonts.get(file);
    if (!p) this.fonts.set(file, (p = loadFontBytes(file).then((b) => this.doc.embedFont(b, { subset: true }))));
    return p;
  }
  image(id: string): Promise<PDFImage> {
    let p = this.images.get(id);
    if (!p) {
      const img = this.store[id];
      if (!img) throw new Error(`Missing image ${id}`);
      p = img.mime === 'image/png' ? this.doc.embedPng(img.bytes) : this.doc.embedJpg(img.bytes);
      this.images.set(id, p);
    }
    return p;
  }
}

/**
 * Starts a fresh content stream for our drawing. pdf-lib's normalize() wraps the existing content
 * in q/Q (autoNormalizeCTM), so the page's graphics state cannot leak into ours.
 */
export function prepareFreshContentStream(_doc: PDFDocument, page: PDFPage) {
  page.node.normalize();
  (page as unknown as { getContentStream(useExisting: boolean): unknown }).getContentStream(false);
}

/** Converts a y-down box path (view units, origin top-left of box) for page.drawSvgPath at (0, h). */
function svgAt(page: PDFPage, path: string, h: number, opts: Parameters<PDFPage['drawSvgPath']>[1]) {
  page.drawSvgPath(path, { x: 0, y: h, ...opts });
}

export async function drawObject(page: PDFPage, g: PageGeometry, o: EditorObject, res: ResourceCache) {
  const w = o.rect.width;
  const h = o.rect.height;
  const opacity = o.opacity ?? 1;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...objectMatrix(o, g)));
  try {
    switch (o.kind) {
      case 'text':
        await drawText(page, o, res);
        break;
      case 'image':
        page.drawImage(await res.image(o.imageId), { x: 0, y: 0, width: w, height: h, opacity });
        break;
      case 'whiteout':
        page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: pdfColor(o.color), opacity });
        break;
      case 'mark': {
        const s = Math.min(w, h) / 10;
        const paths = { check: 'M1 5.5 L4 8.5 L9 1.5', cross: 'M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5', dot: '' };
        if (o.mark === 'dot') page.drawCircle({ x: w / 2, y: h / 2, size: 3 * s, color: pdfColor(o.color), opacity });
        else
          svgAt(page, paths[o.mark], h, { scale: s, borderColor: pdfColor(o.color), borderWidth: 1.4, borderLineCap: LineCapStyle.Round, borderOpacity: opacity });
        break;
      }
      case 'shape': {
        const sw = o.strokeWidth;
        const stroke = o.stroke ? pdfColor(o.stroke) : undefined;
        const fill = o.fill ? pdfColor(o.fill) : undefined;
        if (o.shape === 'rect') {
          page.drawRectangle({ x: sw / 2, y: sw / 2, width: Math.max(0, w - sw), height: Math.max(0, h - sw), borderColor: stroke, borderWidth: stroke ? sw : 0, color: fill, opacity, borderOpacity: opacity });
        } else if (o.shape === 'ellipse') {
          page.drawEllipse({ x: w / 2, y: h / 2, xScale: Math.max(0, w / 2 - sw / 2), yScale: Math.max(0, h / 2 - sw / 2), borderColor: stroke, borderWidth: stroke ? sw : 0, color: fill, opacity, borderOpacity: opacity });
        } else if (stroke) {
          const a = { x: (o.from?.x ?? 0) * w, y: (o.from?.y ?? 0) * h };
          const b = { x: (o.to?.x ?? 1) * w, y: (o.to?.y ?? 1) * h };
          page.drawLine({ start: { x: a.x, y: h - a.y }, end: { x: b.x, y: h - b.y }, thickness: sw, color: stroke, opacity, lineCap: LineCapStyle.Round });
          if (o.shape === 'arrow') {
            const head = arrowHead(a, b, sw);
            svgAt(page, `M${head.map((p) => `${p.x} ${p.y}`).join(' L')} Z`, h, { color: stroke, opacity });
          }
        }
        break;
      }
      case 'ink':
        for (const path of o.paths) {
          svgAt(page, outlineToSvgPath(strokeOutline(path, o.width)), h, { color: pdfColor(o.color), opacity });
        }
        break;
      // Markup and notes are written as annotations (writeAnnots.ts).
      default:
        break;
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

async function drawText(page: PDFPage, o: TextObject, res: ResourceCache) {
  const file = fontFile(o.font, o.bold, o.italic).file;
  const [font, metrics] = await Promise.all([res.font(file), loadMetrics(file)]);
  const w = o.rect.width;
  const h = o.rect.height;
  if (o.background) page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: pdfColor(o.background), opacity: o.opacity });
  const lay = layoutText(o.text, w, o.size, metrics);
  lay.lines.forEach((line, i) => {
    if (!line.text) return;
    const x = o.align === 'center' ? (w - line.width) / 2 : o.align === 'right' ? w - line.width : 0;
    const y = h - (i * lay.lineHeight + lay.baselineOffset);
    page.drawText(line.text, { x, y, size: o.size, font, color: pdfColor(o.color), opacity: o.opacity });
  });
}

export function viewToPdfPoint(g: PageGeometry, p: Point): Point {
  const m = invert(viewTransform(g, 1));
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
