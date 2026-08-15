import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/applyAction.js';
import { chooseAction } from '../src/bots/randomBot.js';
import { createGame } from '../src/createGame.js';
import { playerView } from '../src/playerView.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { GREEN_DECK, RED_DECK } from '../src/testdata/decks.js';
import type { GameState, InstanceId, PlayerId } from '../src/types.js';
import { PLAYER_IDS } from '../src/types.js';

/**
 * The leak test — the arbiter of the per-player layer.
 *
 * Over every state of a full sweep (every action of every game, both
 * players): `JSON.stringify(playerView(state, p))` contains, as a quoted
 * string, no `InstanceId` and no `CardId` of any card `p` does not know.
 *
 * **The list of unknown cards is computed here, from the opposite side** —
 * the secret zones minus the raw `knownBy` record — and never through
 * `visibility.ts`. That double origin is the point: if the view and the test
 * derived from the same function, a bug in the function would pass green.
 * This file reconstructs the right answer by the independent path:
 *
 * - the secret zones are both decks, both Life areas, and the *other*
 *   player's hand (CR 3-2-2, 3-10-2, 3-4-3), read straight off the arrays;
 * - a card in one of them is known to `p` only if the raw record lists `p`.
 *
 * A `CardId` is forbidden only when no instance the viewer knows carries it:
 * decks run four copies, and a copy face-up on the field makes the printed
 * card no secret — the *instance* in the deck stays one.
 */

const QUOTED = /"([^"]*)"/g;

function quotedStrings(json: string): Set<string> {
  const out = new Set<string>();
  for (const match of json.matchAll(QUOTED)) {
    out.add(match[1] as string);
  }
  return out;
}

function leaksIn(state: GameState, viewer: PlayerId): string[] {
  const other: PlayerId = viewer === 'p1' ? 'p2' : 'p1';
  const secret: InstanceId[] = [
    ...state.players.p1.deck,
    ...state.players.p2.deck,
    ...state.players.p1.life,
    ...state.players.p2.life,
    ...state.players[other].hand,
  ];
  const unknown = secret.filter((id) => !(state.knownBy[id]?.includes(viewer) ?? false));
  const unknownSet = new Set(unknown);
  const knownCardIds = new Set(
    Object.values(state.cards)
      .filter((card) => !unknownSet.has(card.instanceId))
      .map((card) => card.cardId),
  );

  const json = JSON.stringify(playerView(state, viewer));
  const present = quotedStrings(json);
  const found: string[] = [];
  for (const id of unknown) {
    if (present.has(id)) {
      found.push(`${viewer} sees instance ${id}`);
    }
    const cardId = state.cards[id]?.cardId;
    if (cardId !== undefined && !knownCardIds.has(cardId) && present.has(cardId)) {
      found.push(`${viewer} sees printed card ${cardId} (only hidden copies exist)`);
    }
  }
  // The three things that never leave, checked as fields rather than values:
  // the rng (seed and cursor), and the match id that embeds the seed.
  if (json.includes('"rng"') || json.includes('"seed"') || json.includes('"matchId"')) {
    found.push(`${viewer} sees the rng or the seed-bearing matchId`);
  }
  return found;
}

function sweep(seed: number, decks: 'vanilla' | 'abilities', leaks: string[]): void {
  const decklists =
    decks === 'abilities'
      ? { p1: ABIL_DECK, p2: ABIL_DECK }
      : { p1: RED_DECK, p2: GREEN_DECK };
  let state = createGame({ seed, decks: decklists, firstPlayer: 'p1' });
  let decision = 0;
  const check = (at: string): void => {
    for (const player of PLAYER_IDS) {
      for (const leak of leaksIn(state, player)) {
        leaks.push(`seed ${seed} (${decks}), ${at}: ${leak}`);
      }
    }
  };
  check('start');
  for (let step = 0; state.status !== 'finished' && step < 1_500; step += 1) {
    const action = chooseAction(state, state.priority, seed, decision);
    decision += 1;
    if (action === undefined) {
      throw new Error(`No legal action for ${state.priority} in a live game`);
    }
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`Sweep action rejected: ${result.reason}`);
    }
    state = result.state;
    check(`after action ${step} (${action.type})`);
  }
}

describe('the per-player view leaks nothing', () => {
  it('holds over every state of the ability sweep, both players', { timeout: 240_000 }, () => {
    const leaks: string[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      sweep(seed, 'abilities', leaks);
    }
    expect(leaks).toEqual([]);
  });

  it('holds over the vanilla sweep, where only draws and damage hide anything', { timeout: 120_000 }, () => {
    const leaks: string[] = [];
    for (let seed = 1; seed <= 6; seed += 1) {
      sweep(seed, 'vanilla', leaks);
    }
    expect(leaks).toEqual([]);
  });
});
