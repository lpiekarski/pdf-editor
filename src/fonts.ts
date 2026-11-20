/**
 * Font registry shared by the on-screen editor (CSS @font-face) and the PDF exporter (embedded TTF).
 * Using the very same font files in both places is what makes text WYSIWYG.
 */
import fontkit from '@pdf-lib/fontkit';
import type { FontId } from './model/types';

type Face = 'regular' | 'bold' | 'italic' | 'boldItalic';

const FILES: Record<FontId, Partial<Record<Face, string>> & { regular: string; label: string; css: string }> = {
  sans: {
    label: 'Sans',
    css: 'EdSans',
    regular: 'NotoSans-Regular.ttf',
    bold: 'NotoSans-Bold.ttf',
    italic: 'NotoSans-Italic.ttf',
    boldItalic: 'NotoSans-BoldItalic.ttf',
  },
  serif: { label: 'Serif', css: 'EdSerif', regular: 'NotoSerif-Regular.ttf', bold: 'NotoSerif-Bold.ttf' },
  mono: { label: 'Mono', css: 'EdMono', regular: 'NotoSansMono-Regular.ttf' },
  'script-greatvibes': { label: 'Great Vibes', css: 'EdGreatVibes', regular: 'GreatVibes-Regular.ttf' },
  'script-allura': { label: 'Allura', css: 'EdAllura', regular: 'Allura-Regular.ttf' },
  'script-alexbrush': { label: 'Alex Brush', css: 'EdAlexBrush', regular: 'AlexBrush-Regular.ttf' },
};

export const FONT_IDS = Object.keys(FILES) as FontId[];
export const fontLabel = (id: FontId) => FILES[id].label;
export const SCRIPT_FONTS: FontId[] = ['script-greatvibes', 'script-allura', 'script-alexbrush'];

/** Resolves the file actually used; missing bold/italic faces fall back (no fake synthesis). */
export function fontFile(id: FontId, bold: boolean, italic: boolean): { file: string; bold: boolean; italic: boolean } {
  const f = FILES[id];
  if (bold && italic && f.boldItalic) return { file: f.boldItalic, bold, italic };
  if (bold && f.bold) return { file: f.bold, bold: true, italic: false };
  if (italic && f.italic) return { file: f.italic, bold: false, italic: true };
  return { file: f.regular, bold: false, italic: false };
}

/** CSS that renders with the exact same file as the export. */
export function cssFont(id: FontId, bold: boolean, italic: boolean) {
  const r = fontFile(id, bold, italic);
  return { fontFamily: `'${FILES[id].css}'`, fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : 'normal' };
}

/** @font-face rules, injected once at startup. */
export function fontFaceCss(base: string): string {
  const rules: string[] = [];
  for (const f of Object.values(FILES)) {
    const faces: [Face, number, string][] = [
      ['regular', 400, 'normal'],
      ['bold', 700, 'normal'],
      ['italic', 400, 'italic'],
      ['boldItalic', 700, 'italic'],
    ];
    for (const [face, weight, style] of faces) {
      const file = f[face];
      if (file) rules.push(`@font-face{font-family:'${f.css}';src:url('${base}fonts/${file}') format('truetype');font-weight:${weight};font-style:${style};font-display:block}`);
    }
  }
  return rules.join('\n');
}

export function injectFontFaces() {
  const style = document.createElement('style');
  style.textContent = fontFaceCss(import.meta.env.BASE_URL);
  document.head.appendChild(style);
}

// ---------- loading (browser: fetch; tests: overridable) ----------

let loader: (file: string) => Promise<Uint8Array> = async (file) => {
  const r = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`);
  if (!r.ok) throw new Error(`Font ${file} failed to load`);
  return new Uint8Array(await r.arrayBuffer());
};
export function setFontLoader(fn: (file: string) => Promise<Uint8Array>) {
  loader = fn;
}

const bytesCache = new Map<string, Promise<Uint8Array>>();
export function loadFontBytes(file: string): Promise<Uint8Array> {
  let p = bytesCache.get(file);
  if (!p) bytesCache.set(file, (p = loader(file)));
  return p;
}

export interface FontMetrics {
  /** Advance width of `text` at size 1. */
  advance(text: string): number;
  ascent: number; // at size 1, positive
  descent: number; // at size 1, positive
}

type FkFont = { unitsPerEm: number; ascent: number; descent: number; layout(t: string): { advanceWidth: number } };
const metricsCache = new Map<string, Promise<FontMetrics>>();
export function loadMetrics(file: string): Promise<FontMetrics> {
  let p = metricsCache.get(file);
  if (!p) {
    p = loadFontBytes(file).then((bytes) => {
      const font = fontkit.create(bytes as never) as unknown as FkFont;
      const upm = font.unitsPerEm;
      const widths = new Map<string, number>();
      return {
        advance(text: string) {
          let w = widths.get(text);
          if (w === undefined) {
            w = font.layout(text).advanceWidth / upm;
            if (widths.size < 5000) widths.set(text, w);
          }
          return w;
        },
        ascent: font.ascent / upm,
        descent: Math.abs(font.descent) / upm,
      };
    });
    metricsCache.set(file, p);
  }
  return p;
}
