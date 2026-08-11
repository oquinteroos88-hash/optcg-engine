import type { ReactElement } from 'react';
import styles from './DeckPile.module.css';

interface DeckPileProps {
  label: string;
  count: number;
  /** Half height, for the DON!! row where three piles share the space. */
  compact?: boolean;
}

/**
 * A face-down pile with a count: deck, trash, DON!! deck.
 *
 * Not clickable and not a card: nothing in the engine lets a player act on a
 * pile, so making it look actionable would be a lie. It is here because the
 * official playmat has these zones and a board without them reads as unfinished
 * — the counts are the information, and the counts are what it shows.
 */
export function DeckPile({ label, count, compact = false }: DeckPileProps): ReactElement {
  return (
    <div className={`${styles.pile} ${compact ? styles.compact : ''}`}>
      <span className={styles.label}>{label}</span>
      <div className={`${styles.stack} ${count === 0 ? styles.empty : ''}`}>
        <span className={styles.count}>{count}</span>
      </div>
    </div>
  );
}
