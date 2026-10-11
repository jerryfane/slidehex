import { useEffect, useRef, useState } from 'react';
import type { Deck, DeckAction, ElementPatch, HistoryState, SlideElement } from './types';
import { createDeck, historyReducer, MAX_FILE_BYTES, parseDeck, serializeDeck } from './model';
import { loadDraft, saveDraft } from './storage';
import { SlideArtwork, SlideCanvas } from './SlideCanvas';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function NumberField({ label, value, onChange, min = -10000, max = 10000 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  function commit() {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next) && next >= min && next <= max) onChange(next);
    else setDraft(String(Math.round(value * 100) / 100));
  }
  return <label className="field">{label}<input type="number" aria-label={label} value={draft} min={min} max={max} step="any"
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

export default function App() {
  const [initial] = useState(() => {
    try { return { deck: loadDraft() ?? createDeck(), error: '' }; }
    catch (error) { return { deck: createDeck(), error: `Could not recover the local draft: ${messageOf(error)} The stored copy has not been overwritten. Open a saved file or explicitly resume local saving.` }; }
  });
  const [history, setHistory] = useState<HistoryState>({ past: [], present: initial.deck, future: [] });
  const deck = history.present;
  const [slideId, setSlideId] = useState(deck.slides[0].id);
  const slide = deck.slides.find(item => item.id === slideId) ?? deck.slides[0];
  const slideIndex = deck.slides.indexOf(slide);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = slide.elements.find(item => item.id === selectedId) ?? null;
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [draftPaused, setDraftPaused] = useState(Boolean(initial.error));
  const [saveStatus, setSaveStatus] = useState(initial.error ? 'Local saving paused' : 'Saving locally');
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const presentButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (draftPaused) return;
    try { saveDraft(deck); setSaveStatus('Saved in this browser'); }
    catch (cause) {
      setDraftPaused(true);
      setSaveStatus('Local saving unavailable');
      setError(`Local saving failed: ${messageOf(cause)} Your work is still open. Use Save file to keep a copy.`);
    }
  }, [deck, draftPaused]);

  useEffect(() => {
    if (selectedId && !slide.elements.some(item => item.id === selectedId)) setSelectedId(null);
  }, [slide, selectedId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draftPaused) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftPaused]);

  function edit(action: DeckAction): Deck {
    const next = historyReducer(history, { type: 'edit', action });
    setHistory(next);
    setNotice('');
    return next.present;
  }
  function patch(patch: ElementPatch, id = selected?.id) {
    if (id) edit({ type: 'updateElement', slideId: slide.id, elementId: id, patch });
  }
  function addElement(kind: SlideElement['kind']) {
    const next = edit({ type: 'addElement', slideId: slide.id, kind });
    const items = next.slides.find(item => item.id === slide.id)!.elements;
    setSelectedId(items.at(-1)?.id ?? null);
  }
  function addSlide() {
    const next = edit({ type: 'addSlide', afterId: slide.id });
    setSlideId(next.slides[Math.min(slideIndex + 1, next.slides.length - 1)].id);
    setSelectedId(null);
  }
  function duplicateSlide() {
    const next = edit({ type: 'duplicateSlide', slideId: slide.id });
    setSlideId(next.slides[Math.min(slideIndex + 1, next.slides.length - 1)].id);
    setSelectedId(null);
  }
  function removeSlide() {
    const next = edit({ type: 'removeSlide', slideId: slide.id });
    setSlideId(next.slides[Math.min(slideIndex, next.slides.length - 1)].id);
    setSelectedId(null);
  }
  function replace(next: Deck) {
    setHistory(historyReducer(history, { type: 'replace', deck: next }));
    setSlideId(next.slides[0].id);
    setSelectedId(null);
    setError('');
    setNotice('Presentation opened.');
  }
  function newDeck() {
    if (window.confirm('Start a new presentation? Save a file first if you want to keep the current one.')) {
      replace(createDeck());
      setNotice('New presentation created.');
    }
  }
  function download() {
    try {
      const blob = new Blob([serializeDeck(deck)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const name = deck.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 100) || 'presentation';
      link.href = url;
      link.download = `${name}.slidehex`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Native file download requested. Keep this file as your backup.');
    } catch (cause) { setError(`Could not save file: ${messageOf(cause)}`); }
  }
  async function openFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than the 5 MiB limit.');
      const next = parseDeck(await file.text());
      if (!window.confirm('Replace the current presentation with this file? Save the current one first if needed.')) return;
      replace(next);
    } catch (cause) { setError(`Could not open presentation: ${messageOf(cause)} Your current presentation is unchanged.`); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  function exitPresentation() {
    setPresenting(false);
    requestAnimationFrame(() => presentButton.current?.focus());
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (presenting) {
        if (event.key === 'Escape') { event.preventDefault(); exitPresentation(); }
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
          event.preventDefault(); setPresentIndex(value => Math.min(deck.slides.length - 1, value + 1));
        }
        if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
          event.preventDefault(); setPresentIndex(value => Math.max(0, value - 1));
        }
        if (event.key === 'Home') { event.preventDefault(); setPresentIndex(0); }
        if (event.key === 'End') { event.preventDefault(); setPresentIndex(deck.slides.length - 1); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); download(); return;
      }
      if (typing) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        setHistory(current => historyReducer(current, { type: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo' }));
      } else if (selected && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault(); edit({ type: 'removeElement', slideId: slide.id, elementId: selected.id });
      } else if (selected && modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault(); duplicateElement();
      } else if (event.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function duplicateElement() {
    if (!selected) return;
    const next = edit({ type: 'duplicateElement', slideId: slide.id, elementId: selected.id });
    const items = next.slides.find(item => item.id === slide.id)!.elements;
    const added = items.find(item => !slide.elements.some(before => before.id === item.id));
    setSelectedId(added?.id ?? null);
  }
  const selectedIndex = selected ? slide.elements.indexOf(selected) : -1;
  const slideTitle = (index: number) => {
    const firstText = deck.slides[index].elements.find(item => item.kind === 'text');
    return firstText?.kind === 'text' ? firstText.text.slice(0, 40) || 'Untitled slide' : 'Blank slide';
  };

  if (presenting) return <main className="presentation" aria-label="Presentation mode">
    <div className="presentation-art"><SlideArtwork slide={deck.slides[presentIndex]} /></div>
    <nav className="presentation-controls" aria-label="Presentation controls">
      <button disabled={presentIndex === 0} onClick={() => setPresentIndex(index => index - 1)}>Previous</button>
      <span role="status">Slide {presentIndex + 1} of {deck.slides.length}</span>
      <button disabled={presentIndex === deck.slides.length - 1} onClick={() => setPresentIndex(index => index + 1)}>Next</button>
      <button onClick={exitPresentation}>Exit presentation</button>
      <span className="key-hint">Arrow keys to navigate · Esc to exit</span>
    </nav>
  </main>;

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">S</span><span>Slide<span className="brand-accent">Hex</span></span></div>
      <div className="document-heading">
        <label className="sr-only" htmlFor="deck-title">Presentation title</label>
        <input id="deck-title" key={deck.title} defaultValue={deck.title} maxLength={200} onBlur={event => {
          const title = event.target.value.trim();
          if (title) edit({ type: 'rename', title }); else event.target.value = deck.title;
        }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <span className="save-status" role="status"><span className={draftPaused ? 'status-dot warning' : 'status-dot'} />{saveStatus}</span>
      </div>
      <div className="file-actions">
        <button onClick={newDeck}>New</button>
        <button onClick={() => fileInput.current?.click()}>Open file</button>
        <button onClick={download}>Save file</button>
        <button className="primary" ref={presentButton} onClick={() => { setPresentIndex(slideIndex); setPresenting(true); }}>Present</button>
      </div>
      <input className="sr-only" ref={fileInput} type="file" accept=".slidehex,.json,application/json" aria-label="Open native presentation" onChange={event => void openFile(event.target.files?.[0])} />
    </header>
    <div className="toolbar" role="toolbar" aria-label="Slide editing tools">
      <div className="tool-group"><button onClick={addSlide} disabled={deck.slides.length >= 200}>+ Slide</button></div>
      <div className="tool-group"><span className="toolbar-label">Insert</span>
        <button disabled={slide.elements.length >= 500} onClick={() => addElement('text')}>Text</button>
        <button disabled={slide.elements.length >= 500} onClick={() => addElement('rect')}>Rectangle</button>
        <button disabled={slide.elements.length >= 500} onClick={() => addElement('ellipse')}>Ellipse</button>
      </div>
      <div className="tool-group">
        <button disabled={!history.past.length} onClick={() => setHistory(current => historyReducer(current, { type: 'undo' }))}>Undo</button>
        <button disabled={!history.future.length} onClick={() => setHistory(current => historyReducer(current, { type: 'redo' }))}>Redo</button>
      </div>
      <span className="toolbar-note">Your slides. Your browser. Your files.</span>
    </div>
    {error && <div className="alert" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>Dismiss</button></div>}
    {draftPaused && <div className="recovery-bar"><span>Use Save file to keep a copy outside this browser.</span><button onClick={() => {
      if (window.confirm('Replace the stored local draft with the current presentation and resume local saving?')) { setDraftPaused(false); setError(''); }
    }}>Resume local saving</button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="workspace">
      <aside className="slide-panel" aria-label="Slides">
        <div className="panel-heading"><h2>Slides</h2><span className="count">{deck.slides.length}</span></div>
        <ol className="slide-list">{deck.slides.map((item, index) => <li key={item.id}>
          <button className={`slide-card ${slide.id === item.id ? 'active' : ''}`} aria-label={`Select slide ${index + 1}`} aria-current={slide.id === item.id ? 'true' : undefined}
            onClick={() => { setSlideId(item.id); setSelectedId(null); }}>
            <span className="slide-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="slide-preview"><SlideArtwork slide={item} /></span>
            <span className="slide-caption">{slideTitle(index)}</span>
          </button>
        </li>)}</ol>
        <button className="add-slide" onClick={addSlide} disabled={deck.slides.length >= 200}>+ Add slide</button>
        <div className="slide-actions">
          <button onClick={duplicateSlide} disabled={deck.slides.length >= 200}>Duplicate slide</button>
          <div className="button-pair">
            <button disabled={slideIndex === 0} onClick={() => edit({ type: 'moveSlide', slideId: slide.id, delta: -1 })}>Move up</button>
            <button disabled={slideIndex === deck.slides.length - 1} onClick={() => edit({ type: 'moveSlide', slideId: slide.id, delta: 1 })}>Move down</button>
          </div>
          <button className="danger-text" disabled={deck.slides.length === 1} onClick={removeSlide}>Delete slide</button>
        </div>
      </aside>
      <main className="editor" aria-label="Slide editor">
        <div className="editor-heading"><div><span className="eyebrow">CANVAS</span><h1>Slide {String(slideIndex + 1).padStart(2, '0')}</h1></div><span className="format-badge">16:9 · 1280 × 720</span></div>
        <div className="stage">
          <SlideCanvas slide={slide} selectedId={selected?.id ?? null} onSelect={setSelectedId} onChange={(id, next) => patch(next, id)} onEditText={id => {
            setSelectedId(id); requestAnimationFrame(() => textInput.current?.focus());
          }} />
          {!slide.elements.length && <div className="empty-hint"><span className="empty-hex">S</span><h2>A blank slide. A new idea.</h2><p>Add text or a shape from the toolbar to begin.</p></div>}
        </div>
        <div className="canvas-footer"><span>{selected ? `${selected.kind === 'text' ? 'Text' : selected.kind === 'rect' ? 'Rectangle' : 'Ellipse'} selected` : 'Select an object to edit its properties'}</span><span>Drag to move · Corner handle to resize</span></div>
        <section className="workflow-note"><strong>Make something worth presenting.</strong><p>Start with a clear idea, add a few shapes, and make it yours. Save a native file to keep a portable copy.</p></section>
      </main>
      <aside className="inspector" aria-label="Properties">
        <div className="panel-heading"><h2>{selected ? 'Object properties' : 'Slide properties'}</h2><span className="inspector-tag">{selected?.kind ?? 'slide'}</span></div>
        {selected ? <>
          <section className="inspector-section"><h3>Position & size</h3><div className="field-grid">
            <NumberField label="X" value={selected.x} onChange={x => patch({ x })} />
            <NumberField label="Y" value={selected.y} onChange={y => patch({ y })} />
            <NumberField label="Width" value={selected.width} min={1} onChange={width => patch({ width })} />
            <NumberField label="Height" value={selected.height} min={1} onChange={height => patch({ height })} />
            <NumberField label="Rotation" value={selected.rotation} min={-360} max={360} onChange={rotation => patch({ rotation })} />
          </div></section>
          {selected.kind === 'text' ? <section className="inspector-section"><h3>Text</h3>
            <label className="field">Content<textarea ref={textInput} aria-label="Text content" value={selected.text} maxLength={20000} rows={5} onChange={event => patch({ text: event.target.value })} /></label>
            <label className="field">Font<select aria-label="Font family" value={selected.fontFamily} onChange={event => patch({ fontFamily: event.target.value as 'Arial' | 'Georgia' | 'Courier New' })}><option>Arial</option><option>Georgia</option><option>Courier New</option></select></label>
            <div className="field-grid"><NumberField label="Font size" value={selected.fontSize} min={1} max={300} onChange={fontSize => patch({ fontSize })} />
              <label className="field">Color<input type="color" aria-label="Text color" value={selected.color} onChange={event => patch({ color: event.target.value })} /></label></div>
            <div className="button-pair"><button aria-pressed={selected.bold} onClick={() => patch({ bold: !selected.bold })}>Bold</button>
              <select aria-label="Text alignment" value={selected.align} onChange={event => patch({ align: event.target.value as 'left' | 'center' | 'right' })}><option value="left">Align left</option><option value="center">Center</option><option value="right">Align right</option></select></div>
            <p className="field-help">Plain text with shared approximate wrapping. Rich text and exact font layout are tracked for 1.0.</p>
          </section> : <section className="inspector-section"><h3>Appearance</h3><div className="field-grid">
            <label className="field">Fill<input type="color" aria-label="Shape fill" value={selected.fill} onChange={event => patch({ fill: event.target.value })} /></label>
            <label className="field">Outline<input type="color" aria-label="Shape outline" value={selected.stroke} onChange={event => patch({ stroke: event.target.value })} /></label>
            <NumberField label="Outline width" value={selected.strokeWidth} min={0} max={100} onChange={strokeWidth => patch({ strokeWidth })} />
          </div></section>}
          <section className="inspector-section"><h3>Arrange</h3><div className="button-pair"><button disabled={selectedIndex === 0} onClick={() => edit({ type: 'reorderElement', slideId: slide.id, elementId: selected.id, delta: -1 })}>Send backward</button><button disabled={selectedIndex === slide.elements.length - 1} onClick={() => edit({ type: 'reorderElement', slideId: slide.id, elementId: selected.id, delta: 1 })}>Bring forward</button></div>
            <div className="button-pair"><button disabled={slide.elements.length >= 500} onClick={duplicateElement}>Duplicate object</button><button className="danger-text" onClick={() => edit({ type: 'removeElement', slideId: slide.id, elementId: selected.id })}>Delete object</button></div>
          </section>
        </> : <section className="inspector-section"><h3>Canvas</h3><label className="field">Background<input type="color" aria-label="Slide background" value={slide.background} onChange={event => edit({ type: 'setBackground', slideId: slide.id, color: event.target.value })} /></label><p className="field-help">Click an object on the slide or choose it below to change its text, size, position, and appearance.</p></section>}
        <section className="inspector-section"><h3>Objects <span className="count">{slide.elements.length}</span></h3>
          {slide.elements.length ? <ol className="object-list">{slide.elements.map((item, index) => <li key={item.id}><button aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span className="object-type">{item.kind === 'text' ? 'T' : item.kind === 'rect' ? 'R' : 'E'}</span><span>{item.kind === 'text' ? item.text || 'Empty text' : item.kind === 'rect' ? 'Rectangle' : 'Ellipse'}</span><small>{index + 1}</small></button></li>)}</ol> : <p className="field-help">No objects yet.</p>}
        </section>
      </aside>
    </div>
    <footer className="statusbar"><span>Slide {slideIndex + 1} of {deck.slides.length}</span><span>Native .slidehex files · Local-first</span><a href="https://github.com/jerryfane/slidehex/issues/1" target="_blank" rel="noreferrer">Follow the 1.0 roadmap</a></footer>
  </div>;
}
