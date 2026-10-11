import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeck, historyReducer, MAX_FILE_BYTES, parseDeck, serializeDeck, updateDeck } from './model.ts';
import type { Deck, DeckAction, HistoryState } from './types.ts';

function populatedDeck(): Deck {
  let deck = createDeck();
  const slideId = deck.slides[0]!.id;
  for (const kind of ['text', 'rect', 'ellipse'] as const) deck = updateDeck(deck, { type: 'addElement', slideId, kind });
  return deck;
}

function freezeDeck(deck: Deck): Deck {
  for (const slide of deck.slides) {
    for (const element of slide.elements) Object.freeze(element);
    Object.freeze(slide.elements);
    Object.freeze(slide);
  }
  Object.freeze(deck.slides);
  return Object.freeze(deck);
}

test('edits copy only the changed path and never mutate frozen snapshots', () => {
  let deck = populatedDeck();
  deck = updateDeck(deck, { type: 'addSlide' });
  freezeDeck(deck);
  const slide = deck.slides[0]!;
  const element = slide.elements[0]!;
  const next = updateDeck(deck, { type: 'updateElement', slideId: slide.id, elementId: element.id, patch: { x: 42.5, text: 'Changed', bold: true } });
  assert.notEqual(next, deck);
  assert.notEqual(next.slides, deck.slides);
  assert.notEqual(next.slides[0], slide);
  assert.notEqual(next.slides[0]!.elements[0], element);
  assert.equal(next.slides[0]!.elements[1], slide.elements[1]);
  assert.equal(next.slides[1], deck.slides[1]);
  assert.equal(element.x, 280);
  assert.equal(next.slides[0]!.elements[0]!.x, 42.5);
  const renamed = updateDeck(next, { type: 'rename', title: '  Launch plan  ' });
  assert.equal(renamed.title, 'Launch plan');
  assert.equal(renamed.slides, next.slides);
  const colored = updateDeck(renamed, { type: 'setBackground', slideId: slide.id, color: '#123abc' });
  assert.equal(colored.slides[0]!.background, '#123abc');
  assert.equal(colored.slides[0]!.elements, renamed.slides[0]!.elements);
});

test('duplicate slides and elements use globally distinct IDs and isolate later edits', () => {
  const original = freezeDeck(populatedDeck());
  const slide = original.slides[0]!;
  let deck = updateDeck(original, { type: 'duplicateSlide', slideId: slide.id });
  const duplicate = deck.slides[1]!;
  assert.notEqual(duplicate.id, slide.id);
  assert.notEqual(duplicate.elements, slide.elements);
  duplicate.elements.forEach((element, index) => {
    assert.notEqual(element, slide.elements[index]);
    assert.notEqual(element.id, slide.elements[index]!.id);
    assert.deepEqual({ ...element, id: '' }, { ...slide.elements[index], id: '' });
  });
  const source = duplicate.elements[0]!;
  deck = updateDeck(deck, { type: 'duplicateElement', slideId: duplicate.id, elementId: source.id });
  const objectCopy = deck.slides[1]!.elements[1]!;
  assert.equal(objectCopy.x, source.x + 24);
  assert.equal(objectCopy.y, source.y + 24);
  const ids = deck.slides.flatMap(slide => [slide.id, ...slide.elements.map(element => element.id)]);
  assert.equal(new Set(ids).size, ids.length);
  deck = updateDeck(deck, { type: 'updateElement', slideId: duplicate.id, elementId: objectCopy.id, patch: { text: 'Only the copy', x: 100 } });
  assert.equal(deck.slides[0], slide);
  assert.equal(deck.slides[1]!.elements[0], source);
  assert.notEqual(deck.slides[1]!.elements[1], objectCopy);
  assert.deepEqual(parseDeck(serializeDeck(deck)), deck);
});

