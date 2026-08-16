import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { donArtSrc } from '../game/cardImage';
import { useMessages } from '../i18n/useMessages';
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
  const m = useMessages();
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    onClick();
  };
  const stateClass = attaching ? styles.attaching : clickable ? styles.clickable : '';
  // The DON!! card's own art, as a dim backdrop. A CSS background that 404s
  // simply does not paint, so this degrades to the existing panel with no
  // fallback logic and no broken-image box — which is the whole reason it is a
  // background here and an <img> on a card tile.
  const art = { '--don-art': `url("${donArtSrc()}")` } as CSSProperties;
  return (
    <button
      type="button"
      style={art}
      className={`${styles.donArea} ${stateClass}`}
      onClick={handleClick}
      disabled={!clickable}
      aria-label={m.board.donArea(active, rested)}
    >
      {/* DON!! is a name, not a word: it is not translated in any language. */}
      <span className={styles.label}>DON!!</span>
      <div className={styles.counts}>
        <span className={styles.active}>{m.board.donActive(active)}</span>
        <span className={styles.rested}>{m.board.donRested(rested)}</span>
      </div>
    </button>
  );
}
