import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, getAbilities, getPower, legalActions } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { englishCards, registerEnglishCards, ST01_DECK, ST02_DECK } from '../src/index.js';
import { answer, applyOk, op01CrocodileScenario, run, starterScenario } from './support.js';

registerEnglishCards();

/**
 * The batch that closed the starter decks bar one card, and the ruling that
 * eventually wrote that card too.
 *
 * Three cards were left when every other row in both inventories had been
 * built. Two of them were one union member each — a duration and a condition —
 * and are here. The third, `ST02-010` Basil Hawkins, stayed declared for five
 * batches under PR #35's ruling and is now written; the ruling section at the
 * bottom is the record of what it fixed and the milestone guard reads **34 of
 * 34**.
 *
 * Every claim below is read off the Comprehensive Rules v1.2.0. The official
 * per-card Q&A could not be used: it is rendered client-side and the HTML the
 * page serves contains none of it, which is the same wall PR #31 hit and
 * recorded.
 */

// The printed keyword lines carry their reminder text — "[Blocker] (After your
// opponent declares an attack, …)" — so this anchors at the start only, exactly
// as `op01Decks.test.ts`'s filler guard does.
const KEYWORD_ONLY = /^\[(Blocker|Rush|Banish|Double Attack)\]/;

function cardText(cardId: string): string {
  const card = englishCards.find((entry) => entry.cardId === cardId);
  if (card === undefined) {
    throw new Error(`no such card ${cardId}`);
  }
  return [card.effectText, card.triggerText].filter(Boolean).join(' || ');
}

// ---------------------------------------------------------------------------
// OP01-085 Mr.3(Galdino) — the duration
// ---------------------------------------------------------------------------

