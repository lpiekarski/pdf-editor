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
      <div className="textLayer" ref={textHost} />
      <div className="page-overlays">{children}</div>
    </div>
  );
}
