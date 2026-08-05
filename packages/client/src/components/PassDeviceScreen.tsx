import type { ReactElement } from 'react';
import { config } from '../config';
import { playerLabel, useNeedsHandoff } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './PassDeviceScreen.module.css';

/**
 * Hot-seat privacy curtain, off by default (config.passDeviceScreen). When on,
 * it interposes every time priority moves to the other player.
 */
export function PassDeviceScreen(): ReactElement | null {
  const nextPlayer = useNeedsHandoff();
  const ackDevice = useStore((s) => s.ackDevice);

  if (!config.passDeviceScreen || nextPlayer === null) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>Pasá el dispositivo a {playerLabel(nextPlayer)}</h2>
        <p className={styles.hint}>Cuando lo tengas en mano, tocá “Listo” para ver tu posición.</p>
        <button type="button" className={styles.ready} onClick={ackDevice}>
          Listo
        </button>
      </div>
    </div>
  );
}
