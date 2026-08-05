import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { CardTile } from './CardTile';
import styles from './StageSlot.module.css';

export function StageSlot({ id, mine }: { id: InstanceId | null; mine: boolean }): ReactElement {
  return (
    <div className={styles.stageSlot}>
      <span className={styles.label}>Escenario</span>
      {id === null ? (
        <div className={styles.empty} />
      ) : (
        <CardTile id={id} zone="field" mine={mine} />
      )}
    </div>
  );
}
