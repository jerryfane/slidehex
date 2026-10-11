# Architecture

## Components

- `src/types.ts`: versioned document schema, typed editor actions and history state. Coordinates are logical slide units, independent of browser scale.
- `src/model.ts`: immutable document transformations, bounded undo/redo, native JSON parsing/serialization and import validation. No DOM or storage IO.
- `src/storage.ts`: one browser-local draft under `slidehex.draft.v1`. Errors propagate to the application; failed reads are not treated as successful recovery.
- `src/SlideCanvas.tsx`: shared SVG artwork for editor, thumbnails and presentation. Local pointer drafts become a single model edit on release; cancellation does not alter the document. Text is escaped React text, never HTML.
- `src/App.tsx`: document lifecycle, slide/object controls, inspector, keyboard commands, visible persistence errors and presentation navigation.

## Document invariants

A document has `format: "slidehex"`, `version: 1`, title, fixed 1280 × 720 dimensions and at least one slide. Slides have stable IDs, a six-digit hex background and ordered elements; array order is back-to-front. Text and shape elements share position, size and rotation. IDs are unique across all slides and elements. Duplicates receive independent IDs.

Imports are reconstructed from recognized fields and checked for format/version, resource bounds, finite numbers, valid enums/colors, unique IDs and supported element kinds. The application parses a file before asking to replace the current document. Future schema changes require deliberate migration/support policy rather than silently accepting unknown versions.

History stores structurally shared immutable snapshots, capped at 100 prior edits. A new edit drops abandoned redo history; no-op/invalid edits do not add history. Opening a different deck resets history. This is not a collaborative operation log.

## Rendering contract and limitations

SVG is shared, so selection handles never appear in presentation artwork. Pointer positions are mapped through the SVG screen matrix; rotated resize preserves the opposite corner. Text wrapping is deterministic but approximate, not browser-native rich-text layout or a PowerPoint layout engine. Font substitution, overflow and precision are work for the typography and interoperability issues.

No PDF/PPTX exporter exists in this increment. Future exports must reuse the same model and publish their support matrix; do not claim parity based on generic screenshots.

## Persistence boundaries

Local storage holds one draft, not a file library or durable backup. Native file download is explicit. A malformed existing draft pauses auto-save so its bytes are not immediately overwritten. Resuming local save requires confirmation. Quota/availability failures are surfaced; users can still download in-memory work. Multi-tab conflict handling and asset-backed IndexedDB recovery are tracked for 1.0.

No backend, credentials or network document transfer is part of the editor. Development and preview servers bind loopback by default. Do not embed or publish private reference-environment details.
