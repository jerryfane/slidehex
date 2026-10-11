import type { Deck } from './types.ts';
import { parseDeck, serializeDeck } from './model.ts';

const DRAFT_KEY = 'slidehex.draft.v1';

export function loadDraft(): Deck | null {
  const text = localStorage.getItem(DRAFT_KEY);
  return text === null ? null : parseDeck(text);
}

export function saveDraft(deck: Deck): void {
  localStorage.setItem(DRAFT_KEY, serializeDeck(deck));
}
