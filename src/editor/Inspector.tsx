import { useShallow } from 'zustand/react/shallow';
import { useEditor, type ToolStyle } from '../model/editorStore';
import type { Color, EditorObject, FontId, ObjectKind } from '../model/types';
import { FONT_IDS, fontLabel } from '../fonts';
import { css } from './ObjectView';
import { IconTrash } from '../ui/icons';

const PALETTE: Color[] = [
  [0, 0, 0],
  [0.4, 0.4, 0.4],
  [1, 1, 1],
  [0.05, 0.15, 0.6],
  [0.15, 0.4, 0.95],
  [0.85, 0.1, 0.1],
  [0.1, 0.6, 0.2],
  [1, 0.55, 0],
  [1, 0.9, 0.2],
];

const hex = (c: Color) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): Color => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Color;
const same = (a: Color | null, b: Color | null) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 0.01);

function Swatches({ value, onChange, allowNone, label }: { value: Color | null; onChange(c: Color | null): void; allowNone?: boolean; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {allowNone && (
        <button className={`swatch none${value === null ? ' on' : ''}`} aria-label="None" role="radio" aria-checked={value === null} onClick={() => onChange(null)} />
      )}
      {PALETTE.map((c) => (
        <button
          key={hex(c)}
          className={`swatch${same(value, c) ? ' on' : ''}`}
          style={{ background: css(c) }}
          aria-label={hex(c)}
          role="radio"
          aria-checked={same(value, c)}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={value ? hex(value) : '#000000'} onChange={(e) => onChange(fromHex(e.target.value))} aria-label="Custom colour" />
      </label>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="insp-row">
      <span className="insp-label">{label}</span>
      {children}
    </div>
  );
}

/** Kind of the selected objects, or the kind the active tool creates. */
function toolKind(tool: string): ObjectKind | null {
  if (tool === 'text' || tool === 'date') return 'text';
  if (['rect', 'ellipse', 'line', 'arrow'].includes(tool)) return 'shape';
  if (tool === 'ink') return 'ink';
  if (['check', 'cross', 'dot'].includes(tool)) return 'mark';
  if (['highlight', 'underline', 'strikeout'].includes(tool)) return 'highlight';
  return null;
}

export function Inspector() {
  const selected = useEditor(useShallow((s) => s.selection.map((id) => s.objects[id]).filter(Boolean)));
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const kinds = new Set(selected.map((o) => o.kind));
  const kind: ObjectKind | null = selected.length ? (kinds.size === 1 ? selected[0].kind : null) : toolKind(tool);
  const first = selected[0] as EditorObject | undefined;
  const editable = selected.filter((o) => !o.locked);

  const apply = (patch: Partial<EditorObject>, stylePatch?: Partial<ToolStyle>) => {
    if (stylePatch) useEditor.getState().setStyle(stylePatch);
    if (editable.length) useEditor.getState().updateMany(editable.map((o) => o.id), () => patch, `insp:${Object.keys(patch).join()}`);
  };

  if (!selected.length && !kind) {
    return (
      <div className="inspector empty-insp">
        <p>Select an object to change its look, or pick a tool to set its default style.</p>
      </div>
    );
  }

  const v = <T,>(k: string, fallback: T): T => ((first as unknown as Record<string, unknown> | undefined)?.[k] ?? fallback) as T;

  return (
    <div className="inspector" aria-label="Properties">
      {kind === 'text' && (
        <>
          <Row label="Font">
            <select value={v('font', style.font) as FontId} onChange={(e) => apply({ font: e.target.value as FontId } as Partial<EditorObject>, { font: e.target.value as FontId })}>
              {FONT_IDS.map((f) => (
                <option key={f} value={f}>{fontLabel(f)}</option>
              ))}
            </select>
          </Row>
          <Row label="Size">
            <input
              type="number"
              min={4}
              max={144}
              step={1}
              value={v('size', style.size) as number}
              onChange={(e) => {
                const n = Math.max(4, Math.min(144, Number(e.target.value) || 12));
                apply({ size: n } as Partial<EditorObject>, { size: n });
              }}
            />
            <button className={`toggle${v('bold', style.bold) ? ' on' : ''}`} aria-pressed={!!v('bold', style.bold)} onClick={() => apply({ bold: !v('bold', style.bold) } as Partial<EditorObject>, { bold: !v('bold', style.bold) })}>
              <b>B</b>
            </button>
            <button className={`toggle${v('italic', style.italic) ? ' on' : ''}`} aria-pressed={!!v('italic', style.italic)} onClick={() => apply({ italic: !v('italic', style.italic) } as Partial<EditorObject>, { italic: !v('italic', style.italic) })}>
              <i>I</i>
            </button>
          </Row>
          <Row label="Align">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={`toggle${v('align', 'left') === a ? ' on' : ''}`} onClick={() => apply({ align: a } as Partial<EditorObject>)}>
                {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </Row>
          <Row label="Colour">
            <Swatches label="Text colour" value={v('color', style.textColor) as Color} onChange={(c) => c && apply({ color: c } as Partial<EditorObject>, { textColor: c })} />
          </Row>
          {first && (
            <Row label="Background">
              <Swatches label="Background" allowNone value={v<Color | null>('background', null)} onChange={(c) => apply({ background: c } as Partial<EditorObject>)} />
            </Row>
          )}
        </>
      )}
      {kind === 'shape' && (
        <>
          <Row label="Stroke">
            <Swatches label="Stroke colour" allowNone value={v<Color | null>('stroke', style.stroke)} onChange={(c) => apply({ stroke: c } as Partial<EditorObject>, c ? { stroke: c } : undefined)} />
          </Row>
          <Row label="Fill">
            <Swatches label="Fill colour" allowNone value={v<Color | null>('fill', style.fill)} onChange={(c) => apply({ fill: c } as Partial<EditorObject>, { fill: c })} />
          </Row>
          <Row label="Width">
            <input type="range" min={0.5} max={12} step={0.5} value={v('strokeWidth', style.strokeWidth) as number} onChange={(e) => apply({ strokeWidth: Number(e.target.value) } as Partial<EditorObject>, { strokeWidth: Number(e.target.value) })} />
          </Row>
        </>
      )}
      {kind === 'ink' && (
        <>
          <Row label="Colour">
            <Swatches label="Pen colour" value={v('color', style.inkColor) as Color} onChange={(c) => c && apply({ color: c } as Partial<EditorObject>, { inkColor: c })} />
          </Row>
          <Row label="Width">
            <input type="range" min={0.5} max={12} step={0.5} value={v('width', style.inkWidth) as number} onChange={(e) => apply({ width: Number(e.target.value) } as Partial<EditorObject>, { inkWidth: Number(e.target.value) })} />
          </Row>
        </>
      )}
      {(kind === 'mark' || kind === 'whiteout' || kind === 'note' || kind === 'highlight' || kind === 'underline' || kind === 'strikeout') && (
        <Row label="Colour">
          <Swatches
            label="Colour"
            value={v('color', kind === 'mark' ? style.markColor : style.highlightColor) as Color}
            onChange={(c) => c && apply({ color: c } as Partial<EditorObject>, kind === 'mark' ? { markColor: c } : kind === 'highlight' ? { highlightColor: c } : undefined)}
          />
        </Row>
      )}
      {editable.length > 0 && (
        <>
          <Row label="Opacity">
            <input type="range" min={0.1} max={1} step={0.05} value={first?.opacity ?? 1} onChange={(e) => apply({ opacity: Number(e.target.value) })} />
          </Row>
          <div className="insp-actions">
            <button onClick={() => useEditor.getState().bringToFront(editable.map((o) => o.id))}>To front</button>
            <button onClick={() => useEditor.getState().sendToBack(editable.map((o) => o.id))}>To back</button>
            <button className="danger" onClick={() => useEditor.getState().remove(selected.map((o) => o.id))}>
              <IconTrash width={16} height={16} /> Delete
            </button>
          </div>
        </>
      )}
      {selected.some((o) => o.locked) && <p className="muted">Existing annotations from the file can only be deleted.</p>}
    </div>
  );
}
