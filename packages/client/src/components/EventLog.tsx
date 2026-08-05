import type { ReactElement } from 'react';
import { playerLabel, useLogEntries } from '../store/selectors';
import styles from './EventLog.module.css';

export function EventLog(): ReactElement {
  const entries = useLogEntries();
  return (
    <aside className={styles.log}>
      <h2 className={styles.title}>Registro</h2>
      <ol className={styles.entries}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <span className={styles.turn}>T{entry.turn}</span>
            <span className={styles.text}>
              {entry.player === null ? entry.text : `${playerLabel(entry.player)} ${entry.text}`}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
