import { create } from 'zustand';
import { openPdf, pdfjs, type PageInfo, type PDFDocumentProxy } from '../viewer/pdfjs';
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
import { installExistingAnnots, loadExistingAnnots } from '../editor/existingAnnots';

export interface LoadedFile {
  name: string;
  /** Original bytes as opened. Never mutated: export and signature checks start from these. */
  bytes: Uint8Array;
  /** Password used to open an encrypted file (kept in memory only; needed to save and sign). */
  password?: string;
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
  /** What the PDF's author restricted (only for encrypted files with a permissions password). */
  restrictions: string[];
  /** Set while a read-only snapshot of a signed revision is shown. */
  revisionOf: { label: string; name: string; bytes: Uint8Array; editor: EditorSnapshot } | null;
  openRevision(bytes: Uint8Array, label: string): Promise<void>;
  backToCurrent(): Promise<void>;
  open(name: string, bytes: Uint8Array, password?: string): Promise<void>;
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
  restrictions: [],
  revisionOf: null,
  async openRevision(bytes, label) {
    const { file, revisionOf } = get();
    if (!file) return;
    const e = useEditor.getState();
    const editor = revisionOf?.editor ?? { objects: e.objects, order: e.order, formValues: e.formValues, images: e.images, past: e.past, future: e.future };
    const keep = revisionOf ?? { name: file.name, bytes: file.bytes };
    await get().open(`${label} (signed version)`, bytes, file.password);
    set({ revisionOf: { label, name: keep.name, bytes: keep.bytes, editor } });
  },
  async backToCurrent() {
    const r = get().revisionOf;
    if (!r) return;
    await get().open(r.name, r.bytes, get().file?.password);
    useEditor.setState({ ...(r.editor as Partial<ReturnType<typeof useEditor.getState>>), dirty: r.editor.past.length > 0 });
  },
  async open(name, bytes, knownPassword) {
    await get().close();
    set({ loading: true, error: null, revisionOf: null, restrictions: [] });
    try {
      let password: string | undefined;
      let triedKnown = false;
      const { pdf, pages } = await openPdf(bytes, (incorrect) => {
        // Reopening our own output (after saving or signing) reuses the password silently.
        if (knownPassword !== undefined && !triedKnown) {
          triedKnown = true;
          password = knownPassword;
          return Promise.resolve(knownPassword);
        }
        return new Promise((resolve) =>
          set({
            passwordPrompt: {
              incorrect,
              resolve: (pw) => {
                set({ passwordPrompt: null });
                password = pw ?? undefined;
                resolve(pw);
              },
            },
          }),
        );
      });
      set({ file: { name, bytes, password }, pdf, pages, hasForm: false, loading: false, restrictions: await restrictionsOf(pdf) });
      // Scanning every page for form widgets can take a while on long documents: do it after showing the first page.
      hasAcroForm(pdf).then((hasForm) => {
        if (hasForm && get().pdf === pdf) set({ hasForm });
      });
      loadExistingAnnots(pdf, pages)
        .then((annots) => {
          if (get().pdf === pdf) installExistingAnnots(pdf, annots);
        })
        .catch(() => {});
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

/** Human-readable list of what a permissions-restricted PDF forbids (empty when unrestricted). */
async function restrictionsOf(pdf: PDFDocumentProxy): Promise<string[]> {
  const perms = await pdf.getPermissions().catch(() => null);
  if (!perms) return [];
  const F = pdfjs.PermissionFlag;
  const out: string[] = [];
  if (!perms.has(F.MODIFY_CONTENTS)) out.push('editing the content');
  if (!perms.has(F.MODIFY_ANNOTATIONS)) out.push('adding comments');
  if (!perms.has(F.FILL_INTERACTIVE_FORMS) && !perms.has(F.MODIFY_ANNOTATIONS)) out.push('filling in forms');
  if (!perms.has(F.PRINT)) out.push('printing');
  return out;
}

export async function openFile(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  await useDoc.getState().open(f.name, bytes);
}
