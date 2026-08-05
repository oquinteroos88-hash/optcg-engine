import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { CardTile } from './CardTile';
import styles from './CharacterRow.module.css';

const SLOT_COUNT = 5;

interface CharacterRowProps {
  ids: readonly InstanceId[];
  mine: boolean;
}

export function CharacterRow({ ids, mine }: CharacterRowProps): ReactElement {
  return (
    <div className={styles.row}>
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const id = ids[i];
        return id === undefined ? (
          <div key={`empty-${i}`} className={styles.empty} />
        ) : (
          <CardTile key={id} id={id} zone="field" mine={mine} />
        );
      })}
    </div>
  );
}
