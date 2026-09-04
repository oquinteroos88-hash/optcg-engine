import { deepStrictEqual } from 'node:assert';
import type { GameState } from '../types.js';

/**
 * The shared random policy every driver consumes. Exported from here rather
 * than from the package root for the same reason as everything else in this
 * file: it is test infrastructure, and the browser client must not pull it.
 */
export {
  actionKey,
  actionTier,
  holdsDon,
  answerFor,
  cardinalityFor,
  chooseFrom,
  decide,
  isExcluded,
  pickByKey,
  rankCandidates,
  scoreFor,
} from './policy.js';

/**
 * The leak scanner both arbiters share — the engine's against `playerView`,
 * the server's against the wire. Each suite still derives its own list of
 * hidden instances; only the search is common. See `leaks.ts`.
 */
export { scanLeaks } from './leaks.js';

/**
 * Test-only helpers, deliberately kept out of the main barrel.
 *
 * These reach for Node builtins, and a bundler targeting the browser has none:
 * re-exporting them from `index.ts` made every consumer of the engine pull
 * `node:assert`, which forced a browser client to alias a shim just to load the
 * rules. Anything here is for tests and simulations, so it lives behind the
 * `@optcg/engine/testing` subpath instead.
 */

// JSON round-trip must be lossless. deepStrictEqual (unlike vitest toEqual)
// distinguishes { a: undefined } from {}, catching explicit undefined in state.
export function assertSerializationRoundTrip(state: GameState): void {
  deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
}
