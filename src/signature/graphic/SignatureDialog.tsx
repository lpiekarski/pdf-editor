import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../ui/common';
import { SCRIPT_FONTS, cssFont, fontLabel } from '../../fonts';
import type { FontId } from '../../model/types';
import { DrawPad, type DrawPadHandle } from './DrawPad';
import { canvasToPng, fileToCanvas, removeBackground, renderTyped, trimCanvas, type PngResult } from './process';
import { deleteSignature, listSignatures, saveSignature, type SavedSignature } from './library';

type Tab = 'saved' | 'draw' | 'type' | 'upload';
const INKS: { label: string; rgb: [number, number, number] }[] = [
  { label: 'Black', rgb: [0.05, 0.05, 0.08] },
  { label: 'Blue', rgb: [0.07, 0.2, 0.62] },
];
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

export interface SignatureImage extends PngResult {
  kind: SavedSignature['kind'];
}

/** Create (draw / type / upload) or pick a saved graphical signature. */
export function SignatureDialog({ onClose, onDone, title = 'Add signature' }: { onClose(): void; onDone(img: SignatureImage): void; title?: string }) {
  const [saved, setSaved] = useState<SavedSignature[] | null>(null);
  const [tab, setTab] = useState<Tab>('draw');
  const [ink, setInk] = useState(INKS[0].rgb);
  const [remember, setRemember] = useState(true);
  const [empty, setEmpty] = useState(true);
  const [name, setName] = useState('');
  const [font, setFont] = useState<FontId>(SCRIPT_FONTS[0]);
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<DrawPadHandle>(null);

  useEffect(() => {
    listSignatures().then((s) => {
      setSaved(s);
      if (s.length) setTab('saved');
    });
  }, []);

  useEffect(() => {
    if (!upload) return setUploadPreview(null);
    setUploadPreview(removeBackground(upload, { ink }).toDataURL());
  }, [upload, ink]);

  const finish = async () => {
    setError(null);
    let canvas: HTMLCanvasElement | null = null;
    let kind: SavedSignature['kind'] = 'draw';
    if (tab === 'draw') canvas = pad.current && !pad.current.isEmpty() ? trimCanvas(pad.current.render(3)) : null;
    else if (tab === 'type') {
      canvas = await renderTyped(name, font, ink);
      kind = 'type';
    } else if (tab === 'upload' && upload) {
      canvas = trimCanvas(removeBackground(upload, { ink }));
      kind = 'upload';
    }
    if (!canvas) return setError('The signature is empty.');
    const png = await canvasToPng(canvas);
    if (remember) await saveSignature({ kind, png: png.bytes, width: png.width, height: png.height });
    onDone({ ...png, kind });
  };

  const useSaved = (s: SavedSignature) => {
    const blob = new Blob([s.png as BlobPart], { type: 'image/png' });
    const reader = new FileReader();
    reader.onload = () => onDone({ bytes: s.png, width: s.width, height: s.height, dataUrl: String(reader.result), kind: s.kind });
    reader.readAsDataURL(blob);
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="tabs sig-tabs" role="tablist">
        {saved && saved.length > 0 && (
          <button role="tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')}>Saved</button>
        )}
        <button role="tab" aria-selected={tab === 'draw'} onClick={() => setTab('draw')} data-testid="sig-tab-draw">Draw</button>
        <button role="tab" aria-selected={tab === 'type'} onClick={() => setTab('type')} data-testid="sig-tab-type">Type</button>
        <button role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>Upload</button>
      </div>

      <div className="sig-body">
        {tab === 'saved' && (
          <div className="sig-saved">
            {saved?.map((s) => (
              <div key={s.id} className="sig-saved-item">
                <button className="sig-saved-img" onClick={() => useSaved(s)} aria-label="Use this signature">
                  <img src={URL.createObjectURL(new Blob([s.png as BlobPart], { type: 'image/png' }))} alt="Saved signature" />
                </button>
                <button
                  className="link-btn danger"
                  onClick={async () => {
                    await deleteSignature(s.id);
                    setSaved(await listSignatures());
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        {tab === 'draw' && (
          <>
            <div className="draw-wrap">
              <DrawPad ref={pad} color={css(ink)} onChange={setEmpty} />
              <div className="draw-line" />
              {empty && <span className="draw-hint">Sign here with your mouse, finger or pen</span>}
            </div>
            <div className="sig-row">
              <button className="link-btn" onClick={() => pad.current?.clear()}>Clear</button>
            </div>
          </>
        )}
        {tab === 'type' && (
          <>
            <input type="text" className="sig-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Your name" />
            <div className="sig-fonts" role="radiogroup" aria-label="Signature style">
              {SCRIPT_FONTS.map((f) => (
                <button key={f} role="radio" aria-checked={font === f} className={font === f ? 'on' : ''} onClick={() => setFont(f)} style={{ ...cssFont(f, false, false), color: css(ink) }} title={fontLabel(f)}>
                  {name || 'Your name'}
                </button>
              ))}
            </div>
          </>
        )}
        {tab === 'upload' && (
          <>
            <label className="upload-drop">
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setUpload(await fileToCanvas(f));
                  } catch {
                    setError('Could not read that image.');
                  }
                }}
              />
              {uploadPreview ? <img src={uploadPreview} alt="Signature preview" /> : <span>Choose a photo or scan of your signature. The paper background is removed automatically.</span>}
            </label>
          </>
        )}
        {tab !== 'saved' && (
          <div className="sig-row">
            <span className="muted">Ink</span>
            {INKS.map((i) => (
              <button key={i.label} className={`swatch${ink === i.rgb ? ' on' : ''}`} style={{ background: css(i.rgb) }} aria-label={i.label} onClick={() => setInk(i.rgb)} />
            ))}
            <label className="check inline">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Save on this device</span>
            </label>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        {tab !== 'saved' && (
          <button className="primary-btn" onClick={finish} data-testid="sig-done">
            Use signature
          </button>
        )}
      </div>
    </Modal>
  );
}
