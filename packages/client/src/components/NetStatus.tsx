import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { useNetwork, useNotice, useOpponentChoosing, playerLabel } from '../store/selectors';
import styles from './NetStatus.module.css';

/**
 * The three things a networked board has to say that a local one does not.
 *
 * **The socket dropped**, which is a banner and a retry rather than a lost
 * game: the seat token is saved, the connection layer is already trying, and
 * what the player gets back is everything they were sent while away.
 *
 * **The rival is deciding**, which is board state rather than an overlay. The
 * redacted `pending` says who and what kind, never between what, so that is
 * exactly what this says — and while it holds, `[CONCEDE]` is the only
 * affordance the server offers, which is CR 1-2-3 and needs no special case
 * here.
 *
 * **A move came back refused**, which with the affordances travelling should
 * not happen. A lost race still can, so it is a notice that the next update
 * clears rather than a state the player has to escape.
 *
 * **The code travels; the sentence does not.** Every string in here is chosen
 * on this device from a code the server sent — `ReasonCode` and
 * `ServerErrorCode` are stable contract, and the wire carries no prose in any
 * language. A code with no entry falls through to itself rather than to
 * silence, which is what the fallbacks are for.
 */
export function NetStatus(): ReactElement | null {
  const net = useNetwork();
  const notice = useNotice();
  const opponent = useOpponentChoosing();
  const m = useMessages();

  if (net === null && notice === null && opponent === null) {
    return null;
  }

  const serverError = net?.error ?? null;
  const errorText =
    serverError === null
      ? null
      : (m.serverError[serverError as keyof typeof m.serverError] ??
        m.net.serverErrorFallback(serverError));
  const noticeText =
    notice === null
      ? null
      : (m.reason[notice as keyof typeof m.reason] ?? notice);

  return (
    <div className={styles.bar}>
      {net !== null && net.status !== 'open' ? (
        <span className={styles.offline} role="status">
          {errorText ?? (net.status === 'connecting' ? m.net.connecting : m.net.lost)}
        </span>
      ) : null}

      {opponent === null ? null : (
        <span className={styles.waiting} role="status">
          {m.net.opponentDeciding(
            playerLabel(opponent.player, m),
            m.net.choiceKind[opponent.kind] ?? opponent.kind,
          )}
        </span>
      )}

      {noticeText === null ? null : (
        <span className={styles.notice} role="alert">
          {m.net.rejected(noticeText)}
        </span>
      )}
    </div>
  );
}
