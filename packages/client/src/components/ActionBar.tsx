import type { ReactElement } from 'react';
import { useCondensedLayout } from '../game/layout';
import { useMessages } from '../i18n/useMessages';
import { useGlobalAffordances, useInputBlocked } from '../store/selectors';
import { useStore } from '../store/store';
import { LanguagePicker } from './LanguagePicker';
import { PlaymatPicker } from './PlaymatPicker';
import styles from './ActionBar.module.css';

export function ActionBar(): ReactElement {
  const global = useGlobalAffordances();
  const blocked = useInputBlocked();
  const m = useMessages();
  const endTurn = useStore((s) => s.endTurn);
  const concede = useStore((s) => s.concede);
  const toggleVeil = useStore((s) => s.toggleVeil);
  const veilOpponentHand = useStore((s) => s.ui.veilOpponentHand);
  const compact = useCondensedLayout();

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
      {/*
        The settings, and only where there is room for them.

        On a phone this bar was 512px wide in a 375px viewport: the three
        controls did not wrap, the document grew, and every `position: fixed`
        overlay centred itself against a box wider than the screen — which is
        why the mulligan and the card menu were sitting half off-screen. The
        board is what a player came for and the phone has room for the board.

        Nothing is lost. The language picker is on the setup screen and in the
        lobby, which is where a language gets chosen; the mat is cosmetic and
        per seat; and the veil is a hot-seat courtesy for two people sharing one
        screen, which is not what a phone in one person's hand is.
      */}
      {compact ? null : (
        <>
          {/* Mid-match, and never disabled by the animation queue: the language
              is presentation, so changing it is not a move and cannot be
              blocked by one. Two seats can read the same match in two
              languages. */}
          <LanguagePicker />
          {/* Same reasoning, one shelf down: a mat is paint. */}
          <PlaymatPicker />
          <label className={styles.toggle}>
            <input type="checkbox" checked={veilOpponentHand} onChange={toggleVeil} />
            {m.board.veilOpponentHand}
          </label>
        </>
      )}
      {global.canConcede ? (
        <button type="button" className={styles.danger} onClick={concede} disabled={blocked}>
          {m.board.concede}
        </button>
      ) : null}
    </div>
  );
}