describe('OP01-085 Mr.3(Galdino) — a prohibition that outlives the turn', () => {
  /** Mr.3 in hand, one cost-4 enemy Character to point at, under Crocodile. */
  function setup(): { state: GameState; mr3: InstanceId; victim: InstanceId } {
    const state = op01CrocodileScenario({
      turn: 3,
      p1: { activeDon: 4, hand: ['OP01-085'] },
      p2: { characters: [{ cardId: 'OP01-066' }] }, // Krieg, vanilla, cost 4
    });
    const hand = state.players.p1.hand;
    const mr3 = hand.filter((id) => state.cards[id]?.cardId === 'OP01-085').at(-1);
    const victim = state.players.p2.characters[0];
    if (mr3 === undefined || victim === undefined) {
      throw new Error('scenario did not stage Mr.3 and a victim');
    }
    return { state, mr3, victim };
  }

  function play(): { state: GameState; victim: InstanceId } {
    const { state, mr3, victim } = setup();
    const played = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: mr3 }).state;
    const settled = answer(played, 'p1', { kind: 'cards', selected: [victim] });
    return { state: settled, victim };
  }

  function endTurn(state: GameState): GameState {
    const next = applyOk(state, { type: 'END_TURN', player: state.activePlayer }).state;
    assertInvariants(next);
    return next;
  }

  it('writes one rule, with the spanning duration and its controller', () => {
    const { state, victim } = play();
    const rules = state.legality.filter((rule) => rule.duration === 'endOfOpponentNextTurn');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.effect).toBe('forbid');
    expect(rules[0]?.clause).toEqual({ question: 'attack' });
    expect(rules[0]?.subject).toEqual({ is: victim });
    // The two fields the duration needed. `controller` is p1's because CR
    // 6-6-1-2 clause (2) processes the **non-turn player's** expiries, and this
    // rule has to survive until p1 is that player.
    expect(rules[0]?.controller).toBe('p1');
    expect(rules[0]?.writtenOnTurn).toBe(state.turn);
  });

  it('survives its own End Phase and the whole of the opponent\'s turn', () => {
    const { state } = play();
    const live = (s: GameState): boolean =>
      s.legality.some((rule) => rule.duration === 'endOfOpponentNextTurn');

    const opponentTurn = endTurn(state);
    expect(opponentTurn.activePlayer).toBe('p2');
    expect(live(opponentTurn)).toBe(true);

    const backToUs = endTurn(opponentTurn);
    expect(backToUs.activePlayer).toBe('p1');
    expect(live(backToUs)).toBe(false);
  });

  it('is what the old duration could not buy: the Character cannot attack on its own turn', () => {
    // **The whole point of the card and of the duration.** An `endOfTurn` rule
    // aimed at an opponent's Character expires in the End Phase of the turn it
    // was written in (CR 6-6-1-2), which is before that Character has had a turn
    // in which to attack — so the printed sentence would have described nothing.
    const { state, victim } = play();
    const opponentTurn = endTurn(state);

    const offers = legalActions(opponentTurn, 'p2')
      .filter((action) => action.type === 'DECLARE_ATTACK')
      .map((action) => (action.type === 'DECLARE_ATTACK' ? action.attacker : ''));
    expect(offers).not.toContain(victim);
    // The Leader is still free, so the refusal is the rule's and not the
    // position's — CR 7-1-1-1 rests "their active Leader card or 1 active
    // Character card", and only one of the two is named by the rule.
    expect(offers).toContain(opponentTurn.players.p2.leader);

    const refused = applyAction(opponentTurn, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: victim,
      target: opponentTurn.players.p1.leader,
    });
    expect(refused.ok).toBe(false);
  });

  it('carries the printed {Baroque Works} gate as its condition', () => {
    // The gate is asserted as a shape rather than played out under a second
    // Leader, and the reason is a fixture limit worth naming: Mr.3 lives only in
    // the Crocodile deck, and Crocodile is the fixture Leader that *has* the
    // type. The failing side of `leaderHasType` is already exercised by
    // `OP01-079` in `op01Batch3.test.ts`, on the same helper.
    expect(getAbilities('OP01-085')[0]?.condition).toEqual({
      kind: 'countCards',
      selector: { zone: 'field', owner: 'you', category: ['leader'], types: ['Baroque Works'] },
      min: 1,
    });
  });

  it('writes nothing when the "up to 1" is answered with nothing', () => {
    // Rule 1 of the interpreter, and the reason `subject: { cards: … }` is the
    // right shape: a prohibition with no card to hang on is a no-op, not a rule
    // with an empty subject.
    const { state, mr3 } = setup();
    const played = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: mr3 }).state;
    const settled = answer(played, 'p1', { kind: 'cards', selected: [] });
    expect(settled.legality).toEqual([]);
    expect(settled.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ST02-014 X.Drake — the condition, and the timing that was not a trap
// ---------------------------------------------------------------------------

describe('ST02-014 X.Drake — "if this Character is rested"', () => {
  /**
   * **The timing question the brief warned about, answered by the card text.**
   *
   * The worry was that a `[When Attacking]` trigger asking about its own
   * orientation would be trivially constant, because CR 7-1-1-1 rests the
   * attacker *as part of* declaring — "the turn player declares their attack by
   * resting their active Leader card or 1 active Character card" — and CR
   * 7-1-1-3 activates `[When Attacking]` only after that. An attacking card is
   * always rested by the time its own trigger looks.
   *
   * X.Drake is not that card. It carries **no activation-timing marker at all**,
   * and CR 8-1-3-3-1 puts every effect that "based on the card text, cannot be
   * classified as auto, activate, or replacement effects" into the permanent
   * category. So it is read continuously and its conditions are re-asked every
   * time the board is (CR 8-1-3-3-2: "Some permanent effects require the
   * fulfillment of conditions for their effect to be valid").
   *
   * That inverts the worry into the card's whole design: the same fact — an
   * attack rests the attacker — is what **switches the buff on**, mid-battle,
   * for every {Supernovas} or {Navy} card X.Drake's controller has, itself
   * included.
   */
  function board(orientation: 'active' | 'rested', don: number, mine = true): GameState {
    const side = {
      activeDon: 4,
      characters: [
        { cardId: 'ST02-014', orientation, attachedDon: don },
        { cardId: 'ST02-005' }, // Killer, {Supernovas}
        { cardId: 'ST02-006' }, // Koby, {Navy}
      ],
    };
    // `buildScenario` seats `activePlayer` at `firstPlayer` regardless of the
    // turn number, so whose turn it is has to be said rather than counted.
    return mine
      ? starterScenario({ turn: 3, firstPlayer: 'p1', p2: side })
      : starterScenario({ turn: 4, firstPlayer: 'p2', p2: side });
  }

  function powers(state: GameState): { drake: number; killer: number; koby: number } {
    const [drake, killer, koby] = state.players.p2.characters;
    if (drake === undefined || killer === undefined || koby === undefined) {
      throw new Error('scenario did not stage the three bodies');
    }
    return {
      drake: getPower(state, drake),
      killer: getPower(state, killer),
      koby: getPower(state, koby),
    };
  }

  it('grants nothing while the source is active', () => {
    // p2's turn, one DON!! attached, X.Drake standing up: two of the three
    // conditions hold and the orientation clause does not.
    const state = board('active', 1, false);
    expect(state.activePlayer).toBe('p2');
    const { drake, killer, koby } = powers(state);
    expect(drake).toBe(5000 + 1000); // printed 5000, +1000 for the given DON!!
    expect(killer).toBe(3000);
    expect(koby).toBe(6000);
  });

  it('grants +1000 to itself and every {Supernovas} or {Navy} card once rested', () => {
    const state = board('rested', 1, false);
    const { drake, killer, koby } = powers(state);
    expect(drake).toBe(5000 + 1000 + 1000);
    expect(killer).toBe(3000 + 1000);
    expect(koby).toBe(6000 + 1000);
  });

  it('is off on the opponent\'s turn, and off without the DON!!', () => {
    // The other two printed conditions, each failing on its own. `[Your Turn]`
    // is a condition and not a timing (CR 8-3-2-4, CR 10-2-11-1: "a condition
    // that is satisfied during your turn"), which is why it sits beside the
    // orientation clause rather than in a trigger name.
    const wrongTurn = board('rested', 1, true);
    expect(wrongTurn.activePlayer).toBe('p1');
    expect(powers(wrongTurn).killer).toBe(3000);

    const noDon = board('rested', 0, false);
    expect(powers(noDon).killer).toBe(3000);
  });

  it('switches on mid-battle, because attacking is what rests it', () => {
    // The behavioural form of the timing answer. Nothing is staged rested here:
    // X.Drake stands up, declares, and CR 7-1-1-1's rest turns its own static on
    // for the rest of the turn — including for the attack it is making.
    const state = board('active', 1, false);
    const [drake, killer] = state.players.p2.characters;
    if (drake === undefined || killer === undefined) {
      throw new Error('scenario did not stage X.Drake');
    }
    expect(getPower(state, killer)).toBe(3000);

    const attacked = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: drake,
      target: state.players.p1.leader,
    }).state;

    expect(attacked.cards[drake]?.orientation).toBe('rested');
    expect(getPower(attacked, killer)).toBe(3000 + 1000);
    // And X.Drake is swinging at 7000 rather than 6000, which is the buff
    // applying to the card that opened it.
    expect(getPower(attacked, drake)).toBe(5000 + 1000 + 1000);
  });

  it('is read, not fired: it emits no abilityTriggered', () => {
    // A `static` has no event, which is why the manifestation corpus affirms it
    // by reading the board instead. Asserted here so nobody looks for it in a
    // log and concludes the card is broken.
    const state = board('rested', 1, false);
    expect(state.log.some((event) => event.type === 'abilityTriggered')).toBe(false);
    expect(getAbilities('ST02-014')[0]?.trigger).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// ST02-010 Basil Hawkins — the ruling
// ---------------------------------------------------------------------------

describe('ST02-010 Basil Hawkins — the ruling, and the card it finally wrote', () => {
  /**
   * "[DON!! x1] [Once Per Turn] [Your Turn] If this Character battles your
   * opponent's Character, set this card as active."
   *
   * The last card of both inventories, one of 2665 whose text matches "if this
   * Character battles", and the canonical case for the standard the original
   * inventory set: **for one card, anything it needs that does not exist is a
   * declared row, not a mechanism.**
   *
   * The pending question was whether blocking counts. It does not, and by rule
   * rather than by inference:
   *
   * - CR 8-3-2-4: "Conditions may be specified using [Your Turn]. This condition
   *   is met **during your turn**." CR 10-2-11-1 says it again as a keyword.
   * - CR 7-1-2-1: "**The player being attacked** can activate the [Blocker]
   *   effect of their card only once during that battle." Blocking is the
   *   non-turn player's act, so `[Your Turn]` is unmet whenever Hawkins blocks.
   *
   * So the card is "attacks, and the battle is against a Character" — and that
   * is what it still cannot be written as. Two things are missing, not one:
   *
   * 1. **The moment.** Hawkins carries no activation-timing marker; CR 8-1-3-1-1
   *    lists them and it has none. CR 8-3-1-8 admits a prose timing ("text such
   *    as 'when…'"), and Hawkins says "If". The moment it names is the battle,
   *    and the engine's nearest timings are CR 7-1-1-3's `[When Attacking]` (at
   *    declaration) and the blocker's `[On Block]`. Neither is "this card is in
   *    a battle".
   * 2. **The question.** "your opponent's **Character**" has to inspect the
   *    battle's current target, and `Condition` cannot see the battle at all.
   *
   * And the cheap approximation is not merely approximate, it is **wrong**:
   * CR 7-1-2-2 makes a blocker the new target of the attack, so a card that
   * declared against the Leader can end up battling a Character. Reading the
   * card as `[When Attacking]` would miss that case and would set Hawkins active
   * before the battle it names had happened.
   *
   * **The ruling stood; the arithmetic under it moved.** Two new capabilities
   * for one card in 2665 was the right price while a queue of blocked cards was
   * waiting behind them. The queue is empty, so the row is built — and it turned
   * out to be **one** capability rather than two: `whenBattling` is the moment,
   * and the question the ruling said `Condition` could not ask is
   * `Condition.varMatches` over the trigger's seed, built for `OP01-063` Arlong
   * a PR later and never revisited here. Every finding above survives into the
   * script; nothing in it was re-derived. The behaviour is in
   * `tests/lastFour.test.ts`, which owns the four cards that closed both sets.
   */
  it('is written, and every clause of the ruling is in the script', () => {
    const [ability] = getAbilities('ST02-010');
    expect(cardText('ST02-010')).toContain('If this Character battles');
    // The moment: the battle, not the declaration. `[When Attacking]` is the
    // reading the ruling rejected as wrong, so seeing it here would be the
    // regression this line exists to catch.
    expect(ability?.trigger).toBe('whenBattling');
    // `[Once Per Turn]`, and `[DON!! x1]` + `[Your Turn]` + "your opponent's
    // Character" as three conjuncts. The turn clause is what the ruling used to
    // settle the blocking half, and it is a condition rather than a firing-site
    // rule so that the card carries its own exclusion.
    expect(ability?.oncePerTurn).toBe(true);
    expect(JSON.stringify(ability?.condition)).toContain('isYourTurn');
  });

  it('has [Your Turn] printed, which is what settles the blocking half', () => {
    // The ruling's evidence, pinned to the text rather than to a comment: if a
    // reprint ever drops the marker, this goes red and the ruling is re-opened.
    expect(cardText('ST02-010')).toContain('[Your Turn]');
  });

  it('is alone in the whole set, which is why it waited five batches', () => {
    const matches = englishCards.filter((card) =>
      /if this Character battles/i.test([card.effectText, card.triggerText].filter(Boolean).join(' ')),
    );
    expect(matches.map((card) => card.cardId)).toEqual(['ST02-010']);
  });
});

// ---------------------------------------------------------------------------
// The milestone
// ---------------------------------------------------------------------------

describe('the starter decks, card by card', () => {
  /**
   * **The closing guard of the starter campaign.**
   *
   * Every distinct card in ST-01 and ST-02 has to be one of three things: a card
   * with a script, a card whose whole text is a printed keyword the engine
   * applies, or a card with no text at all. Anything else is a card printing
   * something the engine does not execute, and the list of those is the
   * campaign's remaining debt.
   *
   * It is a guard rather than a report because the number only means something
   * if it cannot drift: a card added to a decklist, or an ability deleted, moves
   * it and fails here.
   */
  const DECLARED_UNWRITTEN: readonly string[] = [];

  function distinctStarterCards(): string[] {
    const ids: string[] = [];
    for (const deck of [ST01_DECK, ST02_DECK]) {
      for (const id of [deck.leader, ...deck.cards.map((entry) => entry.cardId)]) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  it('accounts for all 34, and leaves exactly the declared row unwritten', () => {
    const ids = distinctStarterCards();
    expect(ids).toHaveLength(34);

    const scripted: string[] = [];
    const keywordOnly: string[] = [];
    const noText: string[] = [];
    const unaccounted: string[] = [];

    for (const id of ids) {
      const card = englishCards.find((entry) => entry.cardId === id);
      expect(card, id).toBeDefined();
      if (card === undefined) continue;

      // '-' is the corpus's spelling of "no text", not a line of text.
      const lines = (card.effectText === '-' ? '' : (card.effectText ?? ''))
        .split('<br>')
        .map((line) => line.trim())
        .filter(Boolean);

      if (getAbilities(id).length > 0) {
        scripted.push(id);
      } else if (card.triggerText === null && lines.length > 0 && lines.every((line) => KEYWORD_ONLY.test(line))) {
        keywordOnly.push(id);
      } else if (card.triggerText === null && lines.length === 0) {
        noText.push(id);
      } else {
        unaccounted.push(id);
      }
    }

    // **Empty, and that is the milestone.** The list was `['ST02-010']` for five
    // batches and is now the only kind of debt list worth having: one that
    // reached zero rather than one that was redefined.
    expect(unaccounted).toEqual([...DECLARED_UNWRITTEN]);
    // 24 + 2 + 8 = 34. Written out so the shape of the deck is visible and a
    // card that quietly changes category is not absorbed by the total.
    expect(scripted).toHaveLength(24);
    expect(keywordOnly).toHaveLength(2);
    expect(noText).toHaveLength(8);
  });

  it('runs a real game of the two decks with every scripted card legal in it', () => {
    // The milestone stated as a game rather than as a count: the two printed
    // decks, dealt and played, with nothing in either of them the engine cannot
    // read. `game.test.ts` is where the abilities are watched firing; this is
    // the smaller claim that the decks are whole.
    const state = starterScenario({ turn: 3 });
    const settled = run(state);
    assertInvariants(settled);
    for (const id of distinctStarterCards()) {
      if (DECLARED_UNWRITTEN.includes(id as (typeof DECLARED_UNWRITTEN)[number])) continue;
      const card = englishCards.find((entry) => entry.cardId === id);
      const lines = (card?.effectText === '-' ? '' : (card?.effectText ?? ''))
        .split('<br>')
        .map((line) => line.trim())
        .filter(Boolean);
      const handled =
        getAbilities(id).length > 0 ||
        lines.length === 0 ||
        lines.every((line) => KEYWORD_ONLY.test(line));
      expect(handled, `${id}: ${card?.effectText ?? ''}`).toBe(true);
    }
  });
});
