import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { CardBackArt } from './CardBackArt';
import styles from './LifeStack.module.css';

/**
 * The Life area: a vertical column of face-down cards against the outer edge
 * of the mat, which is where the printed sheet puts it and how it is dealt.
 *
 * Backs and a count, never faces. Life is secret to its owner too (CR 3-10-2),
 * and the view says so — `lifeCount` is all there is. The cards are keyed by
 * position for the same reason: there is no instance here to key by, and
 * putting one in the DOM would be exactly the leak the view refuses to make.
 */
export function LifeStack({ count }: { count: number }): ReactElement {
  const m = useMessages();
  return (
    <div className={styles.lifeStack}>
      <span className={styles.label}>{m.board.life}</span>
      <div className={styles.stack}>
        {count === 0 ? <div className={styles.emptySlot} /> : null}
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={styles.back}>
            <CardBackArt />
          </div>
        ))}
      </div>
      <span className={styles.count}>{count}</span>
    </div>
  );
}
