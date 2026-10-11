import type { Deck, DeckAction, ElementPatch, HistoryAction, HistoryState, Slide, SlideElement } from './types.ts';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SLIDES = 200;
const MAX_ELEMENTS = 500;
const MAX_TEXT = 20_000;
const MAX_HISTORY = 100;
const COORDINATE_LIMIT = 10_000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const GEOMETRY_FIELDS = ['x', 'y', 'width', 'height', 'rotation'] as const;
const TEXT_FIELDS = [...GEOMETRY_FIELDS, 'text', 'fontSize', 'fontFamily', 'color', 'bold', 'align'] as const;
const SHAPE_FIELDS = [...GEOMETRY_FIELDS, 'fill', 'stroke', 'strokeWidth'] as const;

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

function isTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function validField(field: keyof ElementPatch, value: unknown): boolean {
  switch (field) {
    case 'x': case 'y': return inRange(value, -COORDINATE_LIMIT, COORDINATE_LIMIT);
    case 'width': case 'height': return inRange(value, 1, COORDINATE_LIMIT);
    case 'rotation': return inRange(value, -360, 360);
    case 'fontSize': return inRange(value, 1, 300);
    case 'strokeWidth': return inRange(value, 0, 100);
    case 'text': return typeof value === 'string' && value.length <= MAX_TEXT;
    case 'fontFamily': return value === 'Arial' || value === 'Georgia' || value === 'Courier New';
    case 'color': case 'fill': case 'stroke': return isColor(value);
    case 'bold': return typeof value === 'boolean';
    case 'align': return value === 'left' || value === 'center' || value === 'right';
  }
}

function blankSlide(): Slide {
  return { id: crypto.randomUUID(), background: '#ffffff', elements: [] };
}

export function createDeck(): Deck {
  return { format: 'slidehex', version: 1, title: 'Untitled presentation', width: 1280, height: 720, slides: [blankSlide()] };
}

function newElement(kind: SlideElement['kind']): SlideElement {
  const geometry = { id: crypto.randomUUID(), x: 400, y: 240, width: 480, height: 240, rotation: 0 };
  if (kind === 'text') {
    return { ...geometry, x: 280, y: 300, width: 720, height: 120, kind, text: 'Add your text', fontSize: 48, fontFamily: 'Arial', color: '#1f2937', bold: false, align: 'left' };
  }
  return { ...geometry, kind, fill: '#7c3aed', stroke: '#7c3aed', strokeWidth: 0 };
}

function patchElement(element: SlideElement, patch: ElementPatch): SlideElement {
  const fields = element.kind === 'text' ? TEXT_FIELDS : SHAPE_FIELDS;
  let changed = false;
  for (const field of fields) {
    if (!Object.hasOwn(patch, field)) continue;
    if (!validField(field, patch[field])) return element;
    if (patch[field] !== element[field as keyof SlideElement]) changed = true;
  }
  if (!changed) return element;
  // Copy only the fields that belong to this element kind; never import arbitrary patch keys.
  const next = { ...element };
  const values = next as unknown as Record<string, unknown>;
  for (const field of fields) {
    if (Object.hasOwn(patch, field)) values[field] = patch[field];
  }
  return next;
}

function replaceSlide(deck: Deck, index: number, slide: Slide): Deck {
  if (deck.slides[index] === slide) return deck;
  const slides = deck.slides.slice();
  slides[index] = slide;
  return { ...deck, slides };
}

