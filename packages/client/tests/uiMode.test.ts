import { describe, expect, it } from 'vitest';
import { applyAction } from '@optcg/engine';
import type { InstanceId } from '@optcg/engine';
import { characterAt } from '@optcg/engine/testdata/scenarios';
import { EMPTY_AFFORDANCE, getAffordances } from '../src/game/affordances';
import type { Affordances, CardAffordance } from '../src/game/affordances';
import { clickStateOf } from '../src/game/clickState';
import { toAction } from '../src/game/intent';
import { ensureModeValid, reduceUiMode } from '../src/game/uiMode';
import type { UiMode } from '../src/game/uiMode';
import { counterStepScenario, fullBoardScenario, mainPhaseWithAttacker } from './corpus';

function card(overrides: Partial<CardAffordance>): CardAffordance {
  return { ...EMPTY_AFFORDANCE, ...overrides };
}

function aff(
  byCard: Record<InstanceId, CardAffordance>,
  globals: Partial<Affordances['global']> = {},
): Affordances {
  return {
    byCard,
    global: {
      canEndTurn: false,
      canPass: false,
      canConcede: true,
      mustAnswerMulligan: false,
      ...globals,
    },
    whoActs: 'p1',
  };
}

const IDLE: UiMode = { kind: 'idle' };

