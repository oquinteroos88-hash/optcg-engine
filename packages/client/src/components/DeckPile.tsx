import type { MouseEvent, ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { CardBackArt } from './CardBackArt';
import styles from './DeckPile.module.css';

interface DeckPileProps {
  label: string;
  count: number;
  /** Half height, for the DON!! row where three piles share the space. */
  compact?: boolean;
  /**
   * Counter mode: the label and the number, no card.
   *
   * The condensed opponent half on a phone held upright. Their piles are backs
   * and a number in the first place — the view publishes nothing else about
   * them — so dropping the picture loses no information, and the room it frees
   * goes to the half that has faces on it.
   */
  counter?: boolean;
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
export function DeckPile({
  label,
  count,
  compact = false,
  counter = false,
  onOpen,
}: DeckPileProps): ReactElement {
  const m = useMessages();
  const body = (
    <div className={`${styles.stack} ${count === 0 ? styles.empty : ''}`}>
      {/* A pile of cards looks like the back of a card. An empty one shows the
          dashed box instead: there is nothing there to draw. */}
      {count === 0 || counter ? null : <CardBackArt />}
      <span className={styles.count}>{count}</span>
    </div>
  );
  const shape = `${compact ? styles.compact : ''} ${counter ? styles.counter : ''}`;

  if (onOpen === undefined) {
    return (
      <div className={`${styles.pile} ${shape}`}>
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
      className={`${styles.pile} ${styles.openable} ${shape}`}
      onClick={handleClick}
      disabled={count === 0}
      aria-label={m.board.pile(label, count)}
    >
      <span className={styles.label}>{label}</span>
      {body}
    </button>
  );
}
