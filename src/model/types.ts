/**
 * Editor objects.
 *
 * Coordinates are in **view units**: the page as the user sees it (page /Rotate already applied),
 * origin at the top-left corner, y pointing down, 1 unit = 1 PDF point (scale 1).
 * The overlay multiplies by the zoom; the exporter maps view units to PDF user space with the
 * page's view transform (see viewer/coords.ts), so objects stay upright on rotated pages.
 */
import type { Point, Rect } from '../viewer/coords';

export type Color = [number, number, number]; // sRGB 0..1

export type FontId = 'sans' | 'serif' | 'mono' | 'script-greatvibes' | 'script-allura' | 'script-alexbrush';

interface Base {
  id: string;
  page: number; // 0-based
  rect: Rect; // view units
  /** Clockwise rotation in degrees around the rect centre (as seen on screen). */
  rotation: number;
  opacity: number; // 0..1
  /** Objects that came from the PDF itself (existing annotations) and are only deletable. */
  locked?: boolean;
}

export interface TextObject extends Base {
  kind: 'text';
  text: string;
  font: FontId;
  bold: boolean;
  italic: boolean;
  size: number; // pt
  color: Color;
  align: 'left' | 'center' | 'right';
  background: Color | null;
}

export interface ImageObject extends Base {
  kind: 'image';
  imageId: string; // key into the image store
  /** True for graphical signatures (shown in the signature UI, offered as a signature appearance). */
  signature?: boolean;
}

export interface ShapeObject extends Base {
  kind: 'shape';
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  stroke: Color | null;
  fill: Color | null;
  strokeWidth: number;
  /** For line/arrow: endpoints relative to rect (0..1). */
  from?: Point;
  to?: Point;
}

export interface InkObject extends Base {
  kind: 'ink';
  /** Strokes in coordinates relative to rect origin (view units). */
  paths: Point[][];
  color: Color;
  width: number;
}

export interface WhiteoutObject extends Base {
  kind: 'whiteout';
  color: Color;
}

export interface MarkObject extends Base {
  kind: 'mark';
  mark: 'check' | 'cross' | 'dot';
  color: Color;
}

export interface MarkupObject extends Base {
  kind: 'highlight' | 'underline' | 'strikeout';
  /** One rect per text line run, view units. `rect` is their bounding box. */
  quads: Rect[];
  color: Color;
  /** The text that was selected (stored in the annotation /Contents). */
  text: string;
}

export interface NoteObject extends Base {
  kind: 'note';
  text: string;
  color: Color;
}

export type EditorObject =
  | TextObject
  | ImageObject
  | ShapeObject
  | InkObject
  | WhiteoutObject
  | MarkObject
  | MarkupObject
  | NoteObject;

export type ObjectKind = EditorObject['kind'];

export type ToolId =
  | 'select'
  | 'text'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'whiteout'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'check'
  | 'cross'
  | 'dot'
  | 'date'
  | 'signature';

export interface StoredImage {
  id: string;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  url: string; // object URL for display
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
