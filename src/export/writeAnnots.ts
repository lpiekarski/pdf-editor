/**
 * Writes highlight/underline/strikeout and sticky notes as real PDF annotations (with appearance
 * streams), so they stay editable in other PDF readers.
 */
import { PDFArray, PDFContentStream, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFPage, PDFRef, PDFString } from 'pdf-lib';
import type { Color, EditorObject, MarkupObject, NoteObject } from '../model/types';
import type { PageGeometry, Point, Rect } from '../viewer/coords';
import { drawObject, objectMatrix, viewToPdfPoint, type ResourceCache } from './writeContent';

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

  let ops: string;
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

// ---------------- added objects as editable annotations ----------------

/**
 * Writes a text box / shape / drawing / image as a standard annotation (FreeText, Square, Circle,
 * Line, Ink, Stamp) instead of flattening it into the page. Its appearance stream is drawn by the
 * same code as the flattened version, so it looks identical; other PDF apps can move, edit or
 * delete it.
 */
export async function writeObjectAnnotation(doc: PDFDocument, page: PDFPage, g: PageGeometry, o: EditorObject, res: ResourceCache) {
  const ctx = doc.context;
  const w = o.rect.width;
  const h = o.rect.height;
  const m = objectMatrix(o, g);
  const toPdf = (x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const rect = bbox([toPdf(0, 0), toPdf(w, 0), toPdf(0, h), toPdf(w, h)]).map(f);

  // Draw on a detached scratch page, then turn its content + resources into a Form XObject.
  const scratch = PDFPage.create(doc);
  await drawObject(scratch, g, o, res, { matrix: [1, 0, 0, 1, 0, 0] });
  const contents = scratch.node.Contents();
  const parts: Uint8Array[] = [];
  for (const r of contents instanceof PDFArray ? contents.asArray() : []) {
    const st = ctx.lookup(r);
    if (st instanceof PDFContentStream) parts.push(st.getUnencodedContents());
    if (r instanceof PDFRef) ctx.delete(r);
  }
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let off = 0;
  for (const p of parts) {
    body.set(p, off);
    body[off + p.length] = 0x0a;
    off += p.length + 1;
  }
  const resources = scratch.node.Resources() ?? ctx.obj({});
  ctx.delete(scratch.ref);
  const ap = ctx.register(
    ctx.flateStream(body, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Matrix: m.map(f), Resources: resources }),
  );

  const base = { Type: 'Annot', Rect: rect, F: 4, P: page.ref, M: PDFString.of(pdfDate()), NM: PDFString.of(`ed-${o.id}`), AP: { N: ap } };
  const color = (c: Color | null | undefined) => (c ? [c[0], c[1], c[2]] : []);
  let dict: PDFDict;
  switch (o.kind) {
    case 'text':
      dict = ctx.obj({ ...base, Subtype: 'FreeText', DA: PDFString.of(`/Helv ${o.size} Tf ${o.color.join(' ')} rg`), Q: { left: 0, center: 1, right: 2 }[o.align] });
      dict.set(PDFName.of('Contents'), pdfText(o.text));
      break;
    case 'shape':
      if (o.shape === 'line' || o.shape === 'arrow') {
        const a = toPdf((o.from?.x ?? 0) * w, h - (o.from?.y ?? 0) * h);
        const b = toPdf((o.to?.x ?? 1) * w, h - (o.to?.y ?? 1) * h);
        dict = ctx.obj({
          ...base,
          Subtype: 'Line',
          L: [a.x, a.y, b.x, b.y].map(f),
          LE: ['None', o.shape === 'arrow' ? 'OpenArrow' : 'None'],
          C: color(o.stroke),
          BS: { W: o.strokeWidth },
        });
      } else {
        dict = ctx.obj({ ...base, Subtype: o.shape === 'rect' ? 'Square' : 'Circle', C: color(o.stroke), BS: { W: o.stroke ? o.strokeWidth : 0 } });
        if (o.fill) dict.set(PDFName.of('IC'), ctx.obj(color(o.fill)));
      }
      break;
    case 'ink': {
      const inkList = o.paths.map((path) =>
        path.flatMap((p) => {
          const q = toPdf(p.x, h - p.y);
          return [f(q.x), f(q.y)];
        }),
      );
      dict = ctx.obj({ ...base, Subtype: 'Ink', InkList: inkList, C: color(o.color), BS: { W: o.width } });
      break;
    }
    case 'whiteout':
      dict = ctx.obj({ ...base, Subtype: 'Square', C: color(o.color), IC: color(o.color), BS: { W: 0 } });
      break;
    default: // image, mark
      dict = ctx.obj({ ...base, Subtype: 'Stamp', Name: o.kind === 'image' && o.signature ? 'Signature' : 'Image' });
  }
  if (o.opacity < 1) dict.set(PDFName.of('CA'), PDFNumber.of(o.opacity));
  addAnnot(doc, page, dict);
}
