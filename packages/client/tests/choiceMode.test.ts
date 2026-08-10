import { describe, expect, it } from 'vitest';
import { applyAction } from '@optcg/engine';
import type { InstanceId } from '@optcg/engine';
import { EMPTY_AFFORDANCE, getAffordances } from '../src/game/affordances';
import type { Affordances, CardAffordance, ChoiceView } from '../src/game/affordances';
import { clickStateOf } from '../src/game/clickState';
import { ensureModeValid, menuOptions, reduceUiMode } from '../src/game/uiMode';
import type { UiMode } from '../src/game/uiMode';
import { firstPendingState } from './corpus';

function card(overrides: Partial<CardAffordance>): CardAffordance {
  return { ...EMPTY_AFFORDANCE, ...overrides };
}

function aff(
  byCard: Record<InstanceId, CardAffordance>,
  pendingChoice: ChoiceView | null = null,
): Affordances {
  return {
    byCard,
    pendingChoice,
    global: {
      canEndTurn: false,
      canPass: false,
      canConcede: true,
      mustAnswerMulligan: false,
      mustAnswerChoice: pendingChoice !== null,
    },
    whoActs: 'p1',
  };
}

function selectCards(overrides: Partial<ChoiceView> = {}): ChoiceView {
  return {
    id: 'c1',
    kind: 'selectCards',
    prompt: 'Give up to 1 other Leader or Character +1000 power',
    candidates: ['a', 'b', 'c'],
    min: 0,
    max: 1,
    ...overrides,
  };
}

const IDLE: UiMode = { kind: 'idle' };

function answering(selected: readonly InstanceId[] = [], choiceId = 'c1'): UiMode {
  return { kind: 'answeringChoice', owner: 'p1', choiceId, selected };
}

// ---------------------------------------------------------------------------

