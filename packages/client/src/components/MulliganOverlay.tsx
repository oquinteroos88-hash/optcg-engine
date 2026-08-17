import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
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
  const m = useMessages();
  const answerMulligan = useStore((s) => s.answerMulligan);

  if (view === null) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>{m.mulligan.title(playerLabel(view.player, m))}</h2>
        <p className={styles.hint}>{m.mulligan.hint}</p>
        {/*
          The opening hand, overlapped rather than laid out in a row.

          Five cards side by side is wider than a phone, and the dialog grew
          until the buttons were off-screen — you could not answer the mulligan
          at all. They now sit in a fan that fits any width, and each one comes
          forward when you point at it: hover on a mouse, `:focus-within` on a
          keyboard, and hold-to-enlarge on a finger, which is the gesture this
          board already uses everywhere else.
        */}
        <div className={styles.hand}>
          {view.hand.map((id, index) => (
            <div key={id} className={styles.slot} style={{ zIndex: index }}>
              <CardTile id={id} zone="hand" mine />
            </div>
          ))}
        </div>
        <p className={styles.peekHint}>{m.mulligan.peek}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.keep} onClick={() => answerMulligan(false)}>
            {m.mulligan.keep}
          </button>
          <button type="button" className={styles.redraw} onClick={() => answerMulligan(true)}>
            {m.mulligan.mulligan}
          </button>
        </div>
      </div>
    </div>
  );
}
