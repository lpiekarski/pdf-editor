import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { pdfjs, maxCanvasPixels, renderQueue, type PageInfo, type PDFDocumentProxy } from './pdfjs';
import { viewSize } from './coords';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';

const textCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextContent>>>();
export function getTextContent(pdf: PDFDocumentProxy, index: number): Promise<TextContent> {
  let m = textCache.get(pdf);
  if (!m) textCache.set(pdf, (m = new Map()));
  let p = m.get(index);
  if (!p) m.set(index, (p = pdf.getPage(index + 1).then((pg) => pg.getTextContent())));
  return p;
}

interface Props {
  pdf: PDFDocumentProxy;
  info: PageInfo;
  zoom: number;
  visible: boolean;
  /** pdf.js AnnotationMode used for the canvas (forms may be drawn as HTML instead). */
  annotationMode?: number;
  /** Changes when the canvas must be redrawn although nothing else changed (e.g. a PDF annotation was deleted). */
  renderKey?: string;
  /** Overlay layers (forms, editor objects, signature badges) drawn above the text layer. */
  children?: ReactNode;
  pageRef?: (el: HTMLDivElement | null) => void;
}

function releaseCanvases(host: HTMLElement) {
  for (const c of host.querySelectorAll('canvas')) {
    c.width = 0; // frees the backing store immediately (important on iOS)
    c.height = 0;
  }
  host.replaceChildren();
}

export function PageView({ pdf, info, zoom, visible, annotationMode, renderKey, children, pageRef }: Props) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const detailHost = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const size = viewSize(info, zoom);
  const mode = annotationMode ?? pdfjs.AnnotationMode.ENABLE;

  // Canvas: re-rendered (debounced) when zoom changes. The old canvas stays stretched meanwhile.
  useEffect(() => {
    const host = canvasHost.current!;
    if (!visible) {
      releaseCanvases(host);
      rendered.current = false;
      return;
    }
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    const timer = setTimeout(
      () =>
        renderQueue.run(async () => {
          if (cancelled) return;
          const page = await pdf.getPage(info.index + 1);
          const dpr = window.devicePixelRatio || 1;
          const css = viewSize(info, zoom);
          let scale = zoom * dpr;
          const px = css.width * dpr * css.height * dpr;
          const max = maxCanvasPixels();
          if (px > max) scale *= Math.sqrt(max / px);
          const viewport = page.getViewport({ scale, rotation: info.rotation });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          task = page.render({ canvas, viewport, annotationMode: mode });
          try {
            await task.promise;
          } catch {
            return; // cancelled
          }
          if (cancelled) return;
          releaseCanvases(host);
          host.appendChild(canvas);
          rendered.current = true;
        }),
      rendered.current ? 150 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
     
  }, [pdf, info, zoom, visible, mode, renderKey]);

  // Detail canvas: when the page is too big for one full-resolution canvas (high zoom, phones),
  // the base canvas above is rendered at reduced resolution and this one re-renders just the
  // visible region at full resolution once scrolling settles.
  useEffect(() => {
    const host = detailHost.current!;
    const pageEl = host.parentElement!;
    const viewer = pageEl.closest('.viewer');
    if (!visible || !viewer) {
      releaseCanvases(host);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: { cancel(): void; promise: Promise<void> } | null = null;

    const renderDetail = () =>
      renderQueue.run(async () => {
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const css = viewSize(info, zoom);
        const max = maxCanvasPixels();
        if (css.width * dpr * css.height * dpr <= max) return releaseCanvases(host); // base canvas is already sharp
        const pr = pageEl.getBoundingClientRect();
        const vr = viewer.getBoundingClientRect();
        const marginX = vr.width * 0.25;
        const marginY = vr.height * 0.25;
        const x0 = Math.max(0, vr.left - pr.left - marginX);
        const y0 = Math.max(0, vr.top - pr.top - marginY);
        const x1 = Math.min(css.width, vr.right - pr.left + marginX);
        const y1 = Math.min(css.height, vr.bottom - pr.top + marginY);
        if (x1 <= x0 || y1 <= y0) return releaseCanvases(host);
        const w = x1 - x0;
        const h = y1 - y0;
        const k = Math.min(1, Math.sqrt(max / (w * dpr * h * dpr)));
        const s = dpr * k;
        const page = await pdf.getPage(info.index + 1);
        const viewport = page.getViewport({ scale: zoom * s, rotation: info.rotation, offsetX: -x0 * s, offsetY: -y0 * s });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(w * s);
        canvas.height = Math.floor(h * s);
        Object.assign(canvas.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
        task = page.render({ canvas, viewport, annotationMode: mode });
        try {
          await task.promise;
        } catch {
          return;
        }
        if (cancelled) return;
        releaseCanvases(host);
        host.appendChild(canvas);
      });

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(renderDetail, 200);
    };
    schedule();
    viewer.addEventListener('scroll', schedule, { passive: true });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
      viewer.removeEventListener('scroll', schedule);
      releaseCanvases(host);
    };
     
  }, [pdf, info, zoom, visible, mode, renderKey]);

  // Text layer (selectable text, used for highlighting and snapping).
  useEffect(() => {
    const host = textHost.current!;
    if (!visible) {
      host.replaceChildren();
      return;
    }
    let cancelled = false;
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    const timer = setTimeout(async () => {
      const [page, text] = await Promise.all([pdf.getPage(info.index + 1), getTextContent(pdf, info.index)]);
      if (cancelled) return;
      host.replaceChildren();
      layer = new pdfjs.TextLayer({
        textContentSource: text,
        container: host,
        viewport: page.getViewport({ scale: zoom, rotation: info.rotation }),
      });
      await layer.render().catch(() => {});
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      layer?.cancel();
    };
  }, [pdf, info, zoom, visible]);

  const style = {
    width: size.width,
    height: size.height,
    '--scale-factor': zoom,
    '--user-unit': 1,
    '--total-scale-factor': zoom,
  } as CSSProperties;

  return (
    <div className="page" style={style} ref={pageRef} data-page={info.index}>
      <div className="page-canvas" ref={canvasHost} />
      <div className="page-detail" ref={detailHost} />
      <div className="textLayer" ref={textHost} />
      <div className="page-overlays">{children}</div>
    </div>
  );
}
