# Verification record — initial authoring increment

This record covers implementation issue [#2](https://github.com/jerryfane/slidehex/issues/2), not the full [1.0 release](https://github.com/jerryfane/slidehex/issues/1).

## Commands exercised

Node.js 24.21.0, npm 11.19.0, macOS arm64:

- `npm test`: 11 behavioral model regressions passed, zero failures. Coverage includes immutable edits, duplicate identity isolation, deletion/reordering boundaries, history branches/cap, serialization, invalid imports and resource limits.
- `npm run build`: TypeScript check and Vite production build completed successfully.

## Actual browser workflow exercised

An isolated desktop Chrome session ran the app at a 1440 × 1000 CSS-pixel viewport:

1. Renamed a new presentation; inserted multiline text; changed position, text size, bold style and element dimensions.
2. Added a rectangle, duplicated the slide, changed the second slide's text and added an ellipse.
3. Dragged the ellipse at a non-1:1 canvas scale. Observed document-coordinate movement consistent with the displayed scale.
4. Undid and redid the movement. Cancelled a subsequent drag with Escape; the stored document remained unchanged.
5. Rotated the ellipse 30 degrees through the inspector, resized it by pointer, and verified the opposite rotated corner stayed fixed while its dimensions changed.
6. Reordered slides and undid the reorder.
7. Downloaded a native file, reloaded the browser and observed exact document recovery.
8. Accepted New to create an empty one-slide deck, then opened the actual downloaded file and observed exact restoration of text, styles, fractional geometry and slide order.
9. Presented both slides, inspected both rendered views, navigated with ArrowRight and returned to editing with Escape.
10. Imported an unsupported-version file. The UI reported the error and the current stored presentation remained unchanged.
11. Deliberately placed malformed data in this isolated session's draft storage and reloaded. The app preserved those bytes, displayed a recovery error and paused auto-save. Opening the saved file and explicitly confirming Resume local saving restored the valid deck.
12. Observed zero uncaught page errors in the exercised session.

The original presentation used in this workflow is retained as [`examples/first-ideas.slidehex`](../examples/first-ideas.slidehex). [`editor.png`](editor.png) is an actual app screenshot, not a mockup or a screenshot of another product.

## Limits of this evidence

- No native PowerPoint compatibility or pixel-fidelity comparison has been performed for SlideHex.
- No PDF or PPTX path exists yet; those required release features remain tracked separately.
- This is not a multi-browser, screen-reader, mobile, storage-quota, multi-tab or performance certification. Those gates remain open in the release roadmap.
- The browser actions above are a runtime smoke check, not a permanent automated browser suite. CI currently covers the model regressions and production build; broader end-to-end CI is tracked in the release issue.
- Private reference VM files, screenshots and account data are not included in this repository.