test('slide insertion, movement and deletion honor missing IDs and last-slide boundaries', () => {
  const first = freezeDeck(createDeck());
  const firstId = first.slides[0]!.id;
  assert.equal(updateDeck(first, { type: 'removeSlide', slideId: firstId }), first);
  assert.equal(updateDeck(first, { type: 'moveSlide', slideId: firstId, delta: -1 }), first);
  assert.equal(updateDeck(first, { type: 'moveSlide', slideId: firstId, delta: 1 }), first);
  assert.equal(updateDeck(first, { type: 'addSlide', afterId: 'missing' }), first);
  let deck = updateDeck(first, { type: 'addSlide' });
  const last = deck.slides[1]!;
  deck = updateDeck(deck, { type: 'addSlide', afterId: firstId });
  const middle = deck.slides[1]!;
  assert.equal(deck.slides[2], last);
  deck = updateDeck(deck, { type: 'moveSlide', slideId: middle.id, delta: -1 });
  assert.deepEqual(deck.slides.map(slide => slide.id), [middle.id, firstId, last.id]);
  deck = updateDeck(deck, { type: 'moveSlide', slideId: middle.id, delta: 1 });
  assert.deepEqual(deck.slides.map(slide => slide.id), [firstId, middle.id, last.id]);
  deck = updateDeck(deck, { type: 'removeSlide', slideId: middle.id });
  assert.deepEqual(deck.slides.map(slide => slide.id), [firstId, last.id]);
  assert.equal(updateDeck(deck, { type: 'removeSlide', slideId: 'missing' }), deck);
  assert.equal(first.slides.length, 1);
});

test('element layer reordering and deletion preserve identity at boundaries', () => {
  const original = freezeDeck(populatedDeck());
  const slide = original.slides[0]!;
  const [text, rect, ellipse] = slide.elements;
  assert.equal(updateDeck(original, { type: 'reorderElement', slideId: slide.id, elementId: text!.id, delta: -1 }), original);
  assert.equal(updateDeck(original, { type: 'reorderElement', slideId: slide.id, elementId: ellipse!.id, delta: 1 }), original);
  let deck = updateDeck(original, { type: 'reorderElement', slideId: slide.id, elementId: text!.id, delta: 1 });
  assert.deepEqual(deck.slides[0]!.elements, [rect, text, ellipse]);
  deck = updateDeck(deck, { type: 'reorderElement', slideId: slide.id, elementId: text!.id, delta: -1 });
  assert.deepEqual(deck.slides[0]!.elements, slide.elements);
  for (const element of slide.elements) deck = updateDeck(deck, { type: 'removeElement', slideId: slide.id, elementId: element.id });
  assert.deepEqual(deck.slides[0]!.elements, []);
  assert.equal(updateDeck(deck, { type: 'removeElement', slideId: slide.id, elementId: text!.id }), deck);
});

test('invalid and unchanged edits reuse the complete document reference', () => {
  const deck = freezeDeck(populatedDeck());
  const slideId = deck.slides[0]!.id;
  const elementId = deck.slides[0]!.elements[0]!.id;
  const actions: DeckAction[] = [
    { type: 'rename', title: deck.title },
    { type: 'rename', title: '   ' },
    { type: 'rename', title: 'x'.repeat(201) },
    { type: 'setBackground', slideId, color: '#ffffff' },
    { type: 'setBackground', slideId, color: 'url(https://example.com)' },
    { type: 'addElement', slideId: 'missing', kind: 'text' },
    { type: 'duplicateSlide', slideId: 'missing' },
    { type: 'duplicateElement', slideId, elementId: 'missing' },
    { type: 'updateElement', slideId, elementId: 'missing', patch: { x: 10 } },
    { type: 'updateElement', slideId, elementId, patch: {} },
    { type: 'updateElement', slideId, elementId, patch: { x: 280 } },
    { type: 'updateElement', slideId, elementId, patch: { x: NaN } },
    { type: 'updateElement', slideId, elementId, patch: { y: Infinity } },
    { type: 'updateElement', slideId, elementId, patch: { width: 0 } },
    { type: 'updateElement', slideId, elementId, patch: { height: -1 } },
    { type: 'updateElement', slideId, elementId, patch: { x: 10_001 } },
    { type: 'updateElement', slideId, elementId, patch: { rotation: 361 } },
    { type: 'updateElement', slideId, elementId, patch: { fontSize: 0 } },
    { type: 'updateElement', slideId, elementId, patch: { text: 'x'.repeat(20_001) } },
    { type: 'updateElement', slideId, elementId, patch: { x: 42, color: 'red' } },
    { type: 'updateElement', slideId, elementId, patch: { fill: '#abcdef' } },
  ];
  for (const action of actions) assert.equal(updateDeck(deck, action), deck, JSON.stringify(action).slice(0, 120));
});

