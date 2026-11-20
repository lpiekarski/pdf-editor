import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useGesture } from '@use-gesture/react';
import { useDoc } from '../model/docStore';
import { clampZoom, useView, MIN_ZOOM, MAX_ZOOM } from '../model/viewStore';
import { PageView } from './PageView';
import { viewSize } from './coords';
import type { PageInfo } from './pdfjs';

const PAD = 16;
const GAP = 16;

interface Props {
  /** Renders the overlay layers for one page (editor objects, form inputs, signature badges). */
  renderOverlay?: (info: PageInfo, zoom: number) => ReactNode;
  annotationMode?: number;
}

export function Viewer({ renderOverlay, annotationMode }: Props) {
  const { pdf, pages } = useDoc();
  const zoom = useView((s) => s.zoom);
  const scrollRequest = useView((s) => s.scrollRequest);
  const fitRequest = useView((s) => s.fitRequest);
  const ref = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  // Track which pages are near the screen (±1 viewport) so only those keep canvases.
  useEffect(() => {
    const root = ref.current;
    if (!root || !pages.length) return;
    const io = new IntersectionObserver(
      (entries) =>
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const i = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(i);
            else next.delete(i);
          }
          return next;
        }),
      { root, rootMargin: '100% 0px' },
    );
    pageEls.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [pages]);

  // Current page = the one crossing the vertical middle of the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const mid = el.scrollTop + el.clientHeight / 2;
      let cur = 0;
      pageEls.current.forEach((p, i) => {
        if (p && p.offsetTop <= mid) cur = i;
      });
      if (cur !== useView.getState().currentPage) useView.getState().setCurrentPage(cur);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [pages]);

  // Fit to width/page on request.
  useEffect(() => {
    const el = ref.current;
    if (!fitRequest || !el || !pages.length) return;
    const cur = pages[useView.getState().currentPage] ?? pages[0];
    const maxW = Math.max(...pages.map((p) => viewSize(p, 1).width));
    const zw = (el.clientWidth - 2 * PAD) / maxW;
    const zp = Math.min(zw, (el.clientHeight - 2 * PAD) / viewSize(cur, 1).height);
    useView.getState().setZoom(fitRequest.mode === 'width' ? zw : zp);
  }, [fitRequest, pages]);

  // Initial fit when a document opens: fit width (capped on large screens).
  useEffect(() => {
    const el = ref.current;
    if (!el || !pages.length) return;
    const maxW = Math.max(...pages.map((p) => viewSize(p, 1).width));
    useView.getState().setZoom(Math.min(1.25, (el.clientWidth - 2 * PAD) / maxW));
    useView.getState().setCurrentPage(0);
    el.scrollTo(0, 0);
  }, [pages]);

  // Scroll to page on request (thumbnails, page input).
  useEffect(() => {
    if (!scrollRequest) return;
    const p = pageEls.current[scrollRequest.page];
    if (p && ref.current) ref.current.scrollTo({ top: p.offsetTop - PAD, behavior: 'smooth' });
  }, [scrollRequest]);

  const zoomAt = (target: number, clientX: number, clientY: number) => {
    const el = ref.current!;
    const prev = useView.getState().zoom;
    const next = clampZoom(target);
    if (Math.abs(next - prev) < 1e-4) return;
    const r = el.getBoundingClientRect();
    const fx = clientX - r.left;
    const fy = clientY - r.top;
    const k = next / prev;
    pendingScroll.current = { left: (el.scrollLeft + fx) * k - fx, top: (el.scrollTop + fy) * k - fy };
    useView.getState().setZoom(next);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.left;
      el.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);

  // Pinch (touch) and ctrl+wheel / trackpad pinch (desktop) zoom around the focal point.
  useGesture(
    {
      onPinch: ({ origin: [ox, oy], offset: [s], event }) => {
        if (event?.cancelable) event.preventDefault();
        zoomAt(s, ox, oy);
      },
    },
    {
      target: ref,
      eventOptions: { passive: false },
      pinch: {
        scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM },
        from: () => [useView.getState().zoom, 0],
        rubberband: false,
      },
    },
  );

  // iOS Safari fires proprietary gesture events that would zoom the whole web page.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, []);

  if (!pdf) return null;
  return (
    <div className="viewer" ref={ref} data-testid="viewer">
      <div className="viewer-pages" style={{ padding: PAD, gap: GAP }}>
        {pages.map((info) => (
          <PageView
            key={info.index}
            pdf={pdf}
            info={info}
            zoom={zoom}
            visible={visible.has(info.index)}
            annotationMode={annotationMode}
            pageRef={(el) => {
              pageEls.current[info.index] = el;
            }}
          >
            {renderOverlay?.(info, zoom)}
          </PageView>
        ))}
      </div>
    </div>
  );
}
