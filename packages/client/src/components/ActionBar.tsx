import type { ReactElement } from 'react';
import { useGlobalAffordances, useInputBlocked } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './ActionBar.module.css';

export function ActionBar(): ReactElement {
  const global = useGlobalAffordances();
  const blocked = useInputBlocked();
  const pass = useStore((s) => s.pass);
  const endTurn = useStore((s) => s.endTurn);
  const concede = useStore((s) => s.concede);
  const toggleVeil = useStore((s) => s.toggleVeil);
  const veilOpponentHand = useStore((s) => s.ui.veilOpponentHand);

  return (
    <div className={styles.bar}>
      {global.canPass ? (
        <button type="button" className={styles.button} onClick={pass} disabled={blocked}>
          Pasar
        </button>
      ) : null}
      {global.canEndTurn ? (
        <button type="button" className={styles.button} onClick={endTurn} disabled={blocked}>
          Terminar turno
        </button>
      ) : null}
      <div className={styles.spacer} />
      <label className={styles.toggle}>
        <input type="checkbox" checked={veilOpponentHand} onChange={toggleVeil} />
        Velar mano rival
      </label>
      {global.canConcede ? (
        <button type="button" className={styles.danger} onClick={concede} disabled={blocked}>
          Rendirse
        </button>
      ) : null}
    </div>
  );
}
