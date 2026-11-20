/**
 * Writes highlight/underline/strikeout and sticky notes as real PDF annotations (with appearance
 * streams), so they stay editable in other PDF readers.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFPage, PDFRef, PDFString } from 'pdf-lib';
import type { MarkupObject, NoteObject } from '../model/types';
import type { PageGeometry, Point, Rect } from '../viewer/coords';
import { viewToPdfPoint } from './writeContent';

const f = (n: number) => Number(n.toFixed(3));

export function pdfDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}

/** Text strings: PDFDocEncoding when possible, otherwise UTF-16BE with BOM (Polish characters). */
export function pdfText(s: string): PDFString | PDFHexString {
  return /^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s);
}

/** Quad corners in PDF space in the order viewers expect: UL, UR, LL, LR (as seen by the reader). */
function quadPoints(g: PageGeometry, q: Rect): Point[] {
  const m = (x: number, y: number) => viewToPdfPoint(g, { x, y });
  return [m(q.x, q.y), m(q.x + q.width, q.y), m(q.x, q.y + q.height), m(q.x + q.width, q.y + q.height)];
}

function bbox(pts: Point[], pad = 0) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function addAnnot(doc: PDFDocument, page: PDFPage, dict: PDFDict): PDFRef {
  const ref = doc.context.register(dict);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  return ref;
}

function appearance(doc: PDFDocument, rect: number[], ops: string, extGState?: Record<string, unknown>) {
  const resources = extGState ? { ExtGState: { GS0: extGState } } : {};
  const stream = doc.context.stream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: resources,
  });
  return doc.context.register(stream);
}

export function writeMarkup(doc: PDFDocument, page: PDFPage, g: PageGeometry, o: MarkupObject) {
  const quads = o.quads.map((q) => quadPoints(g, q));
  const all = quads.flat();
  const rect = bbox(all, 1).map(f);
  const [r, gg, b] = o.color;
  const subtype = { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut' }[o.kind];

  let ops = '';
  if (o.kind === 'highlight') {
    ops = `/GS0 gs ${r} ${gg} ${b} rg\n`;
    for (const [ul, ur, ll, lr] of quads) ops += `${f(ul.x)} ${f(ul.y)} m ${f(ur.x)} ${f(ur.y)} l ${f(lr.x)} ${f(lr.y)} l ${f(ll.x)} ${f(ll.y)} l h f\n`;
  } else {
    ops = `${r} ${gg} ${b} RG\n`;
    for (const [ul, ur, ll, lr] of quads) {
      const hgt = Math.hypot(ul.x - ll.x, ul.y - ll.y);
      const t = o.kind === 'underline' ? 0.08 : 0.5; // fraction of the height above the bottom edge
      const a = { x: ll.x + (ul.x - ll.x) * t, y: ll.y + (ul.y - ll.y) * t };
      const c = { x: lr.x + (ur.x - lr.x) * t, y: lr.y + (ur.y - lr.y) * t };
      ops += `${f(Math.max(0.5, hgt * 0.07))} w ${f(a.x)} ${f(a.y)} m ${f(c.x)} ${f(c.y)} l S\n`;
    }
  }
  const ap = appearance(doc, rect, ops, o.kind === 'highlight' ? { Type: 'ExtGState', BM: 'Multiply', ca: 1 } : undefined);
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect,
    QuadPoints: all.flatMap((p) => [f(p.x), f(p.y)]),
    C: [r, gg, b],
    F: 4,
    P: page.ref,
    M: PDFString.of(pdfDate()),
    AP: { N: ap },
  });
  if (o.text) dict.set(PDFName.of('Contents'), pdfText(o.text));
  if (o.opacity < 1) dict.set(PDFName.of('CA'), PDFNumber.of(o.opacity));
  addAnnot(doc, page, dict);
}

export function writeNote(doc: PDFDocument, page: PDFPage, g: PageGeometry, o: NoteObject) {
  // Notes are an icon of fixed size; keep it upright in PDF space at the note's top-left corner.
  const tl = viewToPdfPoint(g, { x: o.rect.x, y: o.rect.y });
  const corners = [
    tl,
    viewToPdfPoint(g, { x: o.rect.x + o.rect.width, y: o.rect.y + o.rect.height }),
  ];
  const [x0, y0, x1, y1] = bbox(corners).map(f);
  const [r, gg, b] = o.color;
  const w = x1 - x0;
  const h = y1 - y0;
  const ops = `${r} ${gg} ${b} rg 0.33 0.33 0.33 RG 1 w ${x0 + 1} ${y0 + 1} ${w - 2} ${h - 2} re B ${x0 + 4} ${y0 + h * 0.65} m ${x1 - 4} ${y0 + h * 0.65} l ${x0 + 4} ${y0 + h * 0.45} m ${x1 - 6} ${y0 + h * 0.45} l S`;
  const ap = appearance(doc, [x0, y0, x1, y1], ops);
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [x0, y0, x1, y1],
    Name: 'Comment',
    C: [r, gg, b],
    F: 28, // Print | NoZoom | NoRotate
    Open: false,
    P: page.ref,
    M: PDFString.of(pdfDate()),
    AP: { N: ap },
  });
  dict.set(PDFName.of('Contents'), pdfText(o.text));
  addAnnot(doc, page, dict);
}