test('history supports undo/redo, retains redo after no-ops, and drops abandoned branches', () => {
  const original = createDeck();
  let state: HistoryState = { past: [], present: original, future: [] };
  assert.equal(historyReducer(state, { type: 'undo' }), state);
  assert.equal(historyReducer(state, { type: 'redo' }), state);
  state = historyReducer(state, { type: 'edit', action: { type: 'rename', title: 'First' } });
  const first = state.present;
  state = historyReducer(state, { type: 'edit', action: { type: 'addSlide' } });
  const second = state.present;
  state = historyReducer(state, { type: 'undo' });
  assert.equal(state.present, first);
  assert.deepEqual(state.future, [second]);
  assert.equal(historyReducer(state, { type: 'edit', action: { type: 'rename', title: 'First' } }), state);
  state = historyReducer(state, { type: 'redo' });
  assert.equal(state.present, second);
  state = historyReducer(state, { type: 'undo' });
  state = historyReducer(state, { type: 'edit', action: { type: 'rename', title: 'New branch' } });
  assert.deepEqual(state.future, []);
  assert.deepEqual(state.past, [original, first]);
  assert.equal(historyReducer(state, { type: 'redo' }), state);
  state = historyReducer(state, { type: 'replace', deck: original });
  assert.deepEqual(state, { past: [], present: original, future: [] });
  assert.equal(historyReducer(state, { type: 'undo' }), state);
});

test('history keeps at most 100 prior edits through repeated undo and redo', () => {
  let state: HistoryState = { past: [], present: createDeck(), future: [] };
  for (let i = 1; i <= 105; i++) state = historyReducer(state, { type: 'edit', action: { type: 'rename', title: `Edition ${i}` } });
  assert.equal(state.past.length, 100);
  for (let i = 0; i < 100; i++) state = historyReducer(state, { type: 'undo' });
  assert.equal(state.present.title, 'Edition 5');
  assert.equal(state.future.length, 100);
  assert.equal(historyReducer(state, { type: 'undo' }), state);
  for (let i = 0; i < 100; i++) state = historyReducer(state, { type: 'redo' });
  assert.equal(state.present.title, 'Edition 105');
  assert.equal(state.past.length, 100);
  assert.equal(state.future.length, 0);
});

test('native serialization preserves fractional geometry, negative positions and every element style', () => {
  let deck = populatedDeck();
  const slide = deck.slides[0]!;
  deck = updateDeck(deck, { type: 'updateElement', slideId: slide.id, elementId: slide.elements[0]!.id, patch: { x: -45.125, y: 22.75, width: 631.5, height: 105.25, rotation: -27.5, text: 'Hello\n世界 <script>literal text</script>', fontSize: 51.5, fontFamily: 'Georgia', color: '#Ab12Ef', bold: true, align: 'right' } });
  for (const shape of slide.elements.slice(1)) deck = updateDeck(deck, { type: 'updateElement', slideId: slide.id, elementId: shape.id, patch: { x: 810.5, y: -10.25, width: 111.75, height: 331.125, rotation: 180, fill: '#112233', stroke: '#abcdef', strokeWidth: 4.5 } });
  freezeDeck(deck);
  const restored = parseDeck(serializeDeck(deck));
  assert.deepEqual(restored, deck);
  assert.notEqual(restored.slides[0], deck.slides[0]);
  assert.notEqual(restored.slides[0]!.elements[0], deck.slides[0]!.elements[0]);
  restored.slides[0]!.elements[0]!.x = 999;
  assert.equal(deck.slides[0]!.elements[0]!.x, -45.125);
});

