/** Turns detected blanks into real AcroForm fields ("make this PDF fillable"). */
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { DetectedField } from './detect';
import type { PageGeometry } from '../viewer/coords';
import { viewRectToPdf } from '../viewer/coords';
import type { ResourceCache } from '../export/writeContent';

export async function createFieldsFromDetected(doc: PDFDocument, fields: DetectedField[], pages: PageGeometry[], fonts: ResourceCache) {
  const form = doc.getForm();
  const font = await fonts.font('NotoSans-Regular.ttf');
  const used = new Set(form.getFields().map((f) => f.getName()));
  let n = 1;
  const nextName = (prefix: string) => {
    while (used.has(`${prefix}${n}`)) n++;
    const name = `${prefix}${n++}`;
    used.add(name);
    return name;
  };
  for (const f of fields) {
    const page = doc.getPage(f.page);
    const g = pages[f.page];
    const r = viewRectToPdf(g, 1, f.rect);
    const opts = {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      rotate: degrees(g.rotation),
      borderWidth: 0,
      backgroundColor: undefined,
      textColor: rgb(0, 0, 0),
      font,
    };
    if (f.kind === 'checkbox') {
      const cb = form.createCheckBox(nextName('check_'));
      cb.addToPage(page, { ...opts, font: undefined });
    } else {
      const tf = form.createTextField(nextName('text_'));
      if (f.kind === 'box' && f.rect.height > f.fontSize * 2.2) tf.enableMultiline();
      tf.addToPage(page, opts);
      tf.setFontSize(Math.round(f.fontSize));
    }
  }
  form.updateFieldAppearances(font);
}
