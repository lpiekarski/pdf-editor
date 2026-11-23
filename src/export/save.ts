import { deletedAnnots } from '../editor/existingAnnots';
import { useDoc } from '../model/docStore';
import { useEditor } from '../model/editorStore';
import { exportPdf } from './pipeline';

export function suggestedName(name: string, suffix = '-edited') {
  const base = name.replace(/\.pdf$/i, '');
  return `${base.endsWith(suffix) ? base : base + suffix}.pdf`;
}

/** Builds the output PDF from the current document and editor state. */
export async function buildOutput(opts: { flattenForms?: boolean; keepAsAnnotations?: boolean } = {}): Promise<Uint8Array> {
  const { file, pages } = useDoc.getState();
  if (!file) throw new Error('No document open');
  const s = useEditor.getState();
  return exportPdf({
    bytes: file.bytes,
    pages,
    objects: s.order.map((id) => s.objects[id]).filter(Boolean),
    images: s.images,
    formValues: s.formValues,
    flattenForms: opts.flattenForms,
    removeAnnots: deletedAnnots(s),
    password: file.password,
    keepAsAnnotations: opts.keepAsAnnotations,
  });
}

type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }>;
}>;

/**
 * Saves bytes as a file: File System Access API (desktop Chromium) → Web Share (phones) → download.
 * Returns how it was saved, or null if the user cancelled.
 */
export async function saveBytes(bytes: Uint8Array, name: string): Promise<'picker' | 'share' | 'download' | null> {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker && !matchMedia('(pointer: coarse)').matches) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return 'picker';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      // fall through to download
    }
  }
  const file = new File([blob], name, { type: 'application/pdf' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'share';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'download';
}
