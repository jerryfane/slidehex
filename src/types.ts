export interface Geometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export interface TextElement extends Geometry {
  kind: 'text';
  text: string;
  fontSize: number;
  fontFamily: 'Arial' | 'Georgia' | 'Courier New';
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}
export interface ShapeElement extends Geometry {
  kind: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
}
export type SlideElement = TextElement | ShapeElement;
export interface Slide { id: string; background: string; elements: SlideElement[] }
export interface Deck { format: 'slidehex'; version: 1; title: string; width: 1280; height: 720; slides: Slide[] }
export interface ElementPatch {
  x?: number; y?: number; width?: number; height?: number; rotation?: number;
  text?: string; fontSize?: number; fontFamily?: TextElement['fontFamily'];
  color?: string; bold?: boolean; align?: TextElement['align'];
  fill?: string; stroke?: string; strokeWidth?: number;
}
export type DeckAction =
  | { type: 'rename'; title: string }
  | { type: 'addSlide'; afterId?: string }
  | { type: 'duplicateSlide'; slideId: string }
  | { type: 'removeSlide'; slideId: string }
  | { type: 'moveSlide'; slideId: string; delta: -1 | 1 }
  | { type: 'setBackground'; slideId: string; color: string }
  | { type: 'addElement'; slideId: string; kind: SlideElement['kind'] }
  | { type: 'updateElement'; slideId: string; elementId: string; patch: ElementPatch }
  | { type: 'removeElement'; slideId: string; elementId: string }
  | { type: 'duplicateElement'; slideId: string; elementId: string }
  | { type: 'reorderElement'; slideId: string; elementId: string; delta: -1 | 1 };
export interface HistoryState { past: Deck[]; present: Deck; future: Deck[] }
export type HistoryAction =
  | { type: 'edit'; action: DeckAction }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'replace'; deck: Deck };
