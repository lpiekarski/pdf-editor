import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../model/docStore';
import { useView } from '../model/viewStore';
import { renderQueue, type PageInfo, type PDFDocumentProxy } from './pdfjs';
import { viewSize } from './coords';

const THUMB_W = 112;

interface ThumbProps {
  pdf: PDFDocumentProxy;
  info: PageInfo;
  active: boolean;
  onClick(): void;
}

function Thumb({ pdf, info, active, onClick }: ThumbProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const s = viewSize(info, 1);
  const scale = THUMB_W / s.width;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setInView(true), { rootMargin: '200px' });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    renderQueue.run(async () => {
      if (cancelled) return;
      const page = await pdf.getPage(info.index + 1);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: scale * dpr, rotation: info.rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (!cancelled) host.current?.replaceChildren(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [inView, pdf, info, scale]);

  return (
    <button
      ref={ref}
      className={active ? 'thumb active' : 'thumb'}
      onClick={onClick}
      aria-label={`Page ${info.index + 1}`}
      aria-current={active ? 'page' : undefined}
    >
      <div className="thumb-img" ref={host} style={{ width: THUMB_W, height: s.height * scale }} />
      <span>{info.index + 1}</span>
    </button>
  );
}

export function Thumbnails({ onPick }: { onPick?: () => void }) {
  const { pdf, pages } = useDoc();
  const current = useView((s) => s.currentPage);
  if (!pdf) return null;
  return (
    <div className="thumbs">
      {pages.map((p) => (
        <Thumb
          key={p.index}
          pdf={pdf}
          info={p}
          active={p.index === current}
          onClick={() => {
            useView.getState().goToPage(p.index);
            onPick?.();
          }}
        />
      ))}
    </div>
  );
}