test('imports reject malformed headers, empty slides, duplicate IDs and invalid element content', () => {
  const deck = populatedDeck();
  const slide = deck.slides[0]!;
  const element = slide.elements[0]!;
  const invalidDocuments: unknown[] = [
    null, [], {}, { ...deck, format: 'other' }, { ...deck, version: 2 },
    { ...deck, version: '1' }, { ...deck, width: 1920 }, { ...deck, height: 1080 },
    { ...deck, title: '' }, { ...deck, title: '  ' }, { ...deck, title: 'x'.repeat(201) },
    { ...deck, slides: [] }, { ...deck, slides: null }, { ...deck, slides: [null] },
    { ...deck, slides: [slide, slide] },
    { ...deck, slides: [{ ...slide, id: '../unsafe' }] },
    { ...deck, slides: [{ ...slide, background: 'red' }] },
    { ...deck, slides: [{ ...slide, elements: null }] },
    { ...deck, slides: [{ ...slide, elements: [element, element] }] },
    { ...deck, slides: [{ ...slide, elements: [{ ...element, id: slide.id }] }] },
    { ...deck, slides: [slide, { ...slide, id: 'distinct-slide' }] },
    { ...deck, slides: [{ ...slide, elements: [null] }] },
  ];
  const invalidFields: Array<[string, unknown]> = [
    ['kind', 'iframe'], ['id', ''], ['x', null], ['x', '10'], ['x', 10_001],
    ['y', -10_001], ['width', 0], ['height', -2], ['height', 10_001],
    ['rotation', 361], ['fontSize', 301], ['fontSize', 0],
    ['fontFamily', 'url(https://example.com/font)'], ['color', '#fff'],
    ['color', 'javascript:alert(1)'], ['bold', 'true'], ['align', 'justify'],
    ['text', 12], ['text', 'x'.repeat(20_001)], ['text', undefined],
  ];
  for (const [field, value] of invalidFields) invalidDocuments.push({ ...deck, slides: [{ ...slide, elements: [{ ...element, [field]: value }] }] });
  for (const shape of slide.elements.slice(1)) {
    for (const [field, value] of [['strokeWidth', -1], ['strokeWidth', 101], ['fill', 'transparent'], ['stroke', 'url(x)']] as const) invalidDocuments.push({ ...deck, slides: [{ ...slide, elements: [{ ...shape, [field]: value }] }] });
  }
  for (const invalid of invalidDocuments) assert.throws(() => parseDeck(JSON.stringify(invalid)), /Invalid SlideHex document:/);
  assert.throws(() => parseDeck('{broken'), /not valid JSON/);
  assert.throws(() => parseDeck(serializeDeck(deck).replace('"x": 280', '"x": 1e999')), /slides\[0\]\.elements\[0\]\.x/);
  assert.equal(deck.slides[0]!.elements.length, 3);
});

test('imports reconstruct known fields without retaining arbitrary or prototype payloads', () => {
  const deck = populatedDeck();
  const slide = deck.slides[0]!;
  const unsafe = JSON.stringify({ ...deck, html: '<script>ignored</script>', slides: [{ ...slide, onclick: 'bad()', elements: slide.elements.map(element => ({ ...element, src: 'https://example.com', style: { position: 'fixed' } })) }] });
  const parsed = parseDeck(unsafe.replace('"format":', '"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"format":'));
  assert.deepEqual(parsed, deck);
  assert.equal(Object.hasOwn(parsed, '__proto__'), false);
  assert.equal(Object.hasOwn(parsed, 'constructor'), false);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.equal(serializeDeck(parsed), serializeDeck(deck));
});

test('document size and content limits apply to import and export', () => {
  assert.throws(() => parseDeck(' '.repeat(MAX_FILE_BYTES + 1)), /5 MiB/);
  assert.throws(() => parseDeck('世'.repeat(Math.floor(MAX_FILE_BYTES / 3) + 1)), /5 MiB/);
  const deck = createDeck();
  const tooManySlides = { ...deck, slides: Array.from({ length: 201 }, (_, index) => ({ id: `slide-${index}`, background: '#ffffff', elements: [] })) };
  assert.throws(() => parseDeck(JSON.stringify(tooManySlides)), /slides must contain/);
  const populated = populatedDeck();
  const slide = populated.slides[0]!;
  const tooManyElements = { ...populated, slides: [{ ...slide, elements: Array.from({ length: 501 }, (_, index) => ({ ...slide.elements[0]!, id: `element-${index}` })) }] };
  assert.throws(() => parseDeck(JSON.stringify(tooManyElements)), /elements must be an array/);
  const invalid = { ...populated, slides: [{ ...slide, elements: [{ ...slide.elements[0]!, x: Infinity }] }] };
  assert.throws(() => serializeDeck(invalid), /\.x has a missing, invalid or out-of-range value/);
});
