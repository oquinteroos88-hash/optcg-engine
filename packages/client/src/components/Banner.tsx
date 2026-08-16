import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useBanner } from '../store/selectors';

import styles from './Banner.module.css';

export function Banner(): ReactElement | null {
  const banner = useBanner();
  const m = useMessages();
  if (banner === null) {
    return null;
  }
  return (
    <div className={styles.banner}>
      <span className={styles.turn}>
        {m.board.turnOf(playerLabel(banner.activePlayer, m))} — {m.board.phase[banner.phase]}
      </span>
      {/* The choice label wins: a [Trigger] is answered by the damaged player,
          who is not "responding" to a battle in any sense they would recognise. */}
      {banner.choiceOpen ? (
        <span className={styles.defender}>
          {m.board.decidesEffect(playerLabel(banner.priority, m))}
        </span>
      ) : banner.defenderResponds ? (
        <span className={styles.defender}>{m.board.responds(playerLabel(banner.priority, m))}</span>
      ) : null}
      {banner.phase === 'finished' && banner.winner !== null ? (
        <span className={styles.winner}>{m.board.wins(playerLabel(banner.winner, m))}</span>
      ) : null}
    </div>
  );
}
