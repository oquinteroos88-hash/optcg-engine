import { PORTRAIT_QUERY } from '../src/game/layout';

/**
 * A `matchMedia` a suite can turn.
 *
 * jsdom has no layout engine and no media queries, so orientation has to be
 * something a test states rather than something it measures. This keeps the
 * listeners and dispatches a real `change`, so a suite that rotates the screen
 * after rendering exercises the subscription in `useCondensedLayout` and not
 * only its first read — which is the half that a stub returning a constant
 * would never touch.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let portrait = false;

function install(): void {
  globalThis.matchMedia = ((query: string): MediaQueryList =>
    ({
      get matches(): boolean {
        return query === PORTRAIT_QUERY ? portrait : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof globalThis.matchMedia;
}

/** Sets the orientation, and tells anything already subscribed. */
export function setViewport(orientation: 'landscape' | 'portrait'): void {
  install();
  portrait = orientation === 'portrait';
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Back to the landscape default, with no listeners left behind. */
export function resetViewport(): void {
  portrait = false;
  listeners.clear();
}
