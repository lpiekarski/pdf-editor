/**
 * Incremental updates: append changed/new objects plus a new cross-reference section to the
 * end of an existing PDF, leaving every original byte untouched. This is what keeps existing
 * digital signatures valid when a signed file is edited or signed again.
 *
 * Reading uses pdf-lib's parser. Changes are detected automatically by fingerprinting every
 * indirect object at load time, so callers can use the normal pdf-lib API (forms, pages, ...)
 * and only the objects that actually changed are written.
 */
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFObjectParser, PDFRef, PDFStream, PDFArray, PDFHexString, PDFRawStream, PDFContext, type PDFObject } from 'pdf-lib';
import { loadPdf, mapStrings, streamIsExempt } from './load';
import type { PdfCrypt } from './crypt';

const enc = new TextEncoder();
const latin1 = new TextDecoder('latin1');

export { WrongPasswordError } from './crypt';

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fingerprint(obj: PDFObject): string {
  if (obj instanceof PDFStream) {
    const contents = obj.getContents();
    return `${obj.dict.toString()}#${contents.length}:${fnv1a(contents)}`;
  }
  return obj.toString();
}

function serialize(obj: PDFObject): Uint8Array {
  const out = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(out, 0);
  return out;
}

/** Finds the offset of the last `startxref` value. */
export function findStartXref(bytes: Uint8Array): number {
  const tail = latin1.decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m) throw new Error('Not a valid PDF: startxref not found');
  return Number(m[1]);
}

export interface XrefInfo {
  offset: number;
  kind: 'table' | 'stream';
  size: number;
}

/** Reads the most recent cross-reference section's type and /Size. */
export function readLastXref(bytes: Uint8Array, context: PDFContext): XrefInfo {
  const offset = findStartXref(bytes);
  const head = latin1.decode(bytes.subarray(offset, offset + 32));
  if (head.startsWith('xref')) {
    const rest = latin1.decode(bytes.subarray(offset));
    const t = rest.indexOf('trailer');
    if (t < 0) throw new Error('Malformed xref table: no trailer');
    const dictStart = offset + t + 'trailer'.length; // latin1: 1 char = 1 byte
    const dict = PDFObjectParser.forBytes(bytes.subarray(dictStart), context).parseObject() as PDFDict;
    return { offset, kind: 'table', size: (dict.get(PDFName.of('Size')) as PDFNumber).asNumber() };
  }
  const m = /^\s*(\d+)\s+(\d+)\s+obj/.exec(head);
  if (!m) throw new Error('Malformed startxref: neither table nor stream');
  const dictStart = offset + m[0].length;
  const parsed = PDFObjectParser.forBytes(bytes.subarray(dictStart), context).parseObject();
  const dict = parsed instanceof PDFStream ? parsed.dict : (parsed as PDFDict);
  return { offset, kind: 'stream', size: (dict.get(PDFName.of('Size')) as PDFNumber).asNumber() };
}

export interface SaveResult {
  bytes: Uint8Array;
  /** Byte offset where the appended section starts (everything before is the original file). */
  appendedAt: number;
  /** Byte offset of each written object, keyed by "num gen". */
  offsets: Map<string, number>;
}

export class IncrementalUpdate {
  private readonly snapshot = new Map<string, { obj: PDFObject; fp: string }>();
  private readonly forced = new Set<string>();

