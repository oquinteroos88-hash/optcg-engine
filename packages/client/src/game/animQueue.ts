import type { GameEvent, InstanceId } from '@optcg/engine';

export interface AnimGroup {
  id: number;
  kind: 'draw' | 'refreshDon' | 'turn' | 'battle' | 'single';
  events: readonly GameEvent[];
  durationMs: number;
  cardIds: readonly InstanceId[];
}

// Events with nothing to animate: game start bookkeeping and mulligan choices
// (an accepted mulligan is visible through its cardDrawn burst).
const ZERO_VISUAL = new Set<GameEvent['type']>(['gameStarted', 'lifeSet', 'mulliganTaken']);

const DRAW_MS = 300;
const REFRESH_DON_MS = 300;
const TURN_MS = 200;
const COUNTER_MS = 150;
const BATTLE_MS = 300;
const SINGLE_MS = 200;

let nextGroupId = 1;

/** Deterministic ids for tests. */
export function resetAnimGroupIds(): void {
  nextGroupId = 1;
}

function cardIdsOf(event: GameEvent): InstanceId[] {
  switch (event.type) {
    case 'cardDrawn':
    case 'cardPlayed':
    case 'characterTrashedForRoom':
    case 'lifeTaken':
    case 'koed':
      return [event.instanceId];
    case 'donAttached':
      return [event.to];
    case 'attackDeclared':
      return [event.attacker, event.target];
    case 'blockDeclared':
      return [event.blocker];
    case 'counterPlayed':
      return [event.instanceId, event.target];
    case 'battleResolved':
      return [event.attacker, event.target];
    case 'stageReplaced':
      return [event.oldStage, event.newStage];
    default:
      return [];
  }
}

/**
 * Groups a reducer's event batch into FIFO animation steps. Pure — no timers;
 * the AnimationDriver consumes the queue.
 */
export function groupEvents(events: readonly GameEvent[]): AnimGroup[] {
  const groups: AnimGroup[] = [];
  let i = 0;

  const push = (kind: AnimGroup['kind'], slice: GameEvent[], durationMs: number): void => {
    groups.push({
      id: nextGroupId,
      kind,
      events: slice,
      durationMs,
      cardIds: slice.flatMap(cardIdsOf),
    });
    nextGroupId += 1;
  };

  while (i < events.length) {
    const event = events[i];
    if (event === undefined) {
      break;
    }

    if (ZERO_VISUAL.has(event.type)) {
      i += 1;
      continue;
    }

    if (event.type === 'cardDrawn') {
      const slice: GameEvent[] = [event];
      let j = i + 1;
      while (j < events.length) {
        const next = events[j];
        if (next === undefined || next.type !== 'cardDrawn' || next.player !== event.player) {
          break;
        }
        slice.push(next);
        j += 1;
      }
      push('draw', slice, DRAW_MS);
      i = j;
      continue;
    }

    if (event.type === 'donReturned' || event.type === 'donGained') {
      const slice: GameEvent[] = [event];
      let j = i + 1;
      while (j < events.length) {
        const next = events[j];
        if (next === undefined || (next.type !== 'donReturned' && next.type !== 'donGained')) {
          break;
        }
        slice.push(next);
        j += 1;
      }
      push('refreshDon', slice, REFRESH_DON_MS);
      i = j;
      continue;
    }

    if (event.type === 'turnEnded') {
      const next = events[i + 1];
      if (next !== undefined && next.type === 'turnStarted') {
        push('turn', [event, next], TURN_MS);
        i += 2;
        continue;
      }
    }

    if (event.type === 'counterPlayed') {
      push('single', [event], COUNTER_MS);
      i += 1;
      continue;
    }

    if (event.type === 'battleResolved' || event.type === 'koed' || event.type === 'lifeTaken') {
      push('battle', [event], BATTLE_MS);
      i += 1;
      continue;
    }

    push('single', [event], SINGLE_MS);
    i += 1;
  }

  return groups;
}
