import type { ReactElement } from 'react';
import { useNetwork, useNotice, useOpponentChoosing, playerLabel } from '../store/selectors';
import styles from './NetStatus.module.css';

const ERROR_TEXT: Record<string, string> = {
  protocolMismatch: 'El servidor habla otra versión del protocolo. Actualizá el cliente.',
  unknownMatch: 'Esa partida no existe en el servidor.',
  badToken: 'Ese código de asiento no es válido para esta partida.',
  seatMismatch: 'Ese movimiento era del otro asiento.',
  notJoined: 'Todavía no entraste a la partida.',
  malformedMessage: 'El servidor no entendió el mensaje.',
  unknownDeck: 'El servidor no conoce ese mazo.',
};

const CHOICE_KIND_TEXT: Record<string, string> = {
  selectCards: 'elegir cartas',
  yesNo: 'responder sí o no',
  selectOption: 'elegir una opción',
  orderCards: 'ordenar cartas',
  partitionCards: 'repartir cartas entre los extremos del mazo',
};

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
 */
export function NetStatus(): ReactElement | null {
  const net = useNetwork();
  const notice = useNotice();
  const opponent = useOpponentChoosing();

  if (net === null && notice === null && opponent === null) {
    return null;
  }

  return (
    <div className={styles.bar}>
      {net !== null && net.status !== 'open' ? (
        <span className={styles.offline} role="status">
          {net.error === null
            ? net.status === 'connecting'
              ? 'Conectando…'
              : 'Se cortó la conexión. Reintentando… No perdés nada: al volver vas a ver todo lo que pasó.'
            : (ERROR_TEXT[net.error] ?? `Error del servidor: ${net.error}`)}
        </span>
      ) : null}

      {opponent === null ? null : (
        <span className={styles.waiting} role="status">
          {playerLabel(opponent.player)} está decidiendo (
          {CHOICE_KIND_TEXT[opponent.kind] ?? opponent.kind})
        </span>
      )}

      {notice === null ? null : (
        <span className={styles.notice} role="alert">
          El servidor rechazó esa jugada: {notice}
        </span>
      )}
    </div>
  );
}
