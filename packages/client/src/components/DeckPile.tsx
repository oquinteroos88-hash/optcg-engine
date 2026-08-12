import type { MouseEvent, ReactElement } from 'react';
import styles from './DeckPile.module.css';

interface DeckPileProps {
  label: string;
  count: number;
  /** Half height, for the DON!! row where three piles share the space. */
  compact?: boolean;
  /**
   * Present only on a pile whose contents a player is allowed to read — the
   * trash, and nothing else. The deck stays a plain count on purpose: showing
   * its order would hand a player information the game does not give them.
   */
  onOpen?: (() => void) | undefined;
}

/**
 * A pile with a count: deck, trash, DON!! deck.
 *
 * Never an action. Nothing in the engine lets a player act on a pile, so a pile
 * that looked actionable would be a lie — but reading the trash is not acting
 * on it, and the trash is public information, so that one opens a viewer.
 */
export function DeckPile({ label, count, compact = false, onOpen }: DeckPileProps): ReactElement {
  const body = (
    <div className={`${styles.stack} ${count === 0 ? styles.empty : ''}`}>
      <span className={styles.count}>{count}</span>
    </div>
  );

  if (onOpen === undefined) {
    return (
      <div className={`${styles.pile} ${compact ? styles.compact : ''}`}>
        <span className={styles.label}>{label}</span>
        {body}
      </div>
    );
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    // The table background clears the current mode; a pile must not.
    e.stopPropagation();
    onOpen();
  };

  return (
    <button
      type="button"
      className={`${styles.pile} ${styles.openable} ${compact ? styles.compact : ''}`}
      onClick={handleClick}
      disabled={count === 0}
      aria-label={`${label}: ${count} cartas${count === 0 ? '' : ', ver'}`}
    >
      <span className={styles.label}>{label}</span>
      {body}
    </button>
  );
}