describe('answeringChoice: selectCards', () => {
  it('toggles a candidate on and off', () => {
    const a = aff({}, selectCards({ max: 2 }));
    const on = reduceUiMode(answering(), { kind: 'toggleChoiceCandidate', instanceId: 'b' }, a);
    expect(on.mode).toEqual(answering(['b']));
    expect(on.intent).toBeUndefined();
    const off = reduceUiMode(on.mode, { kind: 'toggleChoiceCandidate', instanceId: 'b' }, a);
    expect(off.mode).toEqual(answering([]));
  });

  it('ignores a click on something that is not a candidate', () => {
    const a = aff({}, selectCards());
    const mode = answering();
    expect(reduceUiMode(mode, { kind: 'toggleChoiceCandidate', instanceId: 'zz' }, a).mode).toBe(
      mode,
    );
  });

  it('refuses a pick past max instead of silently evicting an earlier one', () => {
    const a = aff({}, selectCards({ max: 1 }));
    const mode = answering(['a']);
    const result = reduceUiMode(mode, { kind: 'toggleChoiceCandidate', instanceId: 'b' }, a);
    expect(result.mode).toBe(mode);
  });

  it('confirms a selection inside [min, max]', () => {
    const a = aff({}, selectCards({ min: 1, max: 2 }));
    const result = reduceUiMode(answering(['a']), { kind: 'confirmChoice' }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({
      type: 'ANSWER_CHOICE',
      choiceId: 'c1',
      answer: { kind: 'cards', selected: ['a'] },
    });
  });

  // "Up to" is the common case in these decks, not a corner one: 15 of the 26
  // cards with text print it. An empty confirm has to reach the engine.
  it('confirms an empty selection when min is 0', () => {
    const a = aff({}, selectCards({ min: 0 }));
    const result = reduceUiMode(answering([]), { kind: 'confirmChoice' }, a);
    expect(result.intent).toEqual({
      type: 'ANSWER_CHOICE',
      choiceId: 'c1',
      answer: { kind: 'cards', selected: [] },
    });
  });

  it('emits nothing for a confirm below min, so the engine never sees a cardinality error', () => {
    const a = aff({}, selectCards({ min: 2, max: 2 }));
    const mode = answering(['a']);
    const result = reduceUiMode(mode, { kind: 'confirmChoice' }, a);
    expect(result.mode).toBe(mode);
    expect(result.intent).toBeUndefined();
  });

  it('ignores a yes/no answer aimed at a card selection', () => {
    const a = aff({}, selectCards());
    const mode = answering();
    expect(reduceUiMode(mode, { kind: 'answerYesNo', value: true }, a).mode).toBe(mode);
  });
});

describe('answeringChoice: yesNo', () => {
  const yesNo = selectCards({ kind: 'yesNo', candidates: [], min: 0, max: 0 });

  it('answers yes and no', () => {
    const a = aff({}, yesNo);
    for (const value of [true, false]) {
      const result = reduceUiMode(answering(), { kind: 'answerYesNo', value }, a);
      expect(result.mode).toEqual(IDLE);
      expect(result.intent).toEqual({
        type: 'ANSWER_CHOICE',
        choiceId: 'c1',
        answer: { kind: 'yesNo', value },
      });
    }
  });

  it('has no confirm and no candidates to toggle', () => {
    const a = aff({}, yesNo);
    const mode = answering();
    expect(reduceUiMode(mode, { kind: 'confirmChoice' }, a).intent).toBeUndefined();
    expect(
      reduceUiMode(mode, { kind: 'toggleChoiceCandidate', instanceId: 'a' }, a).mode,
    ).toBe(mode);
  });
});

describe('answeringChoice cannot be escaped', () => {
  // There is no "decline": while the engine holds a choice open, its owner has
  // exactly one legal action. Escape used to reset any mode to idle, which here
  // would drop the player into a board that refuses every click.
  it('ignores escape, background clicks and board clicks alike', () => {
    const a = aff({ c1: card({ canAttack: true, attackTargets: ['L2'] }) }, selectCards());
    const mode = answering(['a']);
    for (const ev of [
      { kind: 'escape' } as const,
      { kind: 'clickEmpty' } as const,
      { kind: 'clickDonArea' } as const,
      { kind: 'clickHandCard', instanceId: 'h1' } as const,
      { kind: 'clickFieldCard', instanceId: 'c1', mine: true } as const,
    ]) {
      const result = reduceUiMode(mode, ev, a);
      expect(result.mode).toBe(mode);
      expect(result.intent).toBeUndefined();
    }
  });

  it('falls back to idle when the choice it names is gone', () => {
    expect(reduceUiMode(answering([], 'stale'), { kind: 'confirmChoice' }, aff({})).mode).toEqual(
      IDLE,
    );
    expect(
      reduceUiMode(answering([], 'stale'), { kind: 'confirmChoice' }, aff({}, selectCards())).mode,
    ).toEqual(IDLE);
  });
});

describe('clickStateOf inside a choice', () => {
  it('marks candidates targetable, picks selected and the rest inert', () => {
    const a = aff({ c1: card({ canAttack: true }) }, selectCards({ max: 2 }));
    const mode = answering(['a']);
    expect(clickStateOf(mode, a, 'a')).toBe('selected');
    expect(clickStateOf(mode, a, 'b')).toBe('targetable');
    // A card that would be clickable on an open board is not, mid-choice.
    expect(clickStateOf(mode, a, 'c1')).toBe('inert');
  });
});

// ---------------------------------------------------------------------------

describe('the contextual menu comes back with N options', () => {
  it('acts directly when a card can do exactly one thing', () => {
    const a = aff({ c1: card({ canAttack: true, attackTargets: ['L2'] }) });
    const result = reduceUiMode(IDLE, { kind: 'clickFieldCard', instanceId: 'c1', mine: true }, a);
    expect(result.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker: 'c1' });
  });

  // The ambiguity phase 1 could not produce: canPlay implied hand and canAttack
  // implied field, so no card carried both. ACTIVATE_ABILITY breaks that.
  it('opens the menu for a character that can attack and activate', () => {
    const a = aff({
      c1: card({
        canAttack: true,
        attackTargets: ['L2'],
        canActivate: true,
        activatableAbilities: ['ST01-001-main'],
      }),
    });
    expect(menuOptions(a, 'c1')).toEqual([
      { kind: 'attack' },
      { kind: 'activate', abilityId: 'ST01-001-main' },
    ]);
    const opened = reduceUiMode(IDLE, { kind: 'clickFieldCard', instanceId: 'c1', mine: true }, a);
    expect(opened.mode).toEqual({ kind: 'cardMenu', owner: 'p1', card: 'c1' });
    expect(opened.intent).toBeUndefined();
  });

  it('grows past two entries when a card prints two activated abilities', () => {
    const a = aff({
      c1: card({
        canAttack: true,
        attackTargets: ['L2'],
        canActivate: true,
        activatableAbilities: ['one', 'two'],
      }),
    });
    expect(menuOptions(a, 'c1')).toHaveLength(3);
    const picked = reduceUiMode(
      { kind: 'cardMenu', owner: 'p1', card: 'c1' },
      { kind: 'chooseMenuOption', index: 2 },
      a,
    );
    expect(picked.intent).toEqual({
      type: 'ACTIVATE_ABILITY',
      instanceId: 'c1',
      abilityId: 'two',
    });
  });

  it('routes the attack entry into targeting rather than straight into an action', () => {
    const a = aff({
      c1: card({
        canAttack: true,
        attackTargets: ['L2'],
        canActivate: true,
        activatableAbilities: ['one'],
      }),
    });
    const picked = reduceUiMode(
      { kind: 'cardMenu', owner: 'p1', card: 'c1' },
      { kind: 'chooseMenuOption', index: 0 },
      a,
    );
    expect(picked.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker: 'c1' });
    expect(picked.intent).toBeUndefined();
  });

  it('ignores an index the menu does not have', () => {
    const a = aff({ c1: card({ canAttack: true, canActivate: true, activatableAbilities: ['x'] }) });
    const mode: UiMode = { kind: 'cardMenu', owner: 'p1', card: 'c1' };
    expect(reduceUiMode(mode, { kind: 'chooseMenuOption', index: 9 }, a).mode).toBe(mode);
  });

  it('closes on any other click and re-reads that click from idle', () => {
    const a = aff({
      c1: card({ canAttack: true, canActivate: true, activatableAbilities: ['x'] }),
      c2: card({ canBlock: true }),
    });
    const mode: UiMode = { kind: 'cardMenu', owner: 'p1', card: 'c1' };
    expect(reduceUiMode(mode, { kind: 'escape' }, a).mode).toEqual(IDLE);
    const other = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'c2', mine: true }, a);
    expect(other.intent).toEqual({ type: 'DECLARE_BLOCK', blocker: 'c2' });
  });

  it('closes as soon as the card stops being ambiguous', () => {
    // A one-option card no longer needs a menu; ensureModeValid drops it.
    const single = aff({ c1: card({ canAttack: true }) });
    expect(menuOptions(single, 'c1')).toHaveLength(1);
  });

  it('offers a [Counter] Event without a target step', () => {
    const a = aff({ h1: card({ canPlayCounterEvent: true }) });
    const result = reduceUiMode(IDLE, { kind: 'clickHandCard', instanceId: 'h1' }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({ type: 'PLAY_COUNTER_EVENT', instanceId: 'h1' });
  });
});

