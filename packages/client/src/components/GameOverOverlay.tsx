import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useGameOver } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './GameOverOverlay.module.css';

export function GameOverOverlay(): ReactElement | null {
  const gameOver = useGameOver();
  const m = useMessages();
  const rematch = useStore((s) => s.rematch);
  const toSetup = useStore((s) => s.toSetup);

  if (gameOver === null) {
    return null;
  }
  const loser = gameOver.winner === 'p1' ? 'p2' : 'p1';

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>{m.gameOver.title(playerLabel(gameOver.winner, m))}</h2>
        <p className={styles.reason}>
          {m.gameOver.reason(playerLabel(loser, m), gameOver.endReason)}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={rematch}>
            {m.gameOver.rematch}
          </button>
          <button type="button" className={styles.secondary} onClick={toSetup}>
            {m.gameOver.newGame}
          </button>
        </div>
      </div>
    </div>
  );
}
