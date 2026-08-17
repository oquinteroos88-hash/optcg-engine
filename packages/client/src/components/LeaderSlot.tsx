import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { useMessages } from '../i18n/useMessages';
import { CardTile } from './CardTile';
import styles from './LeaderSlot.module.css';

export function LeaderSlot({ id, mine }: { id: InstanceId; mine: boolean }): ReactElement {
  const m = useMessages();
  return (
    <div className={styles.leaderSlot}>
      <span className={styles.label}>{m.board.leader}</span>
      {/* Square cell: a rested Leader turns inside it. See `--slot`. */}
      <div className={styles.slot}>
        <CardTile id={id} zone="field" mine={mine} />
      </div>
    </div>
  );
}
