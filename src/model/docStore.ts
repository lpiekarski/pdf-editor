import { create } from 'zustand';
import { openPdf, type PageInfo, type PDFDocumentProxy } from '../viewer/pdfjs';

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
  loading: boolean;
  error: string | null;
  passwordPrompt: PasswordPrompt | null;
  open(name: string, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export const useDoc = create<DocState>((set, get) => ({
  file: null,
  pdf: null,
  pages: [],
  loading: false,
  error: null,
  passwordPrompt: null,
  async open(name, bytes) {
    await get().close();
    set({ loading: true, error: null });
    try {
      const { pdf, pages } = await openPdf(bytes, (incorrect) =>
        new Promise((resolve) =>
          set({ passwordPrompt: { incorrect, resolve: (pw) => { set({ passwordPrompt: null }); resolve(pw); } } }),
        ),
      );
      set({ file: { name, bytes }, pdf, pages, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  async close() {
    const { pdf } = get();
    set({ file: null, pdf: null, pages: [] });
    if (pdf) await pdf.loadingTask.destroy();
  },
}));

export async function openFile(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  await useDoc.getState().open(f.name, bytes);
}
