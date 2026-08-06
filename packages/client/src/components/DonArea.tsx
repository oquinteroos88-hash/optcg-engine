import type { MouseEvent, ReactElement } from 'react';
import styles from './DonArea.module.css';

interface DonAreaProps {
  active: number;
  rested: number;
  deck: number;
  /** True when at least one card can receive DON!! for the acting player. */
  clickable: boolean;
  /** True while the UI is picking a card to attach DON!! to. */
  attaching: boolean;
  onClick: () => void;
}

export function DonArea({
  active,
  rested,
  deck,
  clickable,
  attaching,
  onClick,
}: DonAreaProps): ReactElement {
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    onClick();
  };
  const stateClass = attaching ? styles.attaching : clickable ? styles.clickable : '';
  return (
    <button
      type="button"
      className={`${styles.donArea} ${stateClass}`}
      onClick={handleClick}
      disabled={!clickable}
    >
      <span className={styles.label}>DON!!</span>
      <div className={styles.counts}>
        <span className={styles.active}>Activos: {active}</span>
        <span className={styles.rested}>Agotados: {rested}</span>
        <span className={styles.deck}>Mazo: {deck}</span>
      </div>
    </button>
  );
}