  private constructor(
    readonly original: Uint8Array,
    readonly doc: PDFDocument,
    readonly prev: XrefInfo,
  ) {
    // pdf-lib drops object-stream containers and xref streams from its context, so its idea of
    // the largest object number can be too low. New objects must never reuse those numbers.
    doc.context.largestObjectNumber = Math.max(doc.context.largestObjectNumber, prev.size - 1);
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      this.snapshot.set(ref.tag, { obj, fp: fingerprint(obj) });
    }
  }

  /** The file's encryption (null for unencrypted files). Appended objects are encrypted with it. */
  crypt: PdfCrypt | null = null;

  /**
   * Loads a PDF for incremental editing. Encrypted files are decrypted in memory with `password`
   * (empty for files that only restrict permissions) and stay encrypted when saved.
   */
  static async load(bytes: Uint8Array, password = ''): Promise<IncrementalUpdate> {
    const { doc, crypt } = await loadPdf(bytes, password);
    const up = new IncrementalUpdate(bytes, doc, readLastXref(bytes, doc.context));
    up.crypt = crypt;
    return up;
  }

  get context() {
    return this.doc.context;
  }

  /** Forces an object to be rewritten even if its serialization looks unchanged. */
  touch(ref: PDFRef) {
    this.forced.add(ref.tag);
  }

  /** Refs of objects that are new or differ from the loaded file. */
  changedRefs(): PDFRef[] {
    const out: PDFRef[] = [];
    for (const [ref, obj] of this.context.enumerateIndirectObjects()) {
      const before = this.snapshot.get(ref.tag);
      if (!before || this.forced.has(ref.tag) || before.obj !== obj || before.fp !== fingerprint(obj)) out.push(ref);
    }
    return out.sort((a, b) => a.objectNumber - b.objectNumber);
  }

  hasChanges(): boolean {
    return this.changedRefs().length > 0;
  }

  save(): SaveResult {
    const changed = this.changedRefs();
    const ctx = this.context;
    const chunks: Uint8Array[] = [];
    let pos = this.original.length;
    const push = (b: Uint8Array) => {
      chunks.push(b);
      pos += b.length;
    };
    const last = this.original[this.original.length - 1];
    if (last !== 0x0a && last !== 0x0d) push(enc.encode('\n'));
    const appendedAt = pos;

    const offsets = new Map<string, number>();
    const entries: { num: number; gen: number; offset: number }[] = [];
    for (const ref of changed) {
      const plain = ctx.lookup(ref)!;
      const crypt = this.crypt;
      const n = ref.objectNumber;
      const g = ref.generationNumber;
      const obj = crypt
        ? mapStrings(
            plain,
            ctx,
            (b) => crypt.encryptString(b, n, g),
            (b, st) => (streamIsExempt(st, crypt) ? b : crypt.encryptStream(b, n, g)),
          )
        : plain;
      const offset = pos;
      push(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
      push(serialize(obj));
      push(enc.encode('\nendobj\n'));
      offsets.set(`${ref.objectNumber} ${ref.generationNumber}`, offset);
      entries.push({ num: ref.objectNumber, gen: ref.generationNumber, offset });
    }

    const trailer = ctx.trailerInfo;
    const trailerEntries: [string, PDFObject][] = [];
    if (trailer.Root) trailerEntries.push(['Root', trailer.Root]);
    if (trailer.Info) trailerEntries.push(['Info', trailer.Info]);
    if (trailer.ID) trailerEntries.push(['ID', trailer.ID]);
    // Keep the file encrypted: the new trailer must point at the same encryption dictionary.
    if (trailer.Encrypt) trailerEntries.push(['Encrypt', trailer.Encrypt]);

    if (this.prev.kind === 'table') {
      const size = Math.max(this.prev.size, ...entries.map((e) => e.num + 1));
      const xrefAt = pos;
      let s = 'xref\n';
      for (const run of runs(entries)) {
        s += `${run[0].num} ${run.length}\n`;
        for (const e of run) s += `${String(e.offset).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} n\r\n`;
      }
      const dict = PDFDict.withContext(ctx);
      dict.set(PDFName.of('Size'), PDFNumber.of(size));
      dict.set(PDFName.of('Prev'), PDFNumber.of(this.prev.offset));
      for (const [k, v] of trailerEntries) dict.set(PDFName.of(k), v);
      s += `trailer\n${dict.toString()}\nstartxref\n${xrefAt}\n%%EOF\n`;
      push(enc.encode(s));
    } else {
      // Cross-reference stream (required when the previous section is a stream).
      const xrefRef = ctx.nextRef();
      const xrefAt = pos;
      const all = [...entries, { num: xrefRef.objectNumber, gen: 0, offset: xrefAt }].sort((a, b) => a.num - b.num);
      const size = Math.max(this.prev.size, ...all.map((e) => e.num + 1));
      const W = [1, 4, 2];
      const data = new Uint8Array(all.length * 7);
      all.forEach((e, i) => {
        const o = i * 7;
        data[o] = 1;
        data[o + 1] = (e.offset >>> 24) & 0xff;
        data[o + 2] = (e.offset >>> 16) & 0xff;
        data[o + 3] = (e.offset >>> 8) & 0xff;
        data[o + 4] = e.offset & 0xff;
        data[o + 5] = (e.gen >>> 8) & 0xff;
        data[o + 6] = e.gen & 0xff;
      });
      const index: number[] = [];
      for (const run of runs(all)) index.push(run[0].num, run.length);
      const dict = PDFDict.withContext(ctx);
      dict.set(PDFName.of('Type'), PDFName.of('XRef'));
      dict.set(PDFName.of('Size'), PDFNumber.of(size));
      dict.set(PDFName.of('Index'), ctx.obj(index));
      dict.set(PDFName.of('W'), ctx.obj(W));
      dict.set(PDFName.of('Prev'), PDFNumber.of(this.prev.offset));
      for (const [k, v] of trailerEntries) dict.set(PDFName.of(k), v);
      dict.set(PDFName.of('Length'), PDFNumber.of(data.length));
      const stream = PDFRawStream.of(dict, data);
      push(enc.encode(`${xrefRef.objectNumber} 0 obj\n`));
      push(serialize(stream));
      push(enc.encode(`\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`));
    }

    const out = new Uint8Array(pos);
    out.set(this.original, 0);
    let o = this.original.length;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return { bytes: out, appendedAt, offsets };
  }
}

function runs<T extends { num: number }>(entries: T[]): T[][] {
  const sorted = [...entries].sort((a, b) => a.num - b.num);
  const out: T[][] = [];
  for (const e of sorted) {
    const cur = out[out.length - 1];
    if (cur && cur[cur.length - 1].num + 1 === e.num) cur.push(e);
    else out.push([e]);
  }
  return out;
}

/** Helpers commonly needed when building incremental changes. */
export function hexId(bytes: Uint8Array): PDFHexString {
  return PDFHexString.of([...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''));
}
export function asArray(ctx: PDFContext, v: PDFObject | undefined): PDFArray | undefined {
  const r = v instanceof PDFRef ? ctx.lookup(v) : v;
  return r instanceof PDFArray ? r : undefined;
}
