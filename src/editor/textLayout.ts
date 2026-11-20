/**
 * Line breaking shared by the overlay and the exporter, so wrapped text is identical on screen
 * and in the saved PDF.
 */
import type { FontMetrics } from '../fonts';

export const LINE_HEIGHT = 1.2;

export interface LaidOutLine {
  text: string;
  width: number; // in pt at the given size
}

export interface TextLayout {
  lines: LaidOutLine[];
  height: number; // pt
  lineHeight: number; // pt
  /** Distance from the top of a line box to its baseline (pt), matching CSS half-leading. */
  baselineOffset: number;
}

export function layoutText(text: string, maxWidth: number, size: number, m: FontMetrics): TextLayout {
  const measure = (s: string) => m.advance(s) * size;
  const lines: LaidOutLine[] = [];
  const width = Math.max(maxWidth, size); // never narrower than one glyph-ish

  for (const para of text.split('\n')) {
    if (para === '') {
      lines.push({ text: '', width: 0 });
      continue;
    }
    // Split into words keeping the spaces attached to the preceding word.
    const words = para.match(/\S+\s*|\s+/g) ?? [para];
    let cur = '';
    for (const word of words) {
      const candidate = cur + word;
      if (measure(candidate.trimEnd()) <= width || cur === '') {
        if (cur === '' && measure(word.trimEnd()) > width) {
          // Overlong word: break by characters.
          let chunk = '';
          for (const ch of word) {
            if (chunk && measure(chunk + ch) > width) {
              lines.push({ text: chunk, width: measure(chunk) });
              chunk = '';
            }
            chunk += ch;
          }
          cur = chunk;
        } else {
          cur = candidate;
        }
      } else {
        const t = cur.trimEnd();
        lines.push({ text: t, width: measure(t) });
        cur = word;
      }
    }
    const t = cur.trimEnd();
    lines.push({ text: t, width: measure(t) });
  }

  const lineHeight = size * LINE_HEIGHT;
  const contentHeight = (m.ascent + m.descent) * size;
  return {
    lines,
    height: lines.length * lineHeight,
    lineHeight,
    baselineOffset: (lineHeight - contentHeight) / 2 + m.ascent * size,
  };
}

/** Width of the widest line (for shrink-to-fit text boxes). */
export function naturalWidth(text: string, size: number, m: FontMetrics): number {
  return Math.max(0, ...text.split('\n').map((l) => m.advance(l) * size));
}
