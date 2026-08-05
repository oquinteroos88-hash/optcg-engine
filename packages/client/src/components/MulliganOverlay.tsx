import type { ReactElement } from 'react';
import { playerLabel, useMulliganView } from '../store/selectors';
import { useStore } from '../store/store';
import { CardTile } from './CardTile';
import styles from './MulliganOverlay.module.css';

/**
 * Sequential by priority: it re-renders for the second player as soon as the
 * first one answers, so the hand shown is never a hardcoded side.
 */
export function MulliganOverlay(): ReactElement | null {
  const view = useMulliganView();
  const answerMulligan = useStore((s) => s.answerMulligan);

  if (view === null) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>{playerLabel(view.player)} — ¿mulligan?</h2>
        <p className={styles.hint}>
          Mirá tu mano inicial. Si tomás mulligan, devolvés estas 5 cartas y robás 5 nuevas.
        </p>
        <div className={styles.hand}>
          {view.hand.map((id) => (
            <CardTile key={id} id={id} zone="hand" mine />
          ))}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.keep} onClick={() => answerMulligan(false)}>
            Quedarme
          </button>
          <button type="button" className={styles.redraw} onClick={() => answerMulligan(true)}>
            Mulligan
          </button>
        </div>
      </div>
    </div>
  );
}
