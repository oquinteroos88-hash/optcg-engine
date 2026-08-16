import type { InstanceId, ViewEvent } from '@optcg/engine';

export interface AnimGroup {
  id: number;
  /**
   * `donMoved` covers every DON!! relocation burst — the refresh phase, but also
   * DON!! returning rested from a card that left the field — so it must not
   * claim to be the refresh phase.
   */
  kind: 'draw' | 'donMoved' | 'turn' | 'battle' | 'single';
  events: readonly ViewEvent[];
  durationMs: number;
  cardIds: readonly InstanceId[];
}

// Events with nothing to animate: game start bookkeeping and mulligan choices
// (an accepted mulligan is visible through its cardDrawn burst).
const ZERO_VISUAL = new Set<ViewEvent['type']>(['gameStarted', 'lifeSet', 'mulliganTaken']);

const DRAW_MS = 300;
const DON_MOVED_MS = 300;
const TURN_MS = 200;
const COUNTER_MS = 150;
const BATTLE_MS = 300;
const SINGLE_MS = 200;

let nextGroupId = 1;

/** Deterministic ids for tests. */
export function resetAnimGroupIds(): void {
  nextGroupId = 1;
}

/**
 * Which cards a group highlights.
 *
 * Redacted events name what the viewer may name and `null` otherwise, so the
 * nulls drop out here: a card this seat cannot see is a card whose tile is not
 * on the board to light up. The group still exists and still takes its time —
 * the opponent drawing is a thing that visibly happens — it simply highlights
 * nothing, which is exactly what a face-down card does.
 */
function cardIdsOf(event: ViewEvent): InstanceId[] {
  const ids = ((): (InstanceId | null)[] => {
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
      case 'battleEndedEarly':
        return [event.attacker, event.target];
      case 'stageReplaced':
        return [event.oldStage, event.newStage];
      default:
        return [];
    }
  })();
  return ids.filter((id): id is InstanceId => id !== null);
}

/**
 * Groups a reducer's event batch into FIFO animation steps. Pure — no timers;
 * the AnimationDriver consumes the queue.
 */
export function groupEvents(events: readonly ViewEvent[]): AnimGroup[] {
  const groups: AnimGroup[] = [];
  let i = 0;

  const push = (kind: AnimGroup['kind'], slice: ViewEvent[], durationMs: number): void => {
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
      const slice: ViewEvent[] = [event];
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
      const slice: ViewEvent[] = [event];
      let j = i + 1;
      while (j < events.length) {
        const next = events[j];
        if (next === undefined || (next.type !== 'donReturned' && next.type !== 'donGained')) {
          break;
        }
        slice.push(next);
        j += 1;
      }
      push('donMoved', slice, DON_MOVED_MS);
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

    if (
      event.type === 'battleResolved' ||
      event.type === 'battleEndedEarly' ||
      event.type === 'koed' ||
      event.type === 'lifeTaken'
    ) {
      push('battle', [event], BATTLE_MS);
      i += 1;
      continue;
    }

    push('single', [event], SINGLE_MS);
    i += 1;
  }

  return groups;
}
