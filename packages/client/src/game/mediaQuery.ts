import { useSyncExternalStore } from 'react';

/**
 * A media query, as a value a render can read.
 *
 * `useSyncExternalStore` rather than an effect: the first paint must already be
 * the right answer, and an effect would paint the wrong one and correct it a
 * frame later. Subscribes, so rotating a device or changing a system setting
 * re-renders whatever asked.
 *
 * `false` where there is no `matchMedia` at all — jsdom without a stub, and any
 * non-browser environment a module here might be imported into. Both callers
 * are written so that `false` is the conservative answer: the full sheet, and
 * motion left on.
 */
export function useMediaQuery(query: string): boolean {
  const [subscribe, snapshot] = subscriptionFor(query);
  return useSyncExternalStore(subscribe, snapshot, alwaysFalse);
}

/**
 * One subscribe/snapshot pair per query string, cached.
 *
 * `useSyncExternalStore` re-subscribes whenever the function identity changes,
 * so building these inline would tear down and re-attach a listener on every
 * render. Queries are a fixed handful of constants, so the cache never grows.
 */
const cache = new Map<string, [(cb: () => void) => () => void, () => boolean]>();

function subscriptionFor(query: string): [(cb: () => void) => () => void, () => boolean] {
  const cached = cache.get(query);
  if (cached !== undefined) {
    return cached;
  }
  const list = (): MediaQueryList | null =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(query) : null;

  const pair: [(cb: () => void) => () => void, () => boolean] = [
    (onChange) => {
      const media = list();
      if (media === null) {
        return () => undefined;
      }
      media.addEventListener('change', onChange);
      return () => {
        media.removeEventListener('change', onChange);
      };
    },
    () => list()?.matches ?? false,
  ];
  cache.set(query, pair);
  return pair;
}

function alwaysFalse(): boolean {
  return false;
}

/** Drops the cached listeners. Tests swap `matchMedia` between cases. */
export function resetMediaQueries(): void {
  cache.clear();
}
