import { useState } from 'react';
import type { ReactElement } from 'react';
import type { PlayerId } from '@optcg/engine';
import { DECK_CATALOG, deckName } from '../game/decks';
import { useMessages } from '../i18n/useMessages';
import { LanguagePicker } from '../components/LanguagePicker';
import { useStore } from '../store/store';
import styles from './SetupScreen.module.css';

const DEFAULT_DECK_P1 = DECK_CATALOG[0]?.id ?? 'red';
const DEFAULT_DECK_P2 = DECK_CATALOG[1]?.id ?? 'green';

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

interface SetupProps {
  /** Opens the network lobby. Hot-seat stays exactly what it was. */
  onNetwork: () => void;
}

export function SetupScreen({ onNetwork }: SetupProps): ReactElement {
  const newGame = useStore((s) => s.newGame);
  const m = useMessages();
  const [seed, setSeed] = useState<number>(randomSeed);
  const [deckIdP1, setDeckIdP1] = useState<string>(DEFAULT_DECK_P1);
  const [deckIdP2, setDeckIdP2] = useState<string>(DEFAULT_DECK_P2);
  const [firstPlayer, setFirstPlayer] = useState<PlayerId>('p1');

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h1 className={styles.title}>{m.setup.title}</h1>

        {/* First control on the first screen: a player who cannot read the rest
            of this panel has to be able to fix that before anything else. */}
        <LanguagePicker />

        <label className={styles.field}>
          <span>{m.setup.seed}</span>
          <div className={styles.seedRow}>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
            <button type="button" onClick={() => setSeed(randomSeed())}>
              {m.setup.randomSeed}
            </button>
          </div>
        </label>

        <label className={styles.field}>
          <span>{m.setup.deckP1}</span>
          <select value={deckIdP1} onChange={(e) => setDeckIdP1(e.target.value)}>
            {DECK_CATALOG.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {deckName(entry, m)}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>{m.setup.deckP2}</span>
          <select value={deckIdP2} onChange={(e) => setDeckIdP2(e.target.value)}>
            {DECK_CATALOG.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {deckName(entry, m)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={styles.field}>
          <legend>{m.setup.firstPlayer}</legend>
          <label className={styles.radio}>
            <input
              type="radio"
              name="firstPlayer"
              checked={firstPlayer === 'p1'}
              onChange={() => setFirstPlayer('p1')}
            />
            {m.common.playerOne}
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="firstPlayer"
              checked={firstPlayer === 'p2'}
              onChange={() => setFirstPlayer('p2')}
            />
            {m.common.playerTwo}
          </label>
        </fieldset>

        <button
          type="button"
          className={styles.play}
          onClick={() => newGame({ seed, deckIdP1, deckIdP2, firstPlayer })}
        >
          {m.setup.play}
        </button>

        <button type="button" className={styles.network} onClick={onNetwork}>
          {m.setup.network}
        </button>
      </div>
    </div>
  );
}
