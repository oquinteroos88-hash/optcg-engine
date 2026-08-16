import { describe, expect, it } from 'vitest';
import { getAbilities, getCardDef, getPower, getPowerWithoutStatics, playerView } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { powerBreakdown } from '../src/store/selectors';
import { starterCorpusStates } from './corpus';

/**
 * Why a Character shows the power it shows.
 *
 * Continuous (`static`) abilities emit no events — the engine reads them at
 * lookup time and writes nothing — so no amount of log formatting can ever
 * explain one. A player watching a 5000 Character read 6000 has, in the phase 1
 * client, no way at all to find out why. The only source is the board itself.
 */

function fieldIds(state: GameState): InstanceId[] {
  const ids: InstanceId[] = [];
  for (const player of ['p1', 'p2'] as const) {
    const ps = state.players[player];
    ids.push(ps.leader, ...ps.characters);
    if (ps.stage !== null) {
      ids.push(ps.stage);
    }
  }
  return ids;
}

describe('the power breakdown', () => {
  const states = starterCorpusStates();

  it('adds up to the power the board shows, on every card of every state', () => {
    // The arithmetic is the claim: printed + DON!! + modifiers + statics is
    // exactly `getPower`. If it ever is not, the badge is lying.
    let checked = 0;
    for (const state of states) {
      for (const id of fieldIds(state)) {
        const parts = powerBreakdown(playerView(state, state.priority), id);
        expect(
          parts.printed + parts.fromDon + parts.fromModifiers + parts.fromStatics,
          `${id} in a corpus state`,
        ).toBe(getPower(state, id));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('separates the continuous part from everything written into the state', () => {
    // `getPower - getPowerWithoutStatics` is the engine's own definition of the
    // continuous contribution, and the only thing the client may call it.
    for (const state of states) {
      for (const id of fieldIds(state)) {
        expect(powerBreakdown(playerView(state, state.priority), id).fromStatics).toBe(
          getPower(state, id) - getPowerWithoutStatics(state, id),
        );
      }
    }
  });

  it('sees at least one card lifted by a continuous effect', () => {
    const lifted = states.some((state) =>
      fieldIds(state).some((id) => powerBreakdown(playerView(state, state.priority), id).fromStatics !== 0),
    );
    expect(lifted).toBe(true);
  });

  it('names the source whenever a static applies', () => {
    // Attribution is weaker than the amount by design: a `{self: true}` static
    // names its own card exactly, a selector-based one would need the engine's
    // internal resolveSelector. Every static in these two decks is
    // self-targeting, so today attribution is total — and the test below is
    // what makes a future foreign static visible instead of silently wrong.
    for (const state of states) {
      for (const id of fieldIds(state)) {
        const parts = powerBreakdown(playerView(state, state.priority), id);
        if (parts.fromStatics !== 0) {
          expect(parts.staticSources.length, `${id} lifted by nothing named`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has no foreign static in ST-01 or ST-02, which is why attribution holds', () => {
    const foreign: string[] = [];
    for (const state of states) {
      for (const id of fieldIds(state)) {
        const card = state.cards[id];
        if (card === undefined) {
          continue;
        }
        for (const ability of getAbilities(card.cardId)) {
          if (ability.trigger !== 'static' || ability.affects === undefined) {
            continue;
          }
          if (!('self' in ability.affects)) {
            foreign.push(`${card.cardId}:${ability.id}`);
          }
        }
      }
    }
    // Empty: Sanji, Urouge and ST01-013 all lift themselves. The day one of
    // these decks prints "all your {Straw Hat Crew} Characters get +1000", this
    // list is no longer empty and the badge starts saying "efecto continuo"
    // instead of naming a card — which is the honest fallback, not a bug.
    expect([...new Set(foreign)]).toEqual([]);
  });

  it('attributes a temporary power modifier to the card that granted it', () => {
    const withModifier = states.find((state) =>
      state.modifiers.some((modifier) => modifier.kind === 'power'),
    );
    expect(withModifier).toBeDefined();
    if (withModifier === undefined) {
      return;
    }
    const modifier = withModifier.modifiers.find((entry) => entry.kind === 'power');
    expect(modifier).toBeDefined();
    if (modifier === undefined || modifier.kind !== 'power') {
      return;
    }
    const parts = powerBreakdown(playerView(withModifier, withModifier.priority), modifier.target);
    expect(parts.fromModifiers).not.toBe(0);
    const sourceName = getCardDef(
      withModifier.cards[modifier.source]?.cardId ?? '',
    ).name;
    expect(parts.modifierSources).toContain(sourceName);
  });

  it('reports a granted keyword the card does not print', () => {
    // Sanji grants himself Rush. Printed keywords are not reported — the tile
    // already shows those — so anything here is something an effect did.
    const granted = new Set<string>();
    for (const state of states) {
      for (const id of fieldIds(state)) {
        for (const keyword of powerBreakdown(playerView(state, state.priority), id).grantedKeywords) {
          granted.add(keyword);
        }
      }
    }
    // Engine values, not printed names: the breakdown carries no language, and
    // `powerLinesOf` is where a keyword gets a name in one.
    expect([...granted]).toEqual(['rush']);
  });
});
