import type { ReactElement } from 'react';
import { playerLabel, useGameOver } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './GameOverOverlay.module.css';

const REASON_LABELS: Record<'lifeOut' | 'deckOut' | 'concede', string> = {
  lifeOut: 'se quedó sin vida',
  deckOut: 'se quedó sin mazo',
  concede: 'se rindió',
};

export function GameOverOverlay(): ReactElement | null {
  const gameOver = useGameOver();
  const rematch = useStore((s) => s.rematch);
  const toSetup = useStore((s) => s.toSetup);

  if (gameOver === null) {
    return null;
  }
  const loser = gameOver.winner === 'p1' ? 'p2' : 'p1';

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>Gana {playerLabel(gameOver.winner)}</h2>
        <p className={styles.reason}>
          {playerLabel(loser)} {REASON_LABELS[gameOver.endReason]}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={rematch}>
            Revancha (misma semilla)
          </button>
          <button type="button" className={styles.secondary} onClick={toSetup}>
            Nueva partida
          </button>
        </div>
      </div>
    </div>
  );
}
