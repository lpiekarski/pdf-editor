import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageGeometry } from './coords';
import { normalizeRotation } from './coords';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

export interface PageInfo extends PageGeometry {
  index: number; // 0-based
}

export class PasswordRequiredError extends Error {
  constructor(public readonly incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'Password required');
  }
}

/**
 * Opens a PDF with pdf.js. All runtime assets are served from our own origin (offline-capable).
 * `bytes` is copied because pdf.js transfers its buffer to the worker.
 */
export async function openPdf(
  bytes: Uint8Array,
  askPassword?: (incorrect: boolean) => Promise<string | null>,
): Promise<{ pdf: PDFDocumentProxy; pages: PageInfo[] }> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    enableXfa: false,
  });
  task.onPassword = async (update: (pw: string) => void, reason: number) => {
    const incorrect = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const pw = askPassword ? await askPassword(incorrect) : null;
    if (pw == null) {
      await task.destroy();
      return;
    }
    update(pw);
  };
  const pdf = await task.promise;
  // Page geometry is needed up front for layout; fetch it in parallel (the worker pipelines requests).
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i): Promise<PageInfo> => {
      const p = await pdf.getPage(i + 1);
      return { index: i, viewBox: p.view as PageInfo['viewBox'], rotation: normalizeRotation(p.rotate) };
    }),
  );
  return { pdf, pages };
}

/** Limits how many pages render at once (keeps memory and CPU bounded on phones). */
class RenderQueue {
  private running = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
export const renderQueue = new RenderQueue(2);

export const isTouchDevice = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Max canvas pixels per page. iOS Safari caps a canvas at ~16.7M px and total canvas memory is tight. */
export const maxCanvasPixels = () => (isTouchDevice() ? 4_000_000 : 12_000_000);
