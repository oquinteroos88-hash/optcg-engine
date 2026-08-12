import type { ReactElement } from 'react';
import { playerLabel, useBattleView, useGlobalAffordances } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './BattleOverlay.module.css';

const STEP_LABELS: Record<'attack' | 'block' | 'counter' | 'damage', string> = {
  attack: 'Paso de ataque',
  block: 'Paso de bloqueo',
  counter: 'Paso de contraataque',
  damage: 'Paso de daño',
};

/**
 * Renders straight off `state.battle` — never queue-driven — so the powers it
 * shows are the live ones and update the moment a counter resolves.
 *
 * It lives in the left rail rather than floating over the table. Centred on the
 * viewport it covered both Character rows, which is exactly what the defender
 * has to look at and click during the Block Step.
 */
export function BattleOverlay(): ReactElement | null {
  const battle = useBattleView();
  const global = useGlobalAffordances();
  const pass = useStore((s) => s.pass);

  if (battle === null) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <span className={styles.step}>{STEP_LABELS[battle.step]}</span>
        <div className={styles.matchup}>
          <div className={styles.side}>
            <span className={styles.role}>Ataca · {playerLabel(battle.attackerOwner)}</span>
            <span className={styles.name}>{battle.attackerName}</span>
            <span className={styles.power}>{battle.attackerPower}</span>
          </div>
          <span className={styles.arrow} aria-hidden="true">
            ↓
          </span>
          <div className={styles.side}>
            <span className={styles.role}>
              Defiende · {playerLabel(battle.defender)}
              {battle.wasBlocked ? ' (bloqueado)' : ''}
            </span>
            <span className={styles.name}>{battle.targetName}</span>
            <span className={styles.power}>{battle.targetPower}</span>
          </div>
        </div>
        {global.canPass ? (
          <button type="button" className={styles.pass} onClick={pass}>
            {battle.step === 'block' ? 'No bloquear' : 'No contraatacar'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
