import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { CardTile } from './CardTile';
import styles from './HandRow.module.css';

interface HandRowProps {
  ids: readonly InstanceId[];
  mine: boolean;
  /** Face-down rendering for the opponent's hand. */
  veiled?: boolean;
}

export function HandRow({ ids, mine, veiled = false }: HandRowProps): ReactElement {
  return (
    <div className={styles.hand}>
      <span className={styles.label}>Mano ({ids.length})</span>
      <div className={styles.cards}>
        {ids.map((id) => (
          <CardTile key={id} id={id} zone="hand" mine={mine} veiled={veiled} />
        ))}
      </div>
    </div>
  );
}
