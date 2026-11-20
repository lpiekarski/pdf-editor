import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { pageObjects, useEditor } from '../model/editorStore';
import type { EditorObject, ShapeObject, TextObject } from '../model/types';
import type { PageInfo } from '../viewer/pdfjs';
import { viewSize, type Point, type Rect } from '../viewer/coords';
import { ObjectBody, useMetrics } from './ObjectView';
import { angleFrom, center, normRect, resizeRect } from './geometry';
import { createAtPoint, createFromDrag, DRAG_TOOLS, inkFromPoints, POINT_TOOLS, STICKY_TOOLS } from './factory';
import { layoutText } from './textLayout';
import { TextEditor, NoteEditor } from './TextEditor';
import { useUi } from './uiStore';
import { outlineToSvgPath, strokeOutline } from './ink';
import { textForField, useDetected } from '../forms/FillLayer';
import { formatDate } from './factory';

const LONG_PRESS_MS = 500;
const MOVE_SLOP = 4; // px before a press becomes a drag

interface Props {
  info: PageInfo;
  zoom: number;
}

export function ObjectLayer({ info, zoom }: Props) {
  const objects = useEditor(useShallow((s) => pageObjects(s, info.index)));
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const editingId = useEditor((s) => s.editingId);
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [inkPts, setInkPts] = useState<Point[] | null>(null);
  const page = viewSize(info, 1);

  // Text placed on a detected blank snaps onto its line/box.
  const detected = useDetected(info, tool === 'text' || tool === 'date');
  const creating = tool !== 'select' && (POINT_TOOLS.includes(tool) || DRAG_TOOLS.includes(tool) || tool === 'ink');

  const toView = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const finishTool = (created: EditorObject) => {
    const st = useEditor.getState();
    st.add(created);
    if (created.kind === 'text') {
      st.select([created.id]);
      st.setEditing(created.text ? null : created.id);
    } else if (created.kind === 'note') {
      st.select([created.id]);
      useUi.setState({ noteOpen: created.id });
    } else if (!STICKY_TOOLS.includes(st.tool)) {
      st.select([created.id]);
    }
    if (!STICKY_TOOLS.includes(st.tool) && !st.toolLocked) useEditor.setState({ tool: 'select' });
  };

  // ---------- creating objects ----------
  const onLayerPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!creating || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const a = toView(e);
    const st = useEditor.getState();
    st.select([]);
    if (tool === 'ink') {
      const pts = [a];
      setInkPts(pts);
      const move = (ev: PointerEvent) => {
        pts.push(toView(ev));
        setInkPts([...pts]);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        setInkPts(null);
        const o = inkFromPoints(info.index, pts, useEditor.getState().style);
        if (o) finishTool(o);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      return;
    }
    let b = a;
    const move = (ev: PointerEvent) => {
      b = toView(ev);
      if (DRAG_TOOLS.includes(tool)) setDraft({ a, b });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDraft(null);
      if (ev.type === 'pointercancel') return;
      const style = useEditor.getState().style;
      const hit = (tool === 'text' || tool === 'date') && detected.find((f) => f.kind !== 'checkbox' && b.x >= f.rect.x && b.x <= f.rect.x + f.rect.width && b.y >= f.rect.y - 4 && b.y <= f.rect.y + f.rect.height + 4);
      if (hit) {
        const snapped = textForField(hit, info.index);
        if (tool === 'date' && snapped.kind === 'text') snapped.text = formatDate();
        finishTool(snapped);
        return;
      }
      const o = POINT_TOOLS.includes(tool)
        ? createAtPoint(tool, info.index, b, style)
        : createFromDrag(tool, info.index, normRect(a, b), style, a, b);
      if (o) finishTool(o);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const sel = objects.filter((o) => selection.includes(o.id));
  const single = sel.length === 1 ? sel[0] : null;

  return (
    <div
      ref={ref}
      className={`object-layer${creating ? ' creating' : ''}`}
      data-tool={tool}
      onPointerDown={onLayerPointerDown}
    >
      {objects.map((o) => (
        <ObjectBox key={o.id} o={o} zoom={zoom} selected={selection.includes(o.id)} toView={toView} />
      ))}
      {single && !single.locked && editingId !== single.id && <Handles o={single} zoom={zoom} toView={toView} />}
      {editingId && objects.find((o) => o.id === editingId)?.kind === 'text' && (
        <TextEditor o={objects.find((o) => o.id === editingId) as TextObject} zoom={zoom} />
      )}
      {objects.filter((o) => o.kind === 'note').map((o) => <NoteEditor key={`n${o.id}`} id={o.id} zoom={zoom} pageWidth={page.width} />)}
      {draft && <DraftShape a={draft.a} b={draft.b} zoom={zoom} />}
      {inkPts && <InkPreview pts={inkPts} zoom={zoom} />}
      {objects.filter((o): o is TextObject => o.kind === 'text').map((o) => <TextAutoHeight key={`h${o.id}`} o={o} />)}
    </div>
  );
}

/** Keeps a text box's height equal to its laid-out content (not an undo step). */
function TextAutoHeight({ o }: { o: TextObject }) {
  const m = useMetrics(o);
  useEffect(() => {
    if (!m) return;
    const h = Math.max(layoutText(o.text, o.rect.width, o.size, m).height, o.size * 1.2);
    if (Math.abs(h - o.rect.height) > 0.25) {
      useEditor.setState((s) => {
        const cur = s.objects[o.id];
        return cur ? { objects: { ...s.objects, [o.id]: { ...cur, rect: { ...cur.rect, height: h } } } } : {};
      });
    }
  }, [m, o.id, o.text, o.size, o.rect.width, o.rect.height]);
  return null;
}

function boxStyle(r: Rect, rotation: number, zoom: number) {
  return {
    left: r.x * zoom,
    top: r.y * zoom,
    width: r.width * zoom,
    height: r.height * zoom,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };
}

function ObjectBox({ o, zoom, selected, toView }: { o: EditorObject; zoom: number; selected: boolean; toView: (e: { clientX: number; clientY: number }) => Point }) {
  const isMarkup = o.kind === 'highlight' || o.kind === 'underline' || o.kind === 'strikeout';

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button === 2) return; // context menu handles it
    const st = useEditor.getState();
    if (st.editingId === o.id) return;
    const wasSelected = st.selection.includes(o.id);
    let ids = st.selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) ids = wasSelected ? ids.filter((x) => x !== o.id) : [...ids, o.id];
    else if (!wasSelected) ids = [o.id];
    st.select(ids);
    if (st.tool !== 'select' && !isMarkup) useEditor.setState({ tool: 'select' });

    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const startView = toView(e);
    const startRects = Object.fromEntries(ids.map((id) => [id, st.objects[id]?.rect]));
    const token = Math.random().toString(36);
    let moved = false;
    const timer = setTimeout(() => {
      if (!moved) useUi.getState().openMenu(start.x, start.y, ids);
    }, LONG_PRESS_MS);

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < MOVE_SLOP) return;
      moved = true;
      clearTimeout(timer);
      if (isMarkup || o.locked) return;
      const p = toView(ev);
      const dx = p.x - startView.x;
      const dy = p.y - startView.y;
      useEditor.getState().updateMany(
        ids.filter((id) => !useEditor.getState().objects[id]?.locked && startRects[id]),
        (obj) => ({ rect: { ...startRects[obj.id]!, x: startRects[obj.id]!.x + dx, y: startRects[obj.id]!.y + dy } }),
        `move:${token}`,
      );
    };
    const up = () => {
      clearTimeout(timer);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved || useUi.getState().menu) return;
      // Tap on an already selected object: edit text / open note.
      if (wasSelected && o.kind === 'text' && !o.locked) useEditor.getState().setEditing(o.id);
      if (o.kind === 'note') useUi.setState({ noteOpen: o.id });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div
      className={`obj obj-${o.kind}${selected ? ' selected' : ''}`}
      data-id={o.id}
      style={{ ...boxStyle(o.rect, o.rotation, zoom), opacity: o.opacity }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => o.kind === 'text' && !o.locked && useEditor.getState().setEditing(o.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        const st = useEditor.getState();
        const ids = st.selection.includes(o.id) ? st.selection : [o.id];
        st.select(ids);
        useUi.getState().openMenu(e.clientX, e.clientY, ids);
      }}
    >
      <ObjectBody o={o} zoom={zoom} />
    </div>
  );
}

