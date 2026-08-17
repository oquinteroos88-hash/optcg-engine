import type { ReactElement } from 'react';
import type { PlayerId } from '@optcg/engine';
import { useAssetManifest } from '../game/assets';
import { BUILTIN_PLAYMATS } from '../game/playmat';
import { useMessages } from '../i18n/useMessages';
import { playerLabel } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './PlaymatPicker.module.css';

/**
 * The mat control, one select per seat.
 *
 * **Local and cosmetic, and that is the whole design** — the same rule the
 * language follows. No action is dispatched, no socket byte is written, no
 * game state is touched. The two seats of a hot-seat device can play on two
 * different mats, and across a network neither client ever learns what the
 * other one chose, because nothing about it is ever sent.
 *
 * Always offered, because there is always something to choose. The mats this
 * repository draws are a set of colours, not one grey sheet — a table is two
 * mats, and two mats that look identical are one mat with a line through it.
 * The official ones are Bandai's, are never committed, and join the list only
 * when they are found in the local directory — see `game/assets.ts`.
 */
export function PlaymatPicker(): ReactElement {
  const m = useMessages();
  const { playmats: local } = useAssetManifest();
  const chosen = useStore((s) => s.playmats);
  const setPlaymat = useStore((s) => s.setPlaymat);

  return (
    <div className={styles.picker}>
      <span className={styles.label}>{m.playmat.label}</span>
      {(['p1', 'p2'] as PlayerId[]).map((player) => (
        <select
          key={player}
          className={styles.select}
          value={chosen[player]}
          aria-label={m.playmat.forPlayer(playerLabel(player, m))}
          onChange={(e) => setPlaymat(player, e.target.value)}
        >
          {BUILTIN_PLAYMATS.map((mat) => (
            // Ours: named by colour, which is what a player would ask for.
            <option key={mat.id} value={mat.id}>
              {m.playmat.builtin[mat.id]}
            </option>
          ))}
          {local.map((mat) => (
            // The mat's own name, as the file spells it. It is not a message:
            // nothing here translates the name of somebody's artwork.
            <option key={mat.id} value={mat.id}>
              {mat.name}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
