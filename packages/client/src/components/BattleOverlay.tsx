import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useBattleView, useGlobalAffordances } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './BattleOverlay.module.css';

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
  const m = useMessages();
  const pass = useStore((s) => s.pass);

  if (battle === null) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <span className={styles.step}>{m.battle.step[battle.step]}</span>
        <div className={styles.matchup}>
          <div className={styles.side}>
            <span className={styles.role}>
              {m.battle.attacks(playerLabel(battle.attackerOwner, m))}
            </span>
            {/* Card names are never translated: the art prints them in English
                and so does this. */}
            <span className={styles.name}>{battle.attackerName ?? m.common.hiddenCard}</span>
            <span className={styles.power}>{battle.attackerPower}</span>
          </div>
          <span className={styles.arrow} aria-hidden="true">
            ↓
          </span>
          <div className={styles.side}>
            <span className={styles.role}>
              {m.battle.defends(playerLabel(battle.defender, m))}
              {battle.wasBlocked ? m.battle.blocked : ''}
            </span>
            <span className={styles.name}>{battle.targetName ?? m.common.hiddenCard}</span>
            <span className={styles.power}>{battle.targetPower}</span>
          </div>
        </div>
        {global.canPass ? (
          <button type="button" className={styles.pass} onClick={pass}>
            {battle.step === 'block' ? m.battle.dontBlock : m.battle.dontCounter}
          </button>
        ) : null}
      </div>
    </div>
  );
}
