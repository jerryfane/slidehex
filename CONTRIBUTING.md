# Contributing

Start from the [1.0 epic](https://github.com/jerryfane/slidehex/issues/1) and claim a focused linked issue. Keep implementation and acceptance evidence together.

## Local workflow

1. Use Node.js 24+ and `npm ci`.
2. Run `npm run dev` and exercise the affected workflow in a real browser.
3. Run `npm test` and `npm run build` before submitting a change.
4. Add regression tests for consumer-visible behavior, boundaries, history/data-loss bugs or unsafe imports—not copies of defaults, source strings or mocks of wiring.
5. Document the actual behavior, known limitations and any native format change.

Use strict TypeScript and immutable document updates. Keep artwork shared between editor/thumbnails/presentation. A drag should be one undo step. Never replace a current document before validating an import. Do not hide storage/export errors behind success messages.

Public fixtures must be original or appropriately licensed. Never commit credentials, account information, private decks, VM screenshots/configuration or proprietary application assets. Runtime-only smoke files belong outside the repository. Security issues should not include exploit payloads containing private data.

Changes are contributed under the repository's MIT license. There is no affiliation with Microsoft or Riot Games.
