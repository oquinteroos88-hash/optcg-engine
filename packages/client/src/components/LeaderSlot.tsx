import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { useMessages } from '../i18n/useMessages';
import { AttachedDon } from './AttachedDon';
import { CardTile } from './CardTile';
import styles from './LeaderSlot.module.css';

interface LeaderSlotProps {
  id: InstanceId;
  mine: boolean;
  /** DON!! given to the Leader, which is where most of them end up. */
  donCount: number;
}

export function LeaderSlot({ id, mine, donCount }: LeaderSlotProps): ReactElement {
  const m = useMessages();
  return (
    <div className={styles.leaderSlot}>
      <span className={styles.label}>{m.board.leader}</span>
      {/* Square cell: a rested Leader turns inside it. See `--slot`. */}
      <div className={styles.slot}>
        <AttachedDon count={donCount} />
        <CardTile id={id} zone="field" mine={mine} />
      </div>
    </div>
  );
}