describe('reduceUiMode transitions', () => {
  it('idle + playable hand card (no trash) emits PLAY_CARD without a trash key', () => {
    const a = aff({ h1: card({ canPlay: true }) });
    const result = reduceUiMode(IDLE, { kind: 'clickHandCard', instanceId: 'h1' }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({ type: 'PLAY_CARD', instanceId: 'h1' });
    expect(result.intent !== undefined && 'trashCharacter' in result.intent).toBe(false);
  });

  it('idle + playable hand card requiring trash enters choosingTrash', () => {
    const a = aff({ h1: card({ canPlay: true, playRequiresTrash: true, trashCandidates: ['c1'] }) });
    const result = reduceUiMode(IDLE, { kind: 'clickHandCard', instanceId: 'h1' }, a);
    expect(result.mode).toEqual({ kind: 'choosingTrash', owner: 'p1', cardToPlay: 'h1' });
    expect(result.intent).toBeUndefined();
  });

  it('idle + counterable hand card enters countering', () => {
    const a = aff({ h1: card({ canCounter: true, counterTargets: ['L1'] }) });
    const result = reduceUiMode(IDLE, { kind: 'clickHandCard', instanceId: 'h1' }, a);
    expect(result.mode).toEqual({ kind: 'countering', owner: 'p1', counterCard: 'h1' });
    expect(result.intent).toBeUndefined();
  });

  it('idle + ambiguous card (play + attack) enters cardSelected', () => {
    const a = aff({ x1: card({ canPlay: true, canAttack: true, attackTargets: ['L2'] }) });
    const viaHand = reduceUiMode(IDLE, { kind: 'clickHandCard', instanceId: 'x1' }, a);
    expect(viaHand.mode).toEqual({ kind: 'cardSelected', owner: 'p1', card: 'x1' });
    const viaField = reduceUiMode(IDLE, { kind: 'clickFieldCard', instanceId: 'x1', mine: true }, a);
    expect(viaField.mode).toEqual({ kind: 'cardSelected', owner: 'p1', card: 'x1' });
  });

  it('cardSelected + chooseAction routes to play intent, choosingTrash, or attacking', () => {
    const selected: UiMode = { kind: 'cardSelected', owner: 'p1', card: 'x1' };
    const plain = aff({ x1: card({ canPlay: true, canAttack: true }) });
    expect(reduceUiMode(selected, { kind: 'chooseAction', action: 'play' }, plain)).toEqual({
      mode: IDLE,
      intent: { type: 'PLAY_CARD', instanceId: 'x1' },
    });
    const trashy = aff({
      x1: card({ canPlay: true, canAttack: true, playRequiresTrash: true, trashCandidates: ['c1'] }),
    });
    expect(reduceUiMode(selected, { kind: 'chooseAction', action: 'play' }, trashy).mode).toEqual({
      kind: 'choosingTrash',
      owner: 'p1',
      cardToPlay: 'x1',
    });
    const attack = reduceUiMode(selected, { kind: 'chooseAction', action: 'attack' }, plain);
    expect(attack.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker: 'x1' });
    expect(attack.intent).toBeUndefined();
  });

  it('idle + own attacker enters attacking; valid target emits DECLARE_ATTACK', () => {
    const a = aff({ c1: card({ canAttack: true, attackTargets: ['L2', 'e1'] }) });
    const enter = reduceUiMode(IDLE, { kind: 'clickFieldCard', instanceId: 'c1', mine: true }, a);
    expect(enter.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker: 'c1' });
    const attack = reduceUiMode(enter.mode, { kind: 'clickFieldCard', instanceId: 'e1', mine: false }, a);
    expect(attack.mode).toEqual(IDLE);
    expect(attack.intent).toEqual({ type: 'DECLARE_ATTACK', attacker: 'c1', target: 'e1' });
  });

  it('attacking + non-target click is a no-op', () => {
    const a = aff({ c1: card({ canAttack: true, attackTargets: ['L2'] }) });
    const mode: UiMode = { kind: 'attacking', owner: 'p1', attacker: 'c1' };
    const result = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'nope', mine: false }, a);
    expect(result.mode).toBe(mode);
    expect(result.intent).toBeUndefined();
  });

  it('idle + own blocker emits DECLARE_BLOCK directly', () => {
    const a = aff({ c1: card({ canBlock: true }) });
    const result = reduceUiMode(IDLE, { kind: 'clickFieldCard', instanceId: 'c1', mine: true }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({ type: 'DECLARE_BLOCK', blocker: 'c1' });
  });

  it('DON area click enters attachingDon only when some card can receive DON', () => {
    const yes = aff({ L1: card({ canReceiveDon: true }) });
    expect(reduceUiMode(IDLE, { kind: 'clickDonArea' }, yes).mode).toEqual({ kind: 'attachingDon', owner: 'p1' });
    const no = aff({});
    const result = reduceUiMode(IDLE, { kind: 'clickDonArea' }, no);
    expect(result.mode).toBe(IDLE);
    expect(result.intent).toBeUndefined();
  });

  it('attachingDon + receivable own card emits ATTACH_DON count 1', () => {
    const a = aff({ L1: card({ canReceiveDon: true }) });
    const mode: UiMode = { kind: 'attachingDon', owner: 'p1' };
    const result = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'L1', mine: true }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({ type: 'ATTACH_DON', to: 'L1', count: 1 });
    const miss = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'c9', mine: true }, a);
    expect(miss.mode).toBe(mode);
    expect(miss.intent).toBeUndefined();
  });

  it('attachingDon + DON area click toggles back to idle', () => {
    const a = aff({ L1: card({ canReceiveDon: true }) });
    const mode: UiMode = { kind: 'attachingDon', owner: 'p1' };
    const result = reduceUiMode(mode, { kind: 'clickDonArea' }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toBeUndefined();
  });

  it('choosingTrash + candidate click emits PLAY_CARD with trashCharacter', () => {
    const a = aff({ h1: card({ canPlay: true, playRequiresTrash: true, trashCandidates: ['c1', 'c2'] }) });
    const mode: UiMode = { kind: 'choosingTrash', owner: 'p1', cardToPlay: 'h1' };
    const result = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'c2', mine: true }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({ type: 'PLAY_CARD', instanceId: 'h1', trashCharacter: 'c2' });
    const miss = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'c9', mine: true }, a);
    expect(miss.mode).toBe(mode);
    expect(miss.intent).toBeUndefined();
  });

  it('countering + valid own target emits PLAY_COUNTER', () => {
    const a = aff({ h1: card({ canCounter: true, counterTargets: ['L1', 'c1'] }) });
    const mode: UiMode = { kind: 'countering', owner: 'p1', counterCard: 'h1' };
    const result = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'c1', mine: true }, a);
    expect(result.mode).toEqual(IDLE);
    expect(result.intent).toEqual({ type: 'PLAY_COUNTER', instanceId: 'h1', target: 'c1' });
    const miss = reduceUiMode(mode, { kind: 'clickFieldCard', instanceId: 'c9', mine: true }, a);
    expect(miss.mode).toBe(mode);
    expect(miss.intent).toBeUndefined();
  });

  it('escape and clickEmpty reset every mode to idle with no intent', () => {
    const a = aff({ h1: card({ canPlay: true }) });
    const modes: UiMode[] = [
      { kind: 'idle' },
      { kind: 'cardSelected', owner: 'p1', card: 'h1' },
      { kind: 'attacking', owner: 'p1', attacker: 'c1' },
      { kind: 'attachingDon', owner: 'p1' },
      { kind: 'choosingTrash', owner: 'p1', cardToPlay: 'h1' },
      { kind: 'countering', owner: 'p1', counterCard: 'h1' },
    ];
    for (const mode of modes) {
      for (const ev of [{ kind: 'escape' } as const, { kind: 'clickEmpty' } as const]) {
        const result = reduceUiMode(mode, ev, a);
        expect(result.mode).toEqual(IDLE);
        expect(result.intent).toBeUndefined();
      }
    }
  });

  it('clicks matching nothing keep the mode and emit no intent', () => {
    const a = aff({});
    const handMiss = reduceUiMode(IDLE, { kind: 'clickHandCard', instanceId: 'h9' }, a);
    expect(handMiss.mode).toBe(IDLE);
    expect(handMiss.intent).toBeUndefined();
    const fieldMiss = reduceUiMode(IDLE, { kind: 'clickFieldCard', instanceId: 'c9', mine: true }, a);
    expect(fieldMiss.mode).toBe(IDLE);
    expect(fieldMiss.intent).toBeUndefined();
    const enemyMiss = reduceUiMode(
      IDLE,
      { kind: 'clickFieldCard', instanceId: 'c9', mine: false },
      aff({ c9: card({ canAttack: true, attackTargets: ['L2'] }) }),
    );
    expect(enemyMiss.mode).toBe(IDLE);
    expect(enemyMiss.intent).toBeUndefined();
  });
});

