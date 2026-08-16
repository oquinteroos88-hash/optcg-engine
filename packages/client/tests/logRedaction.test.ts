import { describe, expect, it } from 'vitest';
import { applyAction, playerView, redactEvent } from '@optcg/engine';
import type { GameEvent, GameState, PlayerId, ViewEvent } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { buildScenario } from '@optcg/engine/testdata/scenarios';
import { logEntries } from '../src/store/selectors';

/**
 * The event log under redaction.
 *
 * The client's formatter is an exhaustive switch with no `default`, and PR #45
 * is the second time that shape paid for itself: every case had to decide what
 * it reads as when the identity is **withheld** rather than absent. The rule
 * the answers follow is one sentence — *say the fact, never the face* — and
 * these are the cases where it was not obvious.
 *
 * What this file refuses is a line that invents something. A card the viewer
 * may not name reads as "una carta", which is what a face-down card looks like
 * at a table: it does not borrow a name, and it does not vanish.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** One event, redacted for a seat, as the line the board would draw. */
function lineFor(state: GameState, seat: PlayerId, event: GameEvent): string | null {
  const redacted = redactEvent(state, seat, event, new Set());
  if (redacted === null) {
    return null;
  }
  // Spanish: this file asserts on the sentences the board draws, and it has to
  // pick a language to assert in. The redaction it is really about is the same
  // in both — `tests/i18n.test.ts` renders the log in English too.
  return logEntries([redacted], playerView(state, seat), 'es')[0]?.text ?? '';
}

function mustLine(state: GameState, seat: PlayerId, event: GameEvent): string {
  const line = lineFor(state, seat, event);
  if (line === null) {
    throw new Error('expected the event to survive redaction');
  }
  return line;
}

describe('a log that may not name what it saw', () => {
  const state = buildScenario({ decks, p1: { activeDon: 3 }, p2: { activeDon: 3 } });

  it('reports the rival’s draw as a draw, and the owner’s by name', () => {
    const drawn = state.players.p1.hand[0];
    if (drawn === undefined) {
      throw new Error('expected a hand');
    }
    const event: GameEvent = { type: 'cardDrawn', player: 'p1', instanceId: drawn };
    // CR 4-5-1 draws "without revealing it to the other player".
    expect(mustLine(state, 'p2', event)).toBe('roba una carta');
    expect(mustLine(state, 'p1', event)).not.toBe('roba una carta');
    expect(mustLine(state, 'p1', event).startsWith('roba ')).toBe(true);
  });

  it('counts a look instead of listing it — CR 11-3-1', () => {
    const top = state.players.p1.deck.slice(0, 3);
    const event: GameEvent = { type: 'cardsLookedAt', player: 'p1', instanceIds: top };
    // The same sentence for both: the looker's ids are on their board, and the
    // line was always a count.
    for (const seat of ['p1', 'p2'] as const) {
      const line = mustLine(state, seat, event);
      expect(line).toBe('mira 3 cartas del tope de su mazo');
      for (const id of top) {
        expect(line).not.toContain(id);
      }
    }
  });

  it('gives a partition its two lengths and neither list', () => {
    const deck = state.players.p1.deck;
    const event: GameEvent = {
      type: 'deckPartitioned',
      player: 'p1',
      top: deck.slice(0, 2),
      bottom: deck.slice(2, 5),
    };
    for (const seat of ['p1', 'p2'] as const) {
      const line = mustLine(state, seat, event);
      expect(line).toBe('pone 2 cartas al tope y 3 al fondo de su mazo');
      for (const id of deck.slice(0, 5)) {
        expect(line).not.toContain(id);
      }
    }
  });

  it('names what a reveal still shows and counts what it no longer can', () => {
    const known = state.players.p1.leader;
    const hidden = state.players.p2.deck[0];
    if (hidden === undefined) {
      throw new Error('expected a deck');
    }
    const event: GameEvent = { type: 'cardsRevealed', player: 'p1', instanceIds: [known, hidden] };
    const line = mustLine(state, 'p1', event);
    expect(line.startsWith('revela ')).toBe(true);
    expect(line).toContain('1 carta');
    expect(line).not.toContain(hidden);
  });

  it('keeps a foreign prompt out of the line, because a prompt can name cards', () => {
    const event: GameEvent = {
      type: 'choiceOpened',
      player: 'p1',
      choiceId: 'c1',
      kind: 'selectCards',
      prompt: 'Trash 1 {Land of Wano} type card',
    };
    expect(mustLine(state, 'p1', event)).toContain('Land of Wano');
    expect(mustLine(state, 'p2', event)).toBe('debe elegir');
  });

  it('drops a foreign yes/no offer entirely — its existence is the tell', () => {
    // The engine only opens an opt-in when the hidden card *has* a trigger, so
    // a line saying "somebody was asked yes or no" would tell the rival what
    // the card is. The engine drops it; the log therefore has nothing to say.
    const event: GameEvent = {
      type: 'choiceOpened',
      player: 'p1',
      choiceId: 'c9',
      kind: 'yesNo',
      prompt: 'Activate ABIL-014-trigger?',
    };
    expect(lineFor(state, 'p2', event)).toBeNull();
    expect(lineFor(state, 'p1', event)).not.toBeNull();
  });

  it('says a card moved without naming it, rather than saying nothing', () => {
    const hidden = state.players.p2.hand[0];
    if (hidden === undefined) {
      throw new Error('expected a hand');
    }
    const event: GameEvent = { type: 'cardMoved', player: 'p2', instanceId: hidden, to: 'deck' };
    // p1 may not name it; the move still happened and the line still says so.
    expect(mustLine(state, 'p1', event)).toBe('mueve una carta a su mazo');
    expect(mustLine(state, 'p2', event)).not.toContain('una carta');
  });

  it('never leaves a line empty or borrowed, over real batches', () => {
    let live = state;
    for (const action of [
      { type: 'END_TURN' as const, player: 'p1' as const },
      { type: 'END_TURN' as const, player: 'p2' as const },
    ]) {
      const result = applyAction(live, action);
      if (!result.ok) {
        throw new Error(result.reason);
      }
      for (const seat of ['p1', 'p2'] as const) {
        const journal: ViewEvent[] = [];
        for (const event of result.events) {
          const redacted = redactEvent(result.state, seat, event, new Set());
          if (redacted !== null) {
            journal.push(redacted);
          }
        }
        const other = seat === 'p1' ? 'p2' : 'p1';
        const unknown = [
          ...result.state.players[other].hand,
          ...result.state.players.p1.deck,
          ...result.state.players.p2.deck,
        ].filter((id) => !(result.state.knownBy[id] ?? []).includes(seat));
        for (const entry of logEntries(journal, playerView(result.state, seat), 'es')) {
          expect(entry.text.length).toBeGreaterThan(0);
          for (const id of unknown) {
            expect(entry.text).not.toContain(id);
          }
        }
      }
      live = result.state;
    }
  });
});
