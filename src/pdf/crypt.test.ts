import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFHexString, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { IncrementalUpdate, WrongPasswordError } from './incremental';
import { rc4 } from './crypt';
import { hasPython, pyValidate, writeOut } from '../../tests/unit/py';

const fixture = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));

const CASES = [
  { file: 'enc-rc4.pdf', password: '' },
  { file: 'enc-aes128.pdf', password: '' },
  { file: 'enc-aes256.pdf', password: '' }, // object streams
  { file: 'enc-aes256-password.pdf', password: 'secret' },
  { file: 'enc-aes128-nometa.pdf', password: '' },
];

describe('RC4', () => {
  it('matches the well-known test vector', () => {
    const out = rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'));
    expect([...out].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe('bbf316e8d940af0ad3');
  });
});

describe('encrypted PDFs', () => {
  it.each(CASES)('decrypts, edits and re-encrypts $file', async ({ file, password }) => {
    const original = fixture(file);
    const up = await IncrementalUpdate.load(original, password);
    expect(up.crypt).not.toBeNull();

    // Decryption works: strings and streams are readable.
    if (file.startsWith('enc-a') && !file.includes('password') && !file.includes('nometa') || file === 'enc-rc4.pdf') {
      expect(up.doc.getForm().getFields().map((f) => f.getName())).toContain('name');
    }
    const ctx = up.context;
    const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40], F: 4 }));
    ctx.lookup(note, (await import('pdf-lib')).PDFDict).set(PDFName.of('Contents'), PDFHexString.fromText('Zażółć — encrypted note'));
    const page = up.doc.getPage(0);
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) annots.push(note);
    else page.node.set(PDFName.of('Annots'), ctx.obj([note]));
    const { bytes } = up.save();

    // The original bytes are untouched and the note text is not readable in the raw file.
    expect(bytes.subarray(0, original.length)).toEqual(original);
    expect(new TextDecoder('latin1').decode(bytes.subarray(original.length))).not.toContain('encrypted note');

    // pdf.js opens it with the same password and decrypts our new object correctly.
    const task = getDocument({ data: bytes.slice(), password });
    const pdf = await task.promise;
    const ann = (await (await pdf.getPage(1)).getAnnotations()) as { subtype: string; contentsObj: { str: string } }[];
    await task.destroy();
    expect(ann.find((a) => a.subtype === 'Text')?.contentsObj.str).toBe('Zażółć — encrypted note');

    if (hasPython) {
      const res = pyValidate('check', writeOut(`enc-edited-${file}`, bytes), undefined, password);
      expect(res).toMatchObject({ ok: true, encrypted: true });
    }
  });

  it('accepts the owner password too, and rejects a wrong one', async () => {
    await expect(IncrementalUpdate.load(fixture('enc-aes256-password.pdf'), 'owner')).resolves.toBeTruthy();
    await expect(IncrementalUpdate.load(fixture('enc-aes128.pdf'), 'owner')).resolves.toBeTruthy();
    await expect(IncrementalUpdate.load(fixture('enc-rc4.pdf'), 'owner')).resolves.toBeTruthy();
    await expect(IncrementalUpdate.load(fixture('enc-aes256-password.pdf'), 'wrong')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(IncrementalUpdate.load(fixture('enc-aes256-password.pdf'))).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
