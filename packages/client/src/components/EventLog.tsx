import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useLogEntries } from '../store/selectors';
import styles from './EventLog.module.css';

export function EventLog(): ReactElement {
  const entries = useLogEntries();
  const m = useMessages();
  return (
    <aside className={styles.log}>
      <h2 className={styles.title}>{m.board.logTitle}</h2>
      <ol className={styles.entries}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <span className={styles.turn}>{m.board.turnShort(entry.turn)}</span>
            <span className={styles.text}>
              {entry.player === null
                ? entry.text
                : `${playerLabel(entry.player, m)} ${entry.text}`}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
