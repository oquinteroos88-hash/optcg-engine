import type { MouseEvent, ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { useCardView, useClickState, useIsHighlighted, useTargeting } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './CardTile.module.css';

interface CardTileProps {
  id: InstanceId;
  /** Which zone the tile lives in — decides which UiEvent a click fires. */
  zone: 'hand' | 'field';
  /** True when the tile belongs to the player who acts now. */
  mine: boolean;
  /** Face-down rendering (veiled opponent hand). */
  veiled?: boolean;
}

export function CardTile({ id, zone, mine, veiled = false }: CardTileProps): ReactElement | null {
  const view = useCardView(id);
  const clickState = useClickState(id);
  const targeting = useTargeting();
  const highlighted = useIsHighlighted(id);
  const uiEvent = useStore((s) => s.uiEvent);

  if (view === null) {
    return null;
  }
  if (veiled) {
    return <div className={`${styles.card} ${styles.back}`} aria-label="Carta oculta" />;
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    // Cards must not bubble into the table background (which clears the mode).
    e.stopPropagation();
    if (zone === 'hand') {
      uiEvent({ kind: 'clickHandCard', instanceId: id });
    } else {
      uiEvent({ kind: 'clickFieldCard', instanceId: id, mine });
    }
  };

  const colorClass = styles[view.colorClass] ?? '';
  const restedClass = view.rested ? styles.rested : '';
  const stateClass = styles[clickState] ?? '';
  const dimClass = targeting && clickState === 'inert' ? styles.dimmed : '';
  const animClass = highlighted ? styles.animating : '';

  const counterLabel = view.counter === null ? 'sin contraataque' : `contraataque ${view.counter}`;
  const costLabel = view.cost === null ? '' : `coste ${view.cost}, `;

  return (
    <button
      type="button"
      className={`${styles.card} ${colorClass} ${restedClass} ${stateClass} ${dimClass} ${animClass}`}
      onClick={handleClick}
      aria-label={`${view.name}, ${costLabel}poder ${view.power}, ${counterLabel}${view.rested ? ', agotada' : ''}`}
    >
      <div className={styles.header}>
        {view.cost === null ? null : <span className={styles.cost}>{view.cost}</span>}
        <span className={styles.name}>{view.name}</span>
      </div>
      <div className={styles.stats}>
        <span className={styles.power}>{view.power}</span>
        <span className={styles.counter}>{view.counter === null ? '—' : `+${view.counter}`}</span>
      </div>
      {view.donCount > 0 ? <span className={styles.donBadge}>DON ×{view.donCount}</span> : null}
    </button>
  );
}
