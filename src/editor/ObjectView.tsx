import { useEffect, useState, type CSSProperties } from 'react';
import type { Color, EditorObject, TextObject } from '../model/types';
import { useEditor } from '../model/editorStore';
import { cssFont, fontFile, loadMetrics, type FontMetrics } from '../fonts';
import { layoutText } from './textLayout';
import { outlineToSvgPath, strokeOutline } from './ink';

export const css = (c: Color | null | undefined, a = 1) =>
  c ? `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})` : 'transparent';

export function useMetrics(o: Pick<TextObject, 'font' | 'bold' | 'italic'>): FontMetrics | null {
  const file = fontFile(o.font, o.bold, o.italic).file;
  const [m, setM] = useState<{ file: string; m: FontMetrics } | null>(null);
  useEffect(() => {
    let alive = true;
    loadMetrics(file).then((metrics) => alive && setM({ file, m: metrics }));
    return () => {
      alive = false;
    };
  }, [file]);
  return m?.file === file ? m.m : null;
}

export function TextBody({ o, zoom }: { o: TextObject; zoom: number }) {
  const m = useMetrics(o);
  const font = cssFont(o.font, o.bold, o.italic);
  const style: CSSProperties = {
    ...font,
    fontSize: o.size * zoom,
    lineHeight: 1.2,
    color: css(o.color),
    textAlign: o.align,
    whiteSpace: 'pre',
    background: css(o.background),
  };
  if (!m) return <div className="obj-text" style={{ ...style, whiteSpace: 'pre-wrap' }}>{o.text}</div>;
  const lay = layoutText(o.text, o.rect.width, o.size, m);
  return (
    <div className="obj-text" style={style}>
      {lay.lines.map((l, i) => (
        <div key={i} style={{ height: lay.lineHeight * zoom }}>
          {l.text || '​'}
        </div>
      ))}
    </div>
  );
}

const MarkSvg = ({ mark, color }: { mark: 'check' | 'cross' | 'dot'; color: Color }) => (
  <svg viewBox="0 0 10 10" width="100%" height="100%" preserveAspectRatio="none">
    {mark === 'check' && <path d="M1 5.5 L4 8.5 L9 1.5" fill="none" stroke={css(color)} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />}
    {mark === 'cross' && <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" fill="none" stroke={css(color)} strokeWidth={1.4} strokeLinecap="round" />}
    {mark === 'dot' && <circle cx={5} cy={5} r={3} fill={css(color)} />}
  </svg>
);

export const NoteIcon = ({ color }: { color: Color }) => (
  <svg viewBox="0 0 20 20" width="100%" height="100%">
    <path d="M2 2h16v11l-5 5H2z" fill={css(color)} stroke="#555" strokeWidth={1} />
    <path d="M5 7h10M5 10h8" stroke="#555" strokeWidth={1.2} />
  </svg>
);

/** Visual body of an object, drawn inside a box of size rect*zoom (rotation applied by the parent). */
export function ObjectBody({ o, zoom }: { o: EditorObject; zoom: number }) {
  const images = useEditor((s) => s.images);
  const w = o.rect.width;
  const h = o.rect.height;
  switch (o.kind) {
    case 'text':
      return <TextBody o={o} zoom={zoom} />;
    case 'image': {
      const img = images[o.imageId];
      return img ? <img src={img.url} alt="" draggable={false} className="obj-img" /> : null;
    }
    case 'whiteout':
      return <div className="obj-fill" style={{ background: css(o.color) }} />;
    case 'mark':
      return <MarkSvg mark={o.mark} color={o.color} />;
    case 'note':
      return <NoteIcon color={o.color} />;
    case 'shape': {
      const sw = o.strokeWidth;
      const stroke = o.stroke ? css(o.stroke) : 'none';
      const fill = o.fill ? css(o.fill) : 'none';
      let el;
      if (o.shape === 'rect') el = <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} fill={fill} stroke={stroke} strokeWidth={sw} />;
      else if (o.shape === 'ellipse')
        el = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} fill={fill} stroke={stroke} strokeWidth={sw} />;
      else {
        const a = { x: (o.from?.x ?? 0) * w, y: (o.from?.y ?? 0) * h };
        const b = { x: (o.to?.x ?? 1) * w, y: (o.to?.y ?? 1) * h };
        const head = arrowHead(a, b, sw);
        el = (
          <>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
            {o.shape === 'arrow' && <polygon points={head.map((p) => `${p.x},${p.y}`).join(' ')} fill={stroke} />}
          </>
        );
      }
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" overflow="visible">
          {el}
        </svg>
      );
    }
    case 'ink':
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" overflow="visible">
          {o.paths.map((p, i) => (
            <path key={i} d={outlineToSvgPath(strokeOutline(p, o.width))} fill={css(o.color)} />
          ))}
        </svg>
      );
    case 'annot':
      // pdf.js draws the annotation itself; this box only makes it selectable.
      return (
        <div className="obj-annot-hit" title={o.contents ? `${o.subtype}: ${o.contents}` : o.subtype}>
          {!o.hasAppearance && (o.subtype === 'Text' ? <NoteIcon color={[1, 0.85, 0.3]} /> : <div className="annot-placeholder" />)}
        </div>
      );
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return (
        <>
          {o.quads.map((q, i) => {
            const style: CSSProperties = {
              position: 'absolute',
              left: (q.x - o.rect.x) * zoom,
              top: (q.y - o.rect.y) * zoom,
              width: q.width * zoom,
              height: q.height * zoom,
            };
            if (o.kind === 'highlight') Object.assign(style, { background: css(o.color, 0.4), mixBlendMode: 'multiply' });
            else
              Object.assign(style, {
                borderBottom: `${Math.max(1, zoom)}px solid ${css(o.color)}`,
                height: o.kind === 'strikeout' ? (q.height * zoom) / 2 + 1 : q.height * zoom,
              });
            return <div key={i} style={style} />;
          })}
        </>
      );
  }
}

/** Triangle points for an arrow head at b, pointing from a to b. */
export function arrowHead(a: { x: number; y: number }, b: { x: number; y: number }, sw: number) {
  const len = Math.max(6, sw * 4);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = Math.PI / 7;
  return [
    b,
    { x: b.x - len * Math.cos(ang - spread), y: b.y - len * Math.sin(ang - spread) },
    { x: b.x - len * Math.cos(ang + spread), y: b.y - len * Math.sin(ang + spread) },
  ];
}
