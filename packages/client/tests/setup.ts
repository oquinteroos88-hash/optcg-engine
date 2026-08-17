// Registers the TEST card set (import side effect) so getCardDef works in
// every suite.
import '@optcg/engine/testdata/decks';

/**
 * Every suite in this package runs in Spanish unless it says otherwise.
 *
 * Not the client's own default — `initialLocale()` reads `navigator.language`,
 * which jsdom reports as `en-US`. It is a choice about the suites: they were
 * written against the Spanish board, Spanish is the language this project
 * exists to add, and a suite that asserts on visible text has to assert in one
 * of them. `tests/i18n.test.ts` drives both explicitly and is where the default
 * detection itself is checked.
 *
 * Set through storage rather than through the store, so it is in place before
 * the store module is first imported: `locale` is initialised once, at
 * creation.
 */
globalThis.localStorage?.setItem('optcg.locale', 'es');

/**
 * Every suite runs on a landscape screen unless it says otherwise.
 *
 * jsdom does not implement `matchMedia` at all, and `useCondensedLayout` calls
 * it on every render — so without this the nine jsdom suites would throw on a
 * board. The default answer is "not portrait", which is the full sheet.
 *
 * Guarded, because this file also runs for the `node`-environment suites where
 * there is no `window` to hang it on — the same reason the line above uses
 * optional chaining. And it never replaces a stub a suite installed for itself:
 * see `tests/matchMedia.ts`, which is how a suite asks for the other layout.
 */
if (typeof globalThis.window !== 'undefined' && typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = ((query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof globalThis.matchMedia;
}
