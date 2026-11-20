/**
 * Annotations that already exist in the opened PDF (comments, highlights, stamps, ink…).
 * They are imported as locked editor objects so they can be selected and deleted.
 * pdf.js keeps drawing them; deleted ones are hidden by feeding their ids to pdf.js through
 * `annotationStorage.modifiedIds`, the same mechanism its own editor uses.
 */
import { useEditor } from '../model/editorStore';
import type { AnnotObject, EditorObject } from '../model/types';
import type { PageInfo, PDFDocumentProxy } from '../viewer/pdfjs';
import { pdfRectToView } from '../viewer/coords';

const SKIP = new Set(['Widget', 'Link', 'Popup']);
const HIDDEN_FLAGS = 0x02 | 0x20; // Hidden | NoView

interface PdfjsAnnot {
  id: string;
  subtype: string;
  rect: number[];
  annotationFlags?: number;
  contentsObj?: { str?: string };
  hasAppearance?: boolean;
  color?: Uint8ClampedArray | number[] | null;
}

export function parseAnnotId(id: string): { num: number; gen: number } | null {
  const m = /^(\d+)R(\d+)?$/.exec(id);
  return m ? { num: Number(m[1]), gen: Number(m[2] ?? 0) } : null;
}

export async function loadExistingAnnots(pdf: PDFDocumentProxy, pages: PageInfo[]): Promise<AnnotObject[]> {
  const out: AnnotObject[] = [];
  for (const info of pages) {
    const annots = (await (await pdf.getPage(info.index + 1)).getAnnotations()) as PdfjsAnnot[];
    for (const a of annots) {
      if (SKIP.has(a.subtype) || ((a.annotationFlags ?? 0) & HIDDEN_FLAGS)) continue;
      const ref = parseAnnotId(a.id);
      if (!ref) continue;
      const [x0, y0, x1, y1] = a.rect;
      const rect = pdfRectToView(info, 1, { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) });
      if (rect.width < 1 || rect.height < 1) continue;
      out.push({
        id: `pdf-${a.id}`,
        kind: 'annot',
        page: info.index,
        rect,
        rotation: 0,
        opacity: 1,
        locked: true,
        annotId: a.id,
        ref,
        subtype: a.subtype,
        contents: a.contentsObj?.str ?? '',
        hasAppearance: a.hasAppearance !== false,
      });
    }
  }
  return out;
}

/** Adds the imported annotations to the editor as the document's starting state (not an undo step). */
export function installExistingAnnots(pdf: PDFDocumentProxy, annots: AnnotObject[]) {
  useEditor.setState((s) => {
    const objects = { ...s.objects };
    for (const a of annots) objects[a.id] = a;
    return { objects, order: [...annots.map((a) => a.id), ...s.order], existingAnnots: annots.map((a) => a.id) };
  });
  hookDeletedAnnots(pdf, annots);
}

/** Existing annotations the user has deleted. */
export function deletedAnnots(s = useEditor.getState()): AnnotObject[] {
  return s.existingAnnots.filter((id) => !s.objects[id] && known.has(id)).map((id) => known.get(id)!);
}

const known = new Map<string, AnnotObject>();
let unsubscribe: (() => void) | null = null;

function hookDeletedAnnots(pdf: PDFDocumentProxy, annots: AnnotObject[]) {
  known.clear();
  for (const a of annots) known.set(a.id, a);
  unsubscribe?.();
  let current = { ids: new Set<string>(), hash: '' };
  const update = () => {
    const ids = deletedAnnots().map((a) => a.annotId).sort();
    const hash = ids.join(',');
    if (hash !== current.hash) current = { ids: new Set(ids), hash };
  };
  update();
  Object.defineProperty(pdf.annotationStorage, 'modifiedIds', { configurable: true, get: () => current });
  unsubscribe = useEditor.subscribe(update);
}

/** Per-page key that changes when an existing annotation on that page is deleted or restored. */
export function deletedKeyForPage(objects: Record<string, EditorObject>, existing: string[], page: number): string {
  return existing.filter((id) => !objects[id] && known.get(id)?.page === page).join(',');
}
