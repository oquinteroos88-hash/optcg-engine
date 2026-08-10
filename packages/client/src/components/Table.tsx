import type { ReactElement } from 'react';
import { useStore } from '../store/store';
import { SideBoard } from './SideBoard';
import styles from './Table.module.css';

export function Table(): ReactElement | null {
  const activePlayer = useStore((s) => s.gameState?.activePlayer ?? null);
  const uiEvent = useStore((s) => s.uiEvent);

  if (activePlayer === null) {
    return null;
  }
  // Board orientation follows the active player: their side is the bottom half.
  // The top half mirrors the ORDER of its rows and rotates nothing, so both
  // Character areas face the centre line and every label stays readable.
  const opponent = activePlayer === 'p1' ? 'p2' : 'p1';
  return (
    <div className={styles.table} onClick={() => uiEvent({ kind: 'clickEmpty' })}>
      <SideBoard player={opponent} mirrored />
      <div className={styles.divider} />
      <SideBoard player={activePlayer} mirrored={false} />
    </div>
  );
}
