import { create } from 'zustand';
import { openPdf, type PageInfo, type PDFDocumentProxy } from '../viewer/pdfjs';
import { useEditor } from './editorStore';
import type { EditorObject, StoredImage } from './types';
import type { FormValue } from './editorStore';

type EditorSnapshot = {
  objects: Record<string, EditorObject>;
  order: string[];
  formValues: Record<string, FormValue>;
  images: Record<string, StoredImage>;
  past: unknown[];
  future: unknown[];
};
import { hasAcroForm } from '../forms/acroform';

export interface LoadedFile {
  name: string;
  /** Original bytes as opened. Never mutated: export and signature checks start from these. */
  bytes: Uint8Array;
}

interface PasswordPrompt {
  incorrect: boolean;
  resolve: (pw: string | null) => void;
}

interface DocState {
  file: LoadedFile | null;
  pdf: PDFDocumentProxy | null;
  pages: PageInfo[];
  /** The document has AcroForm fields (rendered as HTML inputs instead of on the canvas). */
  hasForm: boolean;
  loading: boolean;
  error: string | null;
  passwordPrompt: PasswordPrompt | null;
  /** Set while a read-only snapshot of a signed revision is shown. */
  revisionOf: { label: string; name: string; bytes: Uint8Array; editor: EditorSnapshot } | null;
  openRevision(bytes: Uint8Array, label: string): Promise<void>;
  backToCurrent(): Promise<void>;
  open(name: string, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export const useDoc = create<DocState>((set, get) => ({
  file: null,
  pdf: null,
  pages: [],
  hasForm: false,
  loading: false,
  error: null,
  passwordPrompt: null,
  revisionOf: null,
  async openRevision(bytes, label) {
    const { file, revisionOf } = get();
    if (!file) return;
    const e = useEditor.getState();
    const editor = revisionOf?.editor ?? { objects: e.objects, order: e.order, formValues: e.formValues, images: e.images, past: e.past, future: e.future };
    const keep = revisionOf ?? { name: file.name, bytes: file.bytes };
    await get().open(`${label} (signed version)`, bytes);
    set({ revisionOf: { label, name: keep.name, bytes: keep.bytes, editor } });
  },
  async backToCurrent() {
    const r = get().revisionOf;
    if (!r) return;
    await get().open(r.name, r.bytes);
    useEditor.setState({ ...(r.editor as Partial<ReturnType<typeof useEditor.getState>>), dirty: r.editor.past.length > 0 });
  },
  async open(name, bytes) {
    await get().close();
    set({ loading: true, error: null, revisionOf: null });
    try {
      const { pdf, pages } = await openPdf(bytes, (incorrect) =>
        new Promise((resolve) =>
          set({ passwordPrompt: { incorrect, resolve: (pw) => { set({ passwordPrompt: null }); resolve(pw); } } }),
        ),
      );
      set({ file: { name, bytes }, pdf, pages, hasForm: false, loading: false });
      // Scanning every page for form widgets can take a while on long documents: do it after showing the first page.
      hasAcroForm(pdf).then((hasForm) => {
        if (hasForm && get().pdf === pdf) set({ hasForm });
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  async close() {
    const { pdf } = get();
    set({ file: null, pdf: null, pages: [], hasForm: false });
    useEditor.getState().reset();
    if (pdf) await pdf.loadingTask.destroy();
  },
}));

export async function openFile(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  await useDoc.getState().open(f.name, bytes);
}
