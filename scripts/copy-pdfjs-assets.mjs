// Copies pdf.js runtime assets (cmaps, standard fonts, wasm decoders, ICC profiles) into public/pdfjs
// so the app works fully offline without any CDN.
import { cpSync, mkdirSync } from 'node:fs';
const src = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const dst = new URL('../public/pdfjs/', import.meta.url);
mkdirSync(dst, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(new URL(dir, src), new URL(dir, dst), { recursive: true });
console.log('pdf.js assets copied to public/pdfjs');