describe('ensureModeValid', () => {
  it('keeps a mode whose card still carries the affordance', () => {
    const { state: fullBoard, playable } = fullBoardScenario();
    const mode: UiMode = { kind: 'choosingTrash', owner: 'p1', cardToPlay: playable };
    expect(ensureModeValid(mode, fullBoard)).toBe(mode);
    // countering mode stays valid on the live counter-step state
    const { state, counterCard } = counterStepScenario();
    const counterMode: UiMode = { kind: 'countering', owner: 'p2', counterCard };
    expect(ensureModeValid(counterMode, state)).toBe(counterMode);
  });

  // The ownership stamp is what closes the hole: attachingDon has no instance
  // id, so an affordance-only check let it survive into the next player's turn.
  it('drops every mode opened by a player who no longer holds priority', () => {
    const state = mainPhaseWithAttacker();
    expect(state.priority).toBe('p1');
    const attacker = characterAt(state, 'p1', 0);
    const handCardId = state.players.p1.hand[0];
    expect(handCardId).toBeDefined();
    if (handCardId === undefined) {
      return;
    }

    const passed = applyAction(state, { type: 'END_TURN', player: 'p1' });
    expect(passed.ok).toBe(true);
    if (!passed.ok) {
      return;
    }
    expect(passed.state.priority).toBe('p2');
    // p2 has active DON of their own, so the global "can anything take DON?"
    // predicate is still true here — only ownership can reject the mode.
    expect(getAffordances(passed.state).byCard[passed.state.players.p2.leader]?.canReceiveDon).toBe(
      true,
    );

    const staleModes: UiMode[] = [
      { kind: 'attachingDon', owner: 'p1' },
      { kind: 'attacking', owner: 'p1', attacker },
      { kind: 'cardSelected', owner: 'p1', card: handCardId },
      { kind: 'choosingTrash', owner: 'p1', cardToPlay: handCardId },
      { kind: 'countering', owner: 'p1', counterCard: handCardId },
    ];
    for (const mode of staleModes) {
      expect(ensureModeValid(mode, passed.state)).toEqual(IDLE);
    }

    // A mode owned by the player who now holds priority is still evaluated on
    // its affordances rather than rejected outright.
    expect(ensureModeValid({ kind: 'attachingDon', owner: 'p2' }, passed.state)).toEqual({
      kind: 'attachingDon',
      owner: 'p2',
    });
  });

  it('resets attacking mode when the attacker no longer can attack', () => {
    const { state } = fullBoardScenario();
    const attacker = characterAt(state, 'p1', 0);
    const mode: UiMode = { kind: 'attacking', owner: 'p1', attacker };
    expect(ensureModeValid(mode, state)).toBe(mode);

    const result = applyAction(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Priority moved to the defender: the attacker's affordance is gone.
      expect(ensureModeValid(mode, result.state)).toEqual(IDLE);
    }
  });

  it('resets choosingTrash after the pending play resolves', () => {
    const { state, playable } = fullBoardScenario();
    const mode: UiMode = { kind: 'choosingTrash', owner: 'p1', cardToPlay: playable };
    const trash = state.players.p1.characters[0];
    expect(trash).toBeDefined();
    if (trash === undefined) {
      return;
    }
    const result = applyAction(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: playable,
      trashCharacter: trash,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(ensureModeValid(mode, result.state)).toEqual(IDLE);
    }
  });
});

