/**
 * Export pipeline: original bytes + editor state → new PDF bytes.
 *
 * Everything is written as an incremental update, so the original file is preserved byte for
 * byte. That keeps existing signatures valid where the change is permitted, keeps fidelity for
 * exotic PDFs that a full rewrite might damage, and makes saving fast for big files.
 */
import type { EditorObject, StoredImage } from '../model/types';
import type { FormValue } from '../model/editorStore';
import type { PageGeometry } from '../viewer/coords';
import { IncrementalUpdate } from '../pdf/incremental';
import { drawObject, prepareFreshContentStream, ResourceCache } from './writeContent';
import { writeMarkup, writeNote } from './writeAnnots';
import { applyFormValues } from '../forms/acroform';
import { createFieldsFromDetected } from '../forms/convert';
import type { DetectedField } from '../forms/detect';

export interface ExportInput {
  bytes: Uint8Array;
  pages: PageGeometry[];
  /** In z-order (back to front). */
  objects: EditorObject[];
  images: Record<string, StoredImage>;
  formValues: Record<string, FormValue>;
  flattenForms?: boolean;
  /** Detected blanks to turn into real AcroForm fields. */
  createFields?: DetectedField[];
}

const CONTENT_KINDS = new Set(['text', 'image', 'shape', 'ink', 'whiteout', 'mark']);

export async function exportPdf(input: ExportInput): Promise<Uint8Array> {
  const up = await IncrementalUpdate.load(input.bytes);
  const doc = up.doc;
  const res = new ResourceCache(doc, input.images);

  if (Object.keys(input.formValues).length || input.flattenForms) {
    await applyFormValues(doc, input.formValues, { flatten: !!input.flattenForms, fonts: res });
  }

  if (input.createFields?.length) await createFieldsFromDetected(doc, input.createFields, input.pages, res);

  const byPage = new Map<number, EditorObject[]>();
  for (const o of input.objects) {
    if (o.locked) continue;
    const list = byPage.get(o.page) ?? [];
    list.push(o);
    byPage.set(o.page, list);
  }

  for (const [index, objs] of byPage) {
    const page = doc.getPage(index);
    const g = input.pages[index];
    const content = objs.filter((o) => CONTENT_KINDS.has(o.kind));
    if (content.length) {
      prepareFreshContentStream(doc, page);
      for (const o of content) await drawObject(page, g, o, res);
    }
    for (const o of objs) {
      if (o.kind === 'highlight' || o.kind === 'underline' || o.kind === 'strikeout') writeMarkup(doc, page, g, o);
      else if (o.kind === 'note') writeNote(doc, page, g, o);
    }
  }

  await doc.flush();
  if (!up.hasChanges()) return input.bytes;
  return up.save().bytes;
}
