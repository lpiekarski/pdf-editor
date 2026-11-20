import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

describe('fixtures', () => {
  it('acroform fixture has the expected fields', async () => {
    const doc = await PDFDocument.load(readFileSync('tests/fixtures/acroform.pdf'));
    const names = doc.getForm().getFields().map((f) => f.getName());
    expect(names).toEqual(['name', 'comments', 'agree', 'size', 'country', 'pin']);
  });
});
