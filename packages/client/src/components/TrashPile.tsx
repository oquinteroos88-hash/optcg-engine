import type { MouseEvent, ReactElement } from 'react';
import { cardImageSrc, hasCardImage } from '../game/cardImage';
import { useMessages } from '../i18n/useMessages';
import styles from './TrashPile.module.css';

interface TrashPileProps {
  count: number;
  /** The card on top, face-up. Null on an empty pile. */
  top: { cardId: string; name: string } | null;
  /** Counter mode: the count alone, for the condensed opponent half. */
  counter?: boolean;
  onOpen: () => void;
}

/**
 * The trash: the top card face-up, and a count.
 *
 * The only pile that shows a face, because it is the only pile whose contents
 * a player may read — the trash is public information (CR 3-5-2), and on the
 * table its top card is simply lying there. The deck stays a count: showing its
 * order would hand a player something the game does not give them.
 *
 * The face is an image and a name, not a `CardTile`. A tile is a button, and a
 * button inside the pile's button is invalid markup and would break the
 * accessible name every suite addresses this pile by. Reading the whole pile is
 * what the viewer this opens is for.
 */
export function TrashPile({ count, top, counter = false, onOpen }: TrashPileProps): ReactElement {
  const m = useMessages();
  const label = m.board.trash;

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    // The table background clears the current mode; a pile must not.
    e.stopPropagation();
    onOpen();
  };

  return (
    <button
      type="button"
      className={`${styles.pile} ${counter ? styles.counterMode : ''}`}
      onClick={handleClick}
      disabled={count === 0}
      aria-label={m.board.pile(label, count)}
    >
      <span className={styles.label}>{label}</span>
      <div className={`${styles.stack} ${top === null ? styles.empty : ''}`}>
        {top === null || counter || !hasCardImage(top.cardId) ? null : (
          <img className={styles.face} src={cardImageSrc(top.cardId)} alt="" aria-hidden="true" />
        )}
        {top === null || counter ? null : <span className={styles.name}>{top.name}</span>}
        <span className={styles.count}>{count}</span>
      </div>
    </button>
  );
}
