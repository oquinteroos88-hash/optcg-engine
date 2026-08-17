import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { AttachedDon } from './AttachedDon';
import { CardTile } from './CardTile';
import styles from './CharacterRow.module.css';

const SLOT_COUNT = 5;

interface CharacterRowProps {
  ids: readonly InstanceId[];
  mine: boolean;
  /** How many DON!! each of these carries. Absent means none. */
  attachedDon: Readonly<Record<InstanceId, number>>;
}

export function CharacterRow({ ids, mine, attachedDon }: CharacterRowProps): ReactElement {
  return (
    <div className={styles.row}>
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const id = ids[i];
        // The square slot is the cell, not the card: a rested Character rotates
        // inside it and the row does not move. See `--slot` in tokens.css.
        return (
          <div key={id ?? `empty-${i}`} className={styles.slot}>
            {id === undefined ? (
              <div className={styles.empty} />
            ) : (
              <>
                <AttachedDon count={attachedDon[id] ?? 0} />
                <CardTile id={id} zone="field" mine={mine} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
