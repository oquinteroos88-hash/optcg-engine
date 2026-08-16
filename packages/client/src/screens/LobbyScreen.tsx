import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ServerToClient } from '@optcg/server/protocol';
import { PROTOCOL_VERSION } from '@optcg/server/protocol';
import { DECK_CATALOG } from '../game/decks';
import { clearCredentials, connect, loadCredentials } from '../net/connection';
import type { SocketFactory } from '../net/connection';
import styles from './LobbyScreen.module.css';

/**
 * Two screens' worth of lobby, and no more: open a match, or take a seat in
 * one. There are no accounts and no room list — the invitation is the seat
 * token, and handing it to somebody is the whole of matchmaking.
 */

const REAL_DECKS = DECK_CATALOG.filter((entry) => entry.real);
const DEFAULT_URL = 'ws://localhost:8787';

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

interface LobbyProps {
  /** Injected by the tests, which drive a real server over a Node socket. */
  socketFactory?: SocketFactory;
  onBack: () => void;
}

interface Invitation {
  matchId: string;
  mine: string;
  theirs: string;
}

export function LobbyScreen({ socketFactory, onBack }: LobbyProps): ReactElement {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [seed, setSeed] = useState<number>(randomSeed);
  const [deckIdP1, setDeckIdP1] = useState(REAL_DECKS[0]?.id ?? '');
  const [deckIdP2, setDeckIdP2] = useState(REAL_DECKS[1]?.id ?? REAL_DECKS[0]?.id ?? '');
  const [matchId, setMatchId] = useState('');
  const [token, setToken] = useState('');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved] = useState(loadCredentials);

  // A `create` is one socket, used once: it opens the match, hands back the
  // seat tokens, and closes. The seat's own connection is a separate one, made
  // by `connect` — so nothing here has to hold a socket across a screen.
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!creating) {
      return;
    }
    const factory = socketFactory ?? ((target: string) => new WebSocket(target) as never);
    const socket = factory(url);
    socket.onopen = () => {
      socket.send(
        JSON.stringify({ type: 'create', protocol: PROTOCOL_VERSION, seed, deckIdP1, deckIdP2 }),
      );
    };
    socket.onmessage = (event: { data: unknown }) => {
      const message = JSON.parse(String(event.data)) as ServerToClient;
      setCreating(false);
      if (message.type === 'created') {
        setInvitation({
          matchId: message.matchId,
          mine: message.tokens.p1,
          theirs: message.tokens.p2,
        });
        setError(null);
      } else if (message.type === 'error') {
        setError(message.code);
      }
      socket.close();
    };
    socket.onerror = () => {
      setCreating(false);
      setError('noConnection');
    };
    return () => socket.close();
  }, [creating, url, seed, deckIdP1, deckIdP2, socketFactory]);

  const take = (id: string, seat: string): void => {
    clearCredentials();
    connect({ url, matchId: id, token: seat }, socketFactory === undefined ? {} : { socketFactory });
  };

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Jugar en red</h1>

        <label className={styles.field}>
          <span>Servidor</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Servidor" />
        </label>

        {saved === null ? null : (
          <button
            type="button"
            className={styles.resume}
            onClick={() => take(saved.matchId, saved.token)}
          >
            Volver a la partida guardada
          </button>
        )}

        <section className={styles.section} aria-label="Crear partida">
          <h2 className={styles.subtitle}>Crear partida</h2>
          <label className={styles.field}>
            <span>Tu mazo</span>
            <select
              value={deckIdP1}
              onChange={(e) => setDeckIdP1(e.target.value)}
              aria-label="Tu mazo"
            >
              {REAL_DECKS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Mazo del rival</span>
            <select
              value={deckIdP2}
              onChange={(e) => setDeckIdP2(e.target.value)}
              aria-label="Mazo del rival"
            >
              {REAL_DECKS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Semilla</span>
            <div className={styles.seedRow}>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
                aria-label="Semilla"
              />
              <button type="button" onClick={() => setSeed(randomSeed())}>
                Aleatoria
              </button>
            </div>
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={creating}
            onClick={() => setCreating(true)}
          >
            {creating ? 'Creando…' : 'Crear partida'}
          </button>

          {invitation === null ? null : (
            <div className={styles.invitation} role="status">
              <p>
                Partida <code>{invitation.matchId}</code>
              </p>
              {/* The invitation is the token. Copying it by hand is the whole
                  of the flow: no rooms, no lists, no accounts. */}
              <p className={styles.share}>
                Pasale a tu rival este código: <code>{invitation.theirs}</code>
              </p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => take(invitation.matchId, invitation.mine)}
              >
                Entrar como Jugador 1
              </button>
            </div>
          )}
        </section>

        <section className={styles.section} aria-label="Unirse a una partida">
          <h2 className={styles.subtitle}>Unirse</h2>
          <label className={styles.field}>
            <span>Partida</span>
            <input
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              aria-label="Partida"
            />
          </label>
          <label className={styles.field}>
            <span>Código de asiento</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label="Código de asiento"
            />
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={matchId === '' || token === ''}
            onClick={() => take(matchId, token)}
          >
            Unirse
          </button>
        </section>

        {error === null ? null : (
          <p className={styles.error} role="alert">
            No se pudo crear la partida: {error}
          </p>
        )}

        <button type="button" className={styles.back} onClick={onBack}>
          Volver
        </button>
      </div>
    </div>
  );
}
