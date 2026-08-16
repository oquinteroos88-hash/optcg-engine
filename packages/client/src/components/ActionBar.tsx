import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { useGlobalAffordances, useInputBlocked } from '../store/selectors';
import { useStore } from '../store/store';
import { LanguagePicker } from './LanguagePicker';
import styles from './ActionBar.module.css';

export function ActionBar(): ReactElement {
  const global = useGlobalAffordances();
  const blocked = useInputBlocked();
  const m = useMessages();
  const endTurn = useStore((s) => s.endTurn);
  const concede = useStore((s) => s.concede);
  const toggleVeil = useStore((s) => s.toggleVeil);
  const veilOpponentHand = useStore((s) => s.ui.veilOpponentHand);

  return (
    <div className={styles.bar}>
      {/* There is no generic pass control: PASS is battle-only in the engine, so
          canPass is true exactly while a battle is open, and the BattleOverlay
          owns the contextual button for both of its steps. See the invariant
          asserted in tests/affordances.forward.test.ts. */}
      {global.canEndTurn ? (
        <button type="button" className={styles.button} onClick={endTurn} disabled={blocked}>
          {m.board.endTurn}
        </button>
      ) : null}
      <div className={styles.spacer} />
      {/* Mid-match, and never disabled by the animation queue: the language is
          presentation, so changing it is not a move and cannot be blocked by
          one. Two seats can read the same match in two languages. */}
      <LanguagePicker />
      <label className={styles.toggle}>
        <input type="checkbox" checked={veilOpponentHand} onChange={toggleVeil} />
        {m.board.veilOpponentHand}
      </label>
      {global.canConcede ? (
        <button type="button" className={styles.danger} onClick={concede} disabled={blocked}>
          {m.board.concede}
        </button>
      ) : null}
    </div>
  );
}
