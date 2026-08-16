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
