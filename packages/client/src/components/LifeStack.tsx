import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import styles from './LifeStack.module.css';

export function LifeStack({ count }: { count: number }): ReactElement {
  const m = useMessages();
  return (
    <div className={styles.lifeStack}>
      <span className={styles.label}>{m.board.life}</span>
      <div className={styles.stack}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={styles.back} style={{ top: `${i * 4}px` }} />
        ))}
        {count === 0 ? <div className={styles.emptySlot} /> : null}
      </div>
      <span className={styles.count}>{count}</span>
    </div>
  );
}
