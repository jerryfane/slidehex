import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ElementPatch, Slide, SlideElement, TextElement } from './types';
import './canvas.css';

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const MIN_SIZE = 16;

type TextLayoutInput = Pick<TextElement, 'text' | 'width' | 'fontSize' | 'fontFamily' | 'bold'>;

// Stable font-width estimates keep wrapping identical in every SVG surface and export.
// No canvas measurement or installed-font state participates in the document layout.
function characterWidth(character: string, fontFamily: TextElement['fontFamily']): number {
  if (fontFamily === 'Courier New') return 0.61;
  if (/\s/u.test(character)) return 0.3;
  if (/[ilI.,'`!:;|]/u.test(character)) return 0.3;
  if (/[mwMW@%&]/u.test(character)) return 0.92;
  if (/[A-Z]/u.test(character)) return 0.72;
  if ((character.codePointAt(0) ?? 0) > 0x2ff) return 1;
  return fontFamily === 'Georgia' ? 0.6 : 0.57;
}

export function wrapText(element: TextLayoutInput): string[] {
  const availableWidth = Math.max(1, element.width);
  const fontSize = Math.max(1, element.fontSize);
  const weight = element.bold ? 1.06 : 1;
  const measure = (text: string) => Array.from(text).reduce(
    (width, character) => width + characterWidth(character, element.fontFamily) * fontSize * weight,
    0,
  );
  const lines: string[] = [];

  for (const paragraph of element.text.replace(/\r\n?/gu, '\n').split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    let lineWidth = 0;
    for (const word of paragraph.trim().split(/\s+/u)) {
      const wordWidth = measure(word);
      const spaceWidth = line ? measure(' ') : 0;
      if (line && lineWidth + spaceWidth + wordWidth <= availableWidth) {
        line += ` ${word}`;
        lineWidth += spaceWidth + wordWidth;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      lineWidth = 0;
      // Unbroken URLs and long words must wrap too, without losing characters.
      for (const character of Array.from(word)) {
        const width = measure(character);
        if (line && lineWidth + width > availableWidth) {
          lines.push(line);
          line = '';
          lineWidth = 0;
        }
        line += character;
        lineWidth += width;
      }
    }
    lines.push(line);
  }
  return lines;
}

function elementName(element: SlideElement): string {
  if (element.kind === 'text') {
    const excerpt = element.text.replace(/\s+/gu, ' ').trim().slice(0, 64);
    return excerpt ? `Text: ${excerpt}` : 'Empty text';
  }
  return element.kind === 'rect' ? 'Rectangle' : 'Ellipse';
}

function elementTransform(element: SlideElement): string {
  return `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`;
}

function ElementArtwork({ element }: { element: SlideElement }) {
  if (element.kind === 'text') {
    const x = element.x + (element.align === 'center' ? element.width / 2 : element.align === 'right' ? element.width : 0);
    return (
      <text
        fill={element.color}
        fontFamily={element.fontFamily}
        fontSize={element.fontSize}
        fontWeight={element.bold ? 700 : 400}
        textAnchor={element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start'}
      >
        {wrapText(element).map((line, index) => (
          <tspan key={index} x={x} y={element.y + element.fontSize + index * element.fontSize * 1.2}>
            {line || '\u00a0'}
          </tspan>
        ))}
      </text>
    );
  }
  const paint = { fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth };
  return element.kind === 'ellipse' ? (
    <ellipse cx={element.x + element.width / 2} cy={element.y + element.height / 2} rx={element.width / 2} ry={element.height / 2} {...paint} />
  ) : (
    <rect x={element.x} y={element.y} width={element.width} height={element.height} {...paint} />
  );
}

export function SlideArtwork({ slide, className }: { slide: Slide; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
      className={`artwork-slide${className ? ` ${className}` : ''}`}
      role="img"
      aria-label="Slide artwork"
    >
      <rect width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={slide.background || '#ffffff'} />
      {slide.elements.map((element) => (
        <g key={element.id} data-element-id={element.id} transform={elementTransform(element)}>
          <title>{elementName(element)}</title>
          <ElementArtwork element={element} />
        </g>
      ))}
    </svg>
  );
}

interface SlideCanvasProps {
  slide: Slide;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: ElementPatch) => void;
  onEditText?: (id: string) => void;
}

type Point = { x: number; y: number };
type GeometryPatch = Pick<SlideElement, 'x' | 'y' | 'width' | 'height'>;
interface Interaction {
  pointerId: number;
  slideId: string;
  element: SlideElement;
  mode: 'move' | 'resize';
  start: Point;
}
interface Draft {
  slideId: string;
  elementId: string;
  patch: GeometryPatch;
}

function geometryPatch(interaction: Interaction, point: Point): GeometryPatch {
  const { element, start, mode } = interaction;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (mode === 'move') {
    return { x: element.x + dx, y: element.y + dy, width: element.width, height: element.height };
  }
  const radians = element.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const width = Math.max(MIN_SIZE, element.width + dx * cos + dy * sin);
  const height = Math.max(MIN_SIZE, element.height - dx * sin + dy * cos);
  const dw = width - element.width;
  const dh = height - element.height;
  // Move the center along the rotated local axes, keeping the opposite corner fixed.
  return {
    x: element.x + (dw * cos - dh * sin - dw) / 2,
    y: element.y + (dw * sin + dh * cos - dh) / 2,
    width,
    height,
  };
}

export function SlideCanvas({ slide, selectedId, onSelect, onChange, onEditText }: SlideCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const captureRef = useRef<SVGElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const endInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    setDraft(null);
    const target = captureRef.current;
    captureRef.current = null;
    if (interaction && target?.hasPointerCapture(interaction.pointerId)) {
      target.releasePointerCapture(interaction.pointerId);
    }
  }, []);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !interactionRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      endInteraction();
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => window.removeEventListener('keydown', cancelOnEscape, true);
  }, [endInteraction]);

  useEffect(() => {
    const interaction = interactionRef.current;
    if (interaction && (
      interaction.slideId !== slide.id ||
      interaction.element.id !== selectedId ||
      !slide.elements.includes(interaction.element)
    )) endInteraction();
  }, [slide, selectedId, endInteraction]);

  function logicalPoint(event: ReactPointerEvent<SVGElement>): Point | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function startInteraction(event: ReactPointerEvent<SVGElement>, element: SlideElement, mode: Interaction['mode']) {
    if (event.button !== 0 || !event.isPrimary || interactionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const start = logicalPoint(event);
    if (!start) return;
    onSelect(element.id);
    event.currentTarget.focus();
    interactionRef.current = { pointerId: event.pointerId, slideId: slide.id, element, mode, start };
    captureRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveInteraction(event: ReactPointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = logicalPoint(event);
    if (point) setDraft({ slideId: slide.id, elementId: interaction.element.id, patch: geometryPatch(interaction, point) });
  }

  function commitInteraction(event: ReactPointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = logicalPoint(event);
    const patch = point ? geometryPatch(interaction, point) : null;
    endInteraction();
    if (patch && (Object.keys(patch) as (keyof GeometryPatch)[]).some((key) => Math.abs(patch[key] - interaction.element[key]) > 0.001)) {
      onChange(interaction.element.id, patch);
    }
  }

  function objectKeyDown(event: ReactKeyboardEvent<SVGElement>, element: SlideElement) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onSelect(element.id);
      if (event.key === 'Enter' && selectedId === element.id && element.kind === 'text') onEditText?.(element.id);
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (interactionRef.current) return;
      const step = event.shiftKey ? 10 : 1;
      onSelect(element.id);
      onChange(element.id, {
        x: element.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
        y: element.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
      });
    }
  }

  const activeDraft = draft?.slideId === slide.id ? draft : null;
  const displaySlide: Slide = activeDraft ? {
    ...slide,
    elements: slide.elements.map((element) => element.id === activeDraft.elementId ? { ...element, ...activeDraft.patch } : element),
  } : slide;
  const selected = displaySlide.elements.find((element) => element.id === selectedId);

  return (
    <div className="canvas-container" role="group" aria-label="Slide editor">
      <SlideArtwork slide={displaySlide} className="canvas-artwork" />
      <svg
        ref={svgRef}
        className="canvas-interactions"
        viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
        aria-label="Slide objects"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || interactionRef.current) return;
          event.stopPropagation();
          onSelect(null);
        }}
        onPointerMove={moveInteraction}
        onPointerUp={commitInteraction}
        onPointerCancel={(event) => {
          if (interactionRef.current?.pointerId !== event.pointerId) return;
          event.stopPropagation();
          endInteraction();
        }}
        onLostPointerCapture={(event) => {
          if (interactionRef.current?.pointerId === event.pointerId) endInteraction();
        }}
      >
        {displaySlide.elements.map((element) => (
          <g key={element.id} transform={elementTransform(element)}>
            <rect
              className="canvas-object-target"
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              tabIndex={0}
              role="button"
              aria-label={elementName(element)}
              aria-pressed={selectedId === element.id}
              onPointerDown={(event) => startInteraction(event, slide.elements.find((item) => item.id === element.id) ?? element, 'move')}
              onKeyDown={(event) => objectKeyDown(event, element)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (element.kind === 'text') onEditText?.(element.id);
              }}
            />
          </g>
        ))}
        {selected && (
          <g transform={elementTransform(selected)}>
            <rect
              className="canvas-selection"
              x={selected.x}
              y={selected.y}
              width={selected.width}
              height={selected.height}
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
            <rect
              className="canvas-resize-handle"
              x={selected.x + selected.width - 10}
              y={selected.y + selected.height - 10}
              width={20}
              height={20}
              vectorEffect="non-scaling-stroke"
              tabIndex={0}
              role="button"
              aria-label={`Resize ${elementName(selected)}. Use arrow keys to resize; Shift for larger steps.`}
              onPointerDown={(event) => startInteraction(event, slide.elements.find((element) => element.id === selected.id) ?? selected, 'resize')}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                if (interactionRef.current) return;
                const step = event.shiftKey ? 10 : 1;
                const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
                const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
                const radians = selected.rotation * Math.PI / 180;
                onChange(selected.id, geometryPatch(
                  { pointerId: 0, slideId: slide.id, element: selected, mode: 'resize', start: { x: 0, y: 0 } },
                  { x: dx * Math.cos(radians) - dy * Math.sin(radians), y: dx * Math.sin(radians) + dy * Math.cos(radians) },
                ));
              }}
            />
          </g>
        )}
      </svg>
      <span className="canvas-accessible-status" role="status" aria-live="polite">
        {selected ? `Selected ${elementName(selected)}` : 'No object selected'}
      </span>
    </div>
  );
}
