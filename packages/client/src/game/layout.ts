import { useSyncExternalStore } from 'react';

/**
 * Portrait, and narrow enough that two full mats cannot both be one.
 *
 * A phone held upright. Not a width alone: a short landscape window is a
 * cramped table and should stay a table, while a tall narrow one is a
 * different shape of problem and needs a different sheet.
 */
export const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 820px)';

/**
 * Whether the opponent's half should condense.
 *
 * The media query is evaluated here rather than in the stylesheet, and that is
 * deliberate. Condensing is not only a different template — the opponent's
 * piles stop being piles and become counters — so the answer has to be
 * available to the render, not just to the cascade. Asking once, in one place,
 * keeps the class and the markup from ever disagreeing about which sheet is on
 * screen; a `@media` block in the CSS plus a second one in JS would be two
 * sources for one fact.
 *
 * Subscribes, so rotating the device re-renders. `useSyncExternalStore` rather
 * than an effect: the first paint must already be the right layout, and an
 * effect would paint the wrong one and then correct it.
 */
export function useCondensedLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

function mediaQuery(): MediaQueryList | null {
  // jsdom has no `matchMedia` unless a suite installs one, and neither does
  // any non-browser environment this module might be imported into. Landscape
  // is the answer when nobody can say otherwise: it is the full sheet, and a
  // full sheet on a small screen scrolls rather than hides anything.
  return typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia(PORTRAIT_QUERY)
    : null;
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (query === null) {
    return () => undefined;
  }
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function snapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

function serverSnapshot(): boolean {
  return false;
}
