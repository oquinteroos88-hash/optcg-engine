import type { InstanceId } from '@optcg/engine';
import { cardAffordance } from './affordances';
import type { Affordances } from './affordances';
import type { UiMode } from './uiMode';

/** How a card should render for the current mode: purely affordance lookup. */
export type ClickState = 'selectable' | 'targetable' | 'selected' | 'inert';

export function clickStateOf(mode: UiMode, aff: Affordances, id: InstanceId): ClickState {
  const card = cardAffordance(aff, id);
  switch (mode.kind) {
    case 'idle':
      return card.canPlay || card.canAttack || card.canCounter || card.canBlock
        ? 'selectable'
        : 'inert';
    case 'attacking':
      if (mode.attacker === id) {
        return 'selected';
      }
      return cardAffordance(aff, mode.attacker).attackTargets.includes(id) ? 'targetable' : 'inert';
    case 'attachingDon':
      return card.canReceiveDon ? 'targetable' : 'inert';
    case 'choosingTrash':
      if (mode.cardToPlay === id) {
        return 'selected';
      }
      return cardAffordance(aff, mode.cardToPlay).trashCandidates.includes(id)
        ? 'targetable'
        : 'inert';
    case 'countering':
      if (mode.counterCard === id) {
        return 'selected';
      }
      return cardAffordance(aff, mode.counterCard).counterTargets.includes(id)
        ? 'targetable'
        : 'inert';
  }
}