export function updateDeck(deck: Deck, action: DeckAction): Deck {
  if (action.type === 'rename') {
    const title = action.title.trim();
    return isTitle(title) && title !== deck.title ? { ...deck, title } : deck;
  }
  if (action.type === 'addSlide') {
    if (deck.slides.length >= MAX_SLIDES) return deck;
    const after = action.afterId === undefined ? deck.slides.length - 1 : deck.slides.findIndex(slide => slide.id === action.afterId);
    if (after < 0) return deck;
    const slides = deck.slides.slice();
    slides.splice(after + 1, 0, blankSlide());
    return { ...deck, slides };
  }
  const index = deck.slides.findIndex(slide => slide.id === action.slideId);
  if (index < 0) return deck;
  const slide = deck.slides[index]!;
  switch (action.type) {
    case 'duplicateSlide': {
      if (deck.slides.length >= MAX_SLIDES) return deck;
      const copy = { ...slide, id: crypto.randomUUID(), elements: slide.elements.map(element => ({ ...element, id: crypto.randomUUID() })) };
      const slides = deck.slides.slice();
      slides.splice(index + 1, 0, copy);
      return { ...deck, slides };
    }
    case 'removeSlide': {
      if (deck.slides.length === 1) return deck;
      const slides = deck.slides.slice();
      slides.splice(index, 1);
      return { ...deck, slides };
    }
    case 'moveSlide': {
      const destination = index + action.delta;
      if ((action.delta !== -1 && action.delta !== 1) || destination < 0 || destination >= deck.slides.length) return deck;
      const slides = deck.slides.slice();
      slides[index] = slides[destination]!;
      slides[destination] = slide;
      return { ...deck, slides };
    }
    case 'setBackground':
      return isColor(action.color) && action.color !== slide.background ? replaceSlide(deck, index, { ...slide, background: action.color }) : deck;
    case 'addElement': {
      if (slide.elements.length >= MAX_ELEMENTS || !['text', 'rect', 'ellipse'].includes(action.kind)) return deck;
      return replaceSlide(deck, index, { ...slide, elements: [...slide.elements, newElement(action.kind)] });
    }
    case 'updateElement': {
      const elementIndex = slide.elements.findIndex(element => element.id === action.elementId);
      if (elementIndex < 0) return deck;
      const current = slide.elements[elementIndex]!;
      const next = patchElement(current, action.patch);
      if (next === current) return deck;
      const elements = slide.elements.slice();
      elements[elementIndex] = next;
      return replaceSlide(deck, index, { ...slide, elements });
    }
    case 'removeElement': case 'duplicateElement': case 'reorderElement': {
      const elementIndex = slide.elements.findIndex(element => element.id === action.elementId);
      if (elementIndex < 0) return deck;
      const element = slide.elements[elementIndex]!;
      if (action.type === 'duplicateElement' && slide.elements.length >= MAX_ELEMENTS) return deck;
      if (action.type === 'reorderElement' && ((action.delta !== -1 && action.delta !== 1) || elementIndex + action.delta < 0 || elementIndex + action.delta >= slide.elements.length)) return deck;
      const elements = slide.elements.slice();
      if (action.type === 'removeElement') elements.splice(elementIndex, 1);
      else if (action.type === 'duplicateElement') {
        elements.splice(elementIndex + 1, 0, { ...element, id: crypto.randomUUID(), x: Math.min(COORDINATE_LIMIT, element.x + 24), y: Math.min(COORDINATE_LIMIT, element.y + 24) });
      } else {
        const destination = elementIndex + action.delta;
        elements[elementIndex] = elements[destination]!;
        elements[destination] = element;
      }
      return replaceSlide(deck, index, { ...slide, elements });
    }
  }
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'replace':
      return state.present === action.deck && state.past.length === 0 && state.future.length === 0 ? state : { past: [], present: action.deck, future: [] };
    case 'edit': {
      const present = updateDeck(state.present, action.action);
      return present === state.present ? state : { past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present], present, future: [] };
    }
    case 'undo': {
      const present = state.past.at(-1);
      return present === undefined ? state : { past: state.past.slice(0, -1), present, future: [state.present, ...state.future.slice(0, MAX_HISTORY - 1)] };
    }
    case 'redo': {
      const present = state.future[0];
      return present === undefined ? state : { past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present], present, future: state.future.slice(1) };
    }
  }
}

function requireValue(condition: boolean, path: string, expectation: string): asserts condition {
  if (!condition) throw new Error(`Invalid SlideHex document: ${path} ${expectation}.`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  requireValue(typeof value === 'object' && value !== null && !Array.isArray(value), path, 'must be an object');
  return value as Record<string, unknown>;
}

function readId(value: unknown, path: string, ids: Set<string>): string {
  requireValue(typeof value === 'string' && ID.test(value), path, 'must be a 1–128 character identifier containing letters, digits, hyphens or underscores');
  requireValue(!ids.has(value as string), path, 'duplicates another slide or element ID');
  ids.add(value as string);
  return value as string;
}

function decodeElement(value: unknown, path: string, ids: Set<string>): SlideElement {
  const source = record(value, path);
  requireValue(source.kind === 'text' || source.kind === 'rect' || source.kind === 'ellipse', `${path}.kind`, 'must be text, rect or ellipse');
  const id = readId(source.id, `${path}.id`, ids);
  const fields = source.kind === 'text' ? TEXT_FIELDS : SHAPE_FIELDS;
  const result: Record<string, unknown> = { id, kind: source.kind };
  for (const field of fields) {
    requireValue(validField(field, source[field]), `${path}.${field}`, 'has a missing, invalid or out-of-range value');
    result[field] = source[field];
  }
  return result as unknown as SlideElement;
}

function decodeDeck(value: unknown): Deck {
  const source = record(value, 'document');
  requireValue(source.format === 'slidehex', 'format', 'must be "slidehex"');
  requireValue(source.version === 1, 'version', 'must be 1 (unsupported document version)');
  requireValue(source.width === 1280 && source.height === 720, 'dimensions', 'must be 1280 × 720');
  requireValue(isTitle(source.title), 'title', 'must be a nonblank string of at most 200 characters');
  requireValue(Array.isArray(source.slides) && source.slides.length > 0 && source.slides.length <= MAX_SLIDES, 'slides', `must contain 1–${MAX_SLIDES} slides`);
  const ids = new Set<string>();
  const slides = (source.slides as unknown[]).map((value, index): Slide => {
    const path = `slides[${index}]`;
    const slide = record(value, path);
    const id = readId(slide.id, `${path}.id`, ids);
    requireValue(isColor(slide.background), `${path}.background`, 'must be a six-digit hex color');
    requireValue(Array.isArray(slide.elements) && slide.elements.length <= MAX_ELEMENTS, `${path}.elements`, `must be an array with at most ${MAX_ELEMENTS} elements`);
    return { id, background: slide.background as string, elements: (slide.elements as unknown[]).map((element, index) => decodeElement(element, `${path}.elements[${index}]`, ids)) };
  });
  return { format: 'slidehex', version: 1, title: source.title as string, width: 1280, height: 720, slides };
}

function checkFileSize(text: string): void {
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    throw new Error('SlideHex document exceeds the 5 MiB file size limit.');
  }
}

export function parseDeck(text: string): Deck {
  checkFileSize(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Invalid SlideHex JSON: the file is not valid JSON.');
  }
  return decodeDeck(value);
}

export function serializeDeck(deck: Deck): string {
  const text = JSON.stringify(decodeDeck(deck), null, 2);
  checkFileSize(text);
  return text;
}
