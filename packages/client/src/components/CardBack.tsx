import type { MouseEvent, ReactElement } from 'react';
import styles from './CardBack.module.css';

interface CardBackProps {
  /** Accessible name. There is no card name to fall back on, by definition. */
  label: string;
  /** Selectable backs — a blind choice. Inert ones render as a plain div. */
  onClick?: () => void;
  selected?: boolean;
}

/**
 * A card with no face.
 *
 * Two callers, and they are the two halves of the same fact: a hand the view
 * publishes as a count (CR 3-4-3 — the other player may not look), and the
 * candidates of a **blind** choice, which the chooser must pick from without
 * seeing them (CR 8-4-4-2, `OP01-038` Kanjuro).
 *
 * The second is the first time this UI has ever asked a player to choose
 * something it cannot show them, and the whole design of the tile is that
 * there is nothing behind it: no hover preview, no tooltip, no enlarge. A tile
 * that opened an empty preview panel would be promising a face it does not
 * have.
 */
export function CardBack({ label, onClick, selected = false }: CardBackProps): ReactElement {
  if (onClick === undefined) {
    return <div className={`${styles.back} ${styles.inert}`} aria-label={label} />;
  }
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    // Same reason a CardTile stops it: the table background clears the mode.
    e.stopPropagation();
    onClick();
  };
  return (
    <button
      type="button"
      className={`${styles.back} ${styles.selectable} ${selected ? styles.selected : ''}`}
      onClick={handleClick}
      aria-pressed={selected}
      aria-label={label}
    >
      <span className={styles.mark} aria-hidden="true">
        ?
      </span>
    </button>
  );
}