describe('toAction', () => {
  it('omits the trashCharacter key entirely when the intent has none', () => {
    const action = toAction({ type: 'PLAY_CARD', instanceId: 'h1' }, 'p1');
    expect(action).toEqual({ type: 'PLAY_CARD', player: 'p1', instanceId: 'h1' });
    expect('trashCharacter' in action).toBe(false);
  });

  it('keeps the trashCharacter key when the intent carries one', () => {
    const action = toAction({ type: 'PLAY_CARD', instanceId: 'h1', trashCharacter: 'c2' }, 'p2');
    expect(action).toEqual({
      type: 'PLAY_CARD',
      player: 'p2',
      instanceId: 'h1',
      trashCharacter: 'c2',
    });
  });

  it('adds the acting player to every intent shape', () => {
    expect(toAction({ type: 'MULLIGAN', accept: true }, 'p1')).toEqual({
      type: 'MULLIGAN',
      player: 'p1',
      accept: true,
    });
    expect(toAction({ type: 'ATTACH_DON', to: 'L1', count: 1 }, 'p1')).toEqual({
      type: 'ATTACH_DON',
      player: 'p1',
      to: 'L1',
      count: 1,
    });
    expect(toAction({ type: 'DECLARE_ATTACK', attacker: 'c1', target: 'L2' }, 'p1')).toEqual({
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: 'c1',
      target: 'L2',
    });
    expect(toAction({ type: 'DECLARE_BLOCK', blocker: 'c1' }, 'p2')).toEqual({
      type: 'DECLARE_BLOCK',
      player: 'p2',
      blocker: 'c1',
    });
    expect(toAction({ type: 'PLAY_COUNTER', instanceId: 'h1', target: 'L2' }, 'p2')).toEqual({
      type: 'PLAY_COUNTER',
      player: 'p2',
      instanceId: 'h1',
      target: 'L2',
    });
    expect(toAction({ type: 'PASS' }, 'p2')).toEqual({ type: 'PASS', player: 'p2' });
    expect(toAction({ type: 'END_TURN' }, 'p1')).toEqual({ type: 'END_TURN', player: 'p1' });
    expect(toAction({ type: 'CONCEDE' }, 'p1')).toEqual({ type: 'CONCEDE', player: 'p1' });
  });
});

describe('clickStateOf', () => {
  it('marks cards with any affordance selectable in idle, others inert', () => {
    const a = aff({
      h1: card({ canPlay: true }),
      c1: card({ canAttack: true, attackTargets: ['L2'] }),
      h2: card({ canCounter: true }),
      c2: card({ canBlock: true }),
      d1: card({ canReceiveDon: true }),
      x1: card({}),
    });
    expect(clickStateOf(IDLE, a, 'h1')).toBe('selectable');
    expect(clickStateOf(IDLE, a, 'c1')).toBe('selectable');
    expect(clickStateOf(IDLE, a, 'h2')).toBe('selectable');
    expect(clickStateOf(IDLE, a, 'c2')).toBe('selectable');
    // DON attachment starts from the DON area, not from the card.
    expect(clickStateOf(IDLE, a, 'd1')).toBe('inert');
    expect(clickStateOf(IDLE, a, 'x1')).toBe('inert');
    expect(clickStateOf(IDLE, a, 'unknown')).toBe('inert');
  });

  it('splits selected vs targetable in attacking mode', () => {
    const a = aff({ c1: card({ canAttack: true, attackTargets: ['L2', 'e1'] }) });
    const mode: UiMode = { kind: 'attacking', owner: 'p1', attacker: 'c1' };
    expect(clickStateOf(mode, a, 'c1')).toBe('selected');
    expect(clickStateOf(mode, a, 'e1')).toBe('targetable');
    expect(clickStateOf(mode, a, 'other')).toBe('inert');
  });

  it('marks DON receivers targetable while attaching', () => {
    const a = aff({ L1: card({ canReceiveDon: true }), x1: card({}) });
    const mode: UiMode = { kind: 'attachingDon', owner: 'p1' };
    expect(clickStateOf(mode, a, 'L1')).toBe('targetable');
    expect(clickStateOf(mode, a, 'x1')).toBe('inert');
  });

  it('marks trash candidates targetable while choosing a sacrifice', () => {
    const a = aff({ h1: card({ canPlay: true, playRequiresTrash: true, trashCandidates: ['c1'] }) });
    const mode: UiMode = { kind: 'choosingTrash', owner: 'p1', cardToPlay: 'h1' };
    expect(clickStateOf(mode, a, 'h1')).toBe('selected');
    expect(clickStateOf(mode, a, 'c1')).toBe('targetable');
    expect(clickStateOf(mode, a, 'c9')).toBe('inert');
  });

  it('marks counter targets targetable while countering', () => {
    const a = aff({ h1: card({ canCounter: true, counterTargets: ['L1'] }) });
    const mode: UiMode = { kind: 'countering', owner: 'p1', counterCard: 'h1' };
    expect(clickStateOf(mode, a, 'h1')).toBe('selected');
    expect(clickStateOf(mode, a, 'L1')).toBe('targetable');
    expect(clickStateOf(mode, a, 'c9')).toBe('inert');
  });

  it('marks only the selected card in cardSelected mode', () => {
    const a = aff({ x1: card({ canPlay: true, canAttack: true }) });
    const mode: UiMode = { kind: 'cardSelected', owner: 'p1', card: 'x1' };
    expect(clickStateOf(mode, a, 'x1')).toBe('selected');
    expect(clickStateOf(mode, a, 'other')).toBe('inert');
  });
});