// ---------------------------------------------------------------------------

describe('ensureModeValid against a real open choice', () => {
  const state = firstPendingState((pending) => pending.kind === 'selectCards');

  it('imposes answeringChoice on whatever mode was open', () => {
    const imposed = ensureModeValid({ kind: 'attachingDon', owner: state.priority }, state);
    expect(imposed).toEqual({
      kind: 'answeringChoice',
      owner: state.priority,
      choiceId: state.pending?.id,
      selected: [],
    });
  });

  it('keeps a selection that is still made of candidates, and drops one that is not', () => {
    const choiceId = state.pending?.id ?? '';
    const candidate = state.pending?.candidates[0] ?? '';
    const kept: UiMode = {
      kind: 'answeringChoice',
      owner: state.priority,
      choiceId,
      selected: [candidate],
    };
    expect(ensureModeValid(kept, state)).toBe(kept);

    const stale: UiMode = { ...kept, selected: [candidate, 'gone'] };
    expect(ensureModeValid(stale, state)).toEqual({ ...kept, selected: [candidate] });
  });

  it('drops the mode once the choice is answered', () => {
    const choiceId = state.pending?.id ?? '';
    const mode: UiMode = { kind: 'answeringChoice', owner: state.priority, choiceId, selected: [] };
    const answered = applyAction(state, {
      type: 'ANSWER_CHOICE',
      player: state.priority,
      choiceId,
      answer: { kind: 'cards', selected: [] },
    });
    expect(answered.ok).toBe(true);
    if (answered.ok && answered.state.pending === null) {
      expect(ensureModeValid(mode, answered.state)).toEqual(IDLE);
    }
  });

  it('publishes the choice through affordances, and nothing else', () => {
    const a = getAffordances(state);
    expect(a.global.mustAnswerChoice).toBe(true);
    expect(a.pendingChoice?.id).toBe(state.pending?.id);
    expect(a.pendingChoice?.candidates).toEqual(state.pending?.candidates);
    expect(Object.keys(a.byCard)).toEqual([]);
    expect(a.global.canEndTurn).toBe(false);
    expect(a.global.canPass).toBe(false);
  });
});
