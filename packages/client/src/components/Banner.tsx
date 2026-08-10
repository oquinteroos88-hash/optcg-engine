import type { ReactElement } from 'react';
import { playerLabel, useBanner } from '../store/selectors';
import type { PhaseKey } from '../store/selectors';
import styles from './Banner.module.css';

const PHASE_LABELS: Record<PhaseKey, string> = {
  mulligan: 'Mulligan',
  main: 'Fase principal',
  blockStep: 'Paso de bloqueo',
  counterStep: 'Paso de contraataque',
  finished: 'Partida terminada',
};

export function Banner(): ReactElement | null {
  const banner = useBanner();
  if (banner === null) {
    return null;
  }
  return (
    <div className={styles.banner}>
      <span className={styles.turn}>
        Turno de {playerLabel(banner.activePlayer)} — {PHASE_LABELS[banner.phase]}
      </span>
      {/* The choice label wins: a [Trigger] is answered by the damaged player,
          who is not "responding" to a battle in any sense they would recognise. */}
      {banner.choiceOpen ? (
        <span className={styles.defender}>{playerLabel(banner.priority)} decide un efecto</span>
      ) : banner.defenderResponds ? (
        <span className={styles.defender}>{playerLabel(banner.priority)} responde</span>
      ) : null}
      {banner.phase === 'finished' && banner.winner !== null ? (
        <span className={styles.winner}>Gana {playerLabel(banner.winner)}</span>
      ) : null}
    </div>
  );
}
