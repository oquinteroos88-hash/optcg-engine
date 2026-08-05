import { useState } from 'react';
import type { ReactElement } from 'react';
import type { PlayerId } from '@optcg/engine';
import { DECK_CATALOG } from '../game/decks';
import { useStore } from '../store/store';
import styles from './SetupScreen.module.css';

const DEFAULT_DECK_P1 = DECK_CATALOG[0]?.id ?? 'red';
const DEFAULT_DECK_P2 = DECK_CATALOG[1]?.id ?? 'green';

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function SetupScreen(): ReactElement {
  const newGame = useStore((s) => s.newGame);
  const [seed, setSeed] = useState<number>(randomSeed);
  const [deckIdP1, setDeckIdP1] = useState<string>(DEFAULT_DECK_P1);
  const [deckIdP2, setDeckIdP2] = useState<string>(DEFAULT_DECK_P2);
  const [firstPlayer, setFirstPlayer] = useState<PlayerId>('p1');

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Nueva partida</h1>

        <label className={styles.field}>
          <span>Semilla</span>
          <div className={styles.seedRow}>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
            <button type="button" onClick={() => setSeed(randomSeed())}>
              Aleatoria
            </button>
          </div>
        </label>

        <label className={styles.field}>
          <span>Mazo Jugador 1</span>
          <select value={deckIdP1} onChange={(e) => setDeckIdP1(e.target.value)}>
            {DECK_CATALOG.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Mazo Jugador 2</span>
          <select value={deckIdP2} onChange={(e) => setDeckIdP2(e.target.value)}>
            {DECK_CATALOG.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={styles.field}>
          <legend>Primer jugador</legend>
          <label className={styles.radio}>
            <input
              type="radio"
              name="firstPlayer"
              checked={firstPlayer === 'p1'}
              onChange={() => setFirstPlayer('p1')}
            />
            Jugador 1
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="firstPlayer"
              checked={firstPlayer === 'p2'}
              onChange={() => setFirstPlayer('p2')}
            />
            Jugador 2
          </label>
        </fieldset>

        <button
          type="button"
          className={styles.play}
          onClick={() => newGame({ seed, deckIdP1, deckIdP2, firstPlayer })}
        >
          Jugar
        </button>
      </div>
    </div>
  );
}