const HANDLES: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function Handles({ o, zoom, toView }: { o: EditorObject; zoom: number; toView: (e: { clientX: number; clientY: number }) => Point }) {
  const isMarkup = o.kind === 'highlight' || o.kind === 'underline' || o.kind === 'strikeout';
  if (isMarkup || o.kind === 'note') return <div className="sel-frame" style={boxStyle(o.rect, o.rotation, zoom)} />;
  const isLine = o.kind === 'shape' && (o.shape === 'line' || o.shape === 'arrow');
  const keepAspect = o.kind === 'image' || o.kind === 'mark';
  const handles = o.kind === 'text' ? HANDLES.filter(([, hy]) => hy === 0) : HANDLES;

  const drag = (e: RPointerEvent, onMove: (p: Point, start: Point, ev: PointerEvent) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = toView(e);
    const move = (ev: PointerEvent) => onMove(toView(ev), start, ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const token = `resize:${o.id}:${Date.now()}`;

  if (isLine) {
    const s = o as ShapeObject;
    const abs = (q: Point) => ({ x: s.rect.x + q.x * s.rect.width, y: s.rect.y + q.y * s.rect.height });
    const a = abs(s.from ?? { x: 0, y: 0 });
    const b = abs(s.to ?? { x: 1, y: 1 });
    const endpoint = (which: 'from' | 'to') => (e: RPointerEvent) =>
      drag(e, (p) => {
        const na = which === 'from' ? p : a;
        const nb = which === 'to' ? p : b;
        const pad = Math.max(2, s.strokeWidth * 3);
        const rect = { x: Math.min(na.x, nb.x) - pad, y: Math.min(na.y, nb.y) - pad, width: Math.abs(na.x - nb.x) + 2 * pad, height: Math.abs(na.y - nb.y) + 2 * pad };
        const rel = (q: Point) => ({ x: (q.x - rect.x) / rect.width, y: (q.y - rect.y) / rect.height });
        useEditor.getState().update(s.id, { rect, from: rel(na), to: rel(nb) } as Partial<EditorObject>, token);
      });
    return (
      <>
        {[{ p: a, w: 'from' as const }, { p: b, w: 'to' as const }].map(({ p, w }) => (
          <div key={w} className="handle" style={{ left: p.x * zoom, top: p.y * zoom }} onPointerDown={endpoint(w)} />
        ))}
      </>
    );
  }

  const start = { rect: o.rect, rotation: o.rotation, paths: o.kind === 'ink' ? o.paths : null };
  return (
    <div className="sel-frame" style={boxStyle(o.rect, o.rotation, zoom)}>
      {handles.map(([hx, hy]) => (
        <div
          key={`${hx},${hy}`}
          className="handle"
          style={{ left: `${((hx + 1) / 2) * 100}%`, top: `${((hy + 1) / 2) * 100}%`, cursor: cursorFor(hx, hy, o.rotation) }}
          onPointerDown={(e) =>
            drag(e, (p, s0, ev) => {
              const rect = resizeRect(start.rect, start.rotation, hx, hy, { x: p.x - s0.x, y: p.y - s0.y }, { keepAspect: keepAspect !== ev.shiftKey && hx !== 0 && hy !== 0 });
              const patch: Partial<EditorObject> = { rect };
              if (start.paths) {
                const kx = rect.width / start.rect.width;
                const ky = rect.height / start.rect.height;
                (patch as { paths: Point[][] }).paths = start.paths.map((path) => path.map((q) => ({ x: q.x * kx, y: q.y * ky })));
              }
              useEditor.getState().update(o.id, patch, token);
            })
          }
        />
      ))}
      <div className="rotate-stem" />
      <div
        className="handle rotate"
        title="Rotate"
        onPointerDown={(e) =>
          drag(e, (p, _s, ev) => useEditor.getState().update(o.id, { rotation: angleFrom(center(start.rect), p, ev.shiftKey) }, token))
        }
      />
    </div>
  );
}

function cursorFor(hx: number, hy: number, rotation: number) {
  const names = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  const base = hx === 0 ? 0 : hy === 0 ? 2 : hx === hy ? 3 : 1;
  return names[(base + Math.round(rotation / 45)) % 4];
}

function DraftShape({ a, b, zoom }: { a: Point; b: Point; zoom: number }) {
  const r = normRect(a, b);
  return <div className="draft-box" style={boxStyle(r, 0, zoom)} />;
}

function InkPreview({ pts, zoom }: { pts: Point[]; zoom: number }) {
  const style = useEditor((s) => s.style);
  return (
    <svg className="ink-preview" width="100%" height="100%">
      <path
        d={outlineToSvgPath(strokeOutline(pts.map((p) => ({ x: p.x * zoom, y: p.y * zoom })), style.inkWidth * zoom))}
        fill={`rgb(${style.inkColor.map((c) => Math.round(c * 255)).join(',')})`}
      />
    </svg>
  );
}
