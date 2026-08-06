import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { CardTile } from './CardTile';
import styles from './LeaderSlot.module.css';

export function LeaderSlot({ id, mine }: { id: InstanceId; mine: boolean }): ReactElement {
  return (
    <div className={styles.leaderSlot}>
      <span className={styles.label}>Líder</span>
      <CardTile id={id} zone="field" mine={mine} />
    </div>
  );
}
