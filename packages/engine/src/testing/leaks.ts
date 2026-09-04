import type { GameState, InstanceId, PlayerId } from '../types.js';

/**
 * The scanner both leak arbiters share.
 *
 * Two suites point the same instrument at two surfaces: the engine's
 * `informationLeak.test.ts` at `playerView`, the server's `wireLeak.test.ts`
 * at everything the session emits. Each computes for itself which instances
 * the viewer must not see — from the opposite side, the secret zones minus
 * the raw `knownBy` record, never through `visibility.ts` — and that
 * derivation stays in the suite on purpose: an arbiter that took its answer
 * from the code under test would pass a bug green. What is shared is only the
 * search: which quoted strings the JSON carries, which of them are forbidden,
 * and the three fields that never leave.
 *
 * The server suite used to carry a hand-ported copy of this (#44, extended
 * again in #49). One copy means the next surface gets the arbiter by import.
 */

const QUOTED = /"([^"]*)"/g;

/** Every quoted string in a JSON document. Ids travel as values, so a leaked
 * one shows up here whatever key it hangs from. */
function quotedStrings(json: string): Set<string> {
  const out = new Set<string>();
  for (const match of json.matchAll(QUOTED)) {
    out.add(match[1] as string);
  }
  return out;
}

/**
 * What `payload` shows `viewer` that it must not, given the instances the
 * caller decided are `unknown` to them. One line per finding; empty is clean.
 *
 * - An `InstanceId` in `unknown` is forbidden outright.
 * - Its `CardId` is forbidden only when no instance the viewer knows carries
 *   it: decks run four copies, and a copy face-up on the field makes the
 *   printed card no secret — the *instance* in the deck stays one.
 * - `rng`, `seed` and `matchId` are checked as field names rather than values:
 *   the rng (seed and cursor), and the match id that embeds the seed.
 */
export function scanLeaks(
  payload: unknown,
  viewer: PlayerId,
  unknown: readonly InstanceId[],
  cards: GameState['cards'],
): string[] {
  const unknownSet = new Set(unknown);
  const knownCardIds = new Set(
    Object.values(cards)
      .filter((card) => !unknownSet.has(card.instanceId))
      .map((card) => card.cardId),
  );

  const json = JSON.stringify(payload);
  const present = quotedStrings(json);
  const found: string[] = [];
  for (const id of unknown) {
    if (present.has(id)) {
      found.push(`${viewer} sees instance ${id}`);
    }
    const cardId = cards[id]?.cardId;
    if (cardId !== undefined && !knownCardIds.has(cardId) && present.has(cardId)) {
      found.push(`${viewer} sees printed card ${cardId} (only hidden copies exist)`);
    }
  }
  if (json.includes('"rng"') || json.includes('"seed"') || json.includes('"matchId"')) {
    found.push(`${viewer} sees the rng or the seed-bearing matchId`);
  }
  return found;
}
