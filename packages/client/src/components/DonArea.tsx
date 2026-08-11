import type { MouseEvent, ReactElement } from 'react';
import styles from './DonArea.module.css';

interface DonAreaProps {
  active: number;
  rested: number;
  /** True when at least one card can receive DON!! for the acting player. */
  clickable: boolean;
  /** True while the UI is picking a card to attach DON!! to. */
  attaching: boolean;
  onClick: () => void;
}

/**
 * The cost area: the DON!! that are in play, active or rested.
 *
 * The DON!! deck moved out to its own pile alongside this one, because they are
 * two zones on the playmat and only one of them is ever clicked. The accessible
 * name still opens with "DON!!" — that is how every test addresses this
 * control, and it is the name a player would use.
 */
export function DonArea({ active, rested, clickable, attaching, onClick }: DonAreaProps): ReactElement {
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
      aria-label={`DON!! en área de coste: ${active} activos, ${rested} agotados`}
    >
      <span className={styles.label}>DON!!</span>
      <div className={styles.counts}>
        <span className={styles.active}>Activos: {active}</span>
        <span className={styles.rested}>Agotados: {rested}</span>
      </div>
    </button>
  );
}
