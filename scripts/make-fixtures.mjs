// Generates the test PDF corpus in tests/fixtures. Run: npm run fixtures
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../tests/fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const save = async (doc, name, opts = {}) => writeFileSync(new URL(name, OUT), await doc.save(opts));

// 1. AcroForm with every common field type
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const label = (t, y) => page.drawText(t, { x: 50, y, size: 12, font });
  label('Full name', 760);
  form.createTextField('name').addToPage(page, { x: 150, y: 752, width: 300, height: 22 });
  label('Comments', 710);
  const c = form.createTextField('comments');
  c.enableMultiline();
  c.addToPage(page, { x: 150, y: 640, width: 300, height: 80 });
  label('Agree', 610);
  form.createCheckBox('agree').addToPage(page, { x: 150, y: 605, width: 16, height: 16 });
  label('Size', 570);
  const r = form.createRadioGroup('size');
  ['S', 'M', 'L'].forEach((v, i) => r.addOptionToPage(v, page, { x: 150 + i * 40, y: 565, width: 16, height: 16 }));
  label('Country', 530);
  const dd = form.createDropdown('country');
  dd.addOptions(['Poland', 'Germany', 'France']);
  dd.addToPage(page, { x: 150, y: 522, width: 150, height: 22 });
  label('PIN (comb)', 490);
  const pin = form.createTextField('pin');
  pin.setMaxLength(4);
  pin.enableCombing();
  pin.addToPage(page, { x: 150, y: 482, width: 100, height: 22 });
  await save(doc, 'acroform.pdf');
}

// 2. Flat form: labels + underlines + boxes, no fields
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Application form', { x: 50, y: 790, size: 20, font });
  const rows = ['Name:', 'Surname:', 'Address:', 'Date:'];
  rows.forEach((t, i) => {
    const y = 730 - i * 40;
    page.drawText(t, { x: 50, y, size: 12, font });
    page.drawLine({ start: { x: 130, y: y - 2 }, end: { x: 450, y: y - 2 }, thickness: 0.8 });
  });
  page.drawText('Phone: ____________________', { x: 50, y: 570, size: 12, font });
  ['I accept the terms', 'Send me newsletters'].forEach((t, i) => {
    const y = 530 - i * 25;
    page.drawRectangle({ x: 50, y: y - 2, width: 12, height: 12, borderWidth: 1, borderColor: rgb(0, 0, 0) });
    page.drawText(t, { x: 70, y, size: 12, font });
  });
  page.drawText('Signature:', { x: 50, y: 420, size: 12, font });
  page.drawRectangle({ x: 130, y: 380, width: 220, height: 60, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  await save(doc, 'flat-form.pdf', { useObjectStreams: false }); // classic xref table
  await save(doc, 'flat-form-xrefstream.pdf', { useObjectStreams: true }); // xref stream + object streams
}

// 3. Multi-page with a rotated page and a non-zero CropBox
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 5; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i}`, { x: 50, y: 780, size: 28, font });
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 50, y: 700, size: 14, font });
    if (i === 2) page.setRotation(degrees(90));
    if (i === 3) page.setCropBox(50, 50, 495, 742);
  }
  await save(doc, 'multipage-rotated.pdf');
}

// 4. Polish text with an embedded Unicode font
{
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)), { subset: true });
  const page = doc.addPage([595, 842]);
  page.drawText('Zażółć gęślą jaźń. Łódź, Świętokrzyskie.', { x: 50, y: 760, size: 16, font });
  page.drawText('Imię i nazwisko: ______________________', { x: 50, y: 700, size: 12, font });
  await save(doc, 'polish.pdf');
}

// 5. Existing annotations (highlight + sticky note)
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('This sentence is already highlighted.', { x: 50, y: 760, size: 14, font });
  const w = font.widthOfTextAtSize('This sentence is already highlighted.', 14);
  const hl = doc.context.obj({
    Type: 'Annot', Subtype: 'Highlight', Rect: [50, 756, 50 + w, 774],
    QuadPoints: [50, 774, 50 + w, 774, 50, 756, 50 + w, 756], C: [1, 1, 0], F: 4,
    Contents: PDFString.of('Existing highlight'),
  });
  const note = doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [400, 700, 420, 720], C: [1, 0.8, 0], F: 4,
    Contents: PDFString.of('Existing sticky note'), Name: 'Comment',
  });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(hl), doc.context.register(note)]));
  await save(doc, 'annotated.pdf');
}
console.log('Fixtures written to tests/fixtures');
