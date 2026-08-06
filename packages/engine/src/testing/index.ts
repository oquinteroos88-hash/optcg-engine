import { deepStrictEqual } from 'node:assert';
import type { GameState } from '../types.js';

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
