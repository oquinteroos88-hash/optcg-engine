// @vitest-environment jsdom
//
// The four things a networked board shows that a local one never had to: the
// lobby, a hand of backs that can be *chosen from*, the rival deciding, and a
// dropped socket that costs the player nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { applyAction, playerView, redactLog, legalActions } from '@optcg/engine';
import type { GameState, PlayerId, PlayerView } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { buildScenario, characterAt } from '@optcg/engine/testdata/scenarios';
import { PROTOCOL_VERSION, SERVER_ERRORS } from '@optcg/server/protocol';
import type { ServerToClient } from '@optcg/server/protocol';
import { NetStatus } from '../src/components/NetStatus';
import type { SocketFactory, SocketLike } from '../src/net/connection';
import { receive } from '../src/net/connection';
import { GameScreen } from '../src/screens/GameScreen';
import { LobbyScreen } from '../src/screens/LobbyScreen';
import { messagesFor } from '../src/i18n';
import { useStore } from '../src/store/store';

/** The suites run in Spanish — see `tests/setup.ts`. */
const m = messagesFor('es');

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** Puts a state on screen the way the server would: as one seat's payload. */
function loadAsNetwork(state: GameState, seat: PlayerId): PlayerView {
  const view = playerView(state, seat);
  useStore.setState({ screen: 'playing', mode: 'network', gameState: null });
  useStore.getState().netStart('m');
  useStore.getState().netJoined({
    seat,
    view,
    journal: [redactLog(state, seat)],
    actions: legalActions(state, seat),
  });
  return view;
}

afterEach(() => {
  cleanup();
  useStore.getState().toSetup();
});

// ---------------------------------------------------------------------------

describe('the lobby', () => {
  /** A socket that answers whatever the test tells it to. */
  function scriptedFactory(reply: ServerToClient | null): {
    factory: SocketFactory;
    sent: string[];
  } {
    const sent: string[] = [];
    const factory: SocketFactory = () => {
      const socket: SocketLike = {
        send: (data: string) => {
          sent.push(data);
          if (reply !== null) {
            queueMicrotask(() => socket.onmessage?.call(socket, { data: JSON.stringify(reply) }));
          }
        },
        close: () => undefined,
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      queueMicrotask(() => socket.onopen?.call(socket, {}));
      return socket;
    };
    return { factory, sent };
  }

  it('creates a match and shows the code to hand over', async () => {
    const { factory, sent } = scriptedFactory({
      type: 'created',
      protocol: PROTOCOL_VERSION,
      matchId: 'match-7',
      tokens: { p1: 'seat-one', p2: 'seat-two' },
    });
    render(<LobbyScreen socketFactory={factory} onBack={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Crear partida' }));
    await screen.findByText(/match-7/);
    // The invitation is the opponent's token, and the creator keeps their own.
    expect(screen.getByText(/seat-two/)).toBeDefined();
    expect(screen.queryByText(/seat-one/)).toBeNull();
    const create = JSON.parse(sent[0] ?? '{}') as Record<string, unknown>;
    expect(create['type']).toBe('create');
    expect(create['protocol']).toBe(PROTOCOL_VERSION);
  });

  it('says what went wrong when the server refuses', async () => {
    const { factory } = scriptedFactory({ type: 'error', code: SERVER_ERRORS.unknownDeck });
    render(<LobbyScreen socketFactory={factory} onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear partida' }));
    const alert = await screen.findByRole('alert');
    // The code travels; the sentence is chosen here. What the player reads is
    // the Spanish for that code, never the code itself.
    expect(alert.textContent).toContain(m.serverError[SERVER_ERRORS.unknownDeck]);
    expect(alert.textContent).not.toContain(SERVER_ERRORS.unknownDeck);
  });

  it('will not join with half an invitation', () => {
    const { factory } = scriptedFactory(null);
    render(<LobbyScreen socketFactory={factory} onBack={() => undefined} />);
    const join = screen.getByRole('button', { name: 'Unirse' });
    expect(join.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Partida'), { target: { value: 'm' } });
    expect(join.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Código de asiento'), { target: { value: 't' } });
    expect(join.hasAttribute('disabled')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('choosing from cards you cannot see', () => {
  /** p1 kills p2's Scavenger; its [On K.O.] has p1 choose from p2's hand. */
  function blindChoice(): GameState {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
    });
    let state = staged;
    for (const action of [
      {
        type: 'DECLARE_ATTACK' as const,
        player: 'p1' as const,
        attacker: characterAt(staged, 'p1', 0),
        target: characterAt(staged, 'p2', 0),
      },
      { type: 'PASS' as const, player: 'p2' as const },
      { type: 'PASS' as const, player: 'p2' as const },
    ]) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(result.reason);
      }
      state = result.state;
    }
    return state;
  }

  it('draws one back per candidate, names none of them, and answers by handle', () => {
    const state = blindChoice();
    const view = loadAsNetwork(state, 'p1');
    const hand = state.players.p2.hand;
    render(<GameScreen />);

    const dialog = screen.getByRole('dialog', { name: 'Elección' });
    const backs = within(dialog).getAllByRole('button', { name: /^Carta oculta/ });
    expect(backs).toHaveLength(hand.length);
    // Not one id of that hand is anywhere on the screen or in the payload.
    for (const id of hand) {
      expect(document.body.innerHTML).not.toContain(id);
      expect(JSON.stringify(view)).not.toContain(`"${id}"`);
    }
    // And the overlay says why there is nothing to enlarge, rather than
    // leaving a hole where every other choice shows a card.
    expect(within(dialog).getByText(m.choice.blindNote)).toBeDefined();

    // Picking one is picking a position; confirming sends handles.
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(backs[1] ?? backs[0]!);
    expect(useStore.getState().ui.mode).toMatchObject({ kind: 'answeringChoice', handles: [1] });
    expect(within(dialog).getByRole('button', { name: 'Confirmar' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('sends a handles answer, never an id', () => {
    const state = blindChoice();
    loadAsNetwork(state, 'p1');
    const sent: unknown[] = [];
    // The dispatch sink is what the socket would be; capturing it is how the
    // shape of the answer is checked without a server in the room.
    const store = useStore.getState();
    useStore.setState({
      ...store,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      dispatch: (action) => {
        sent.push(action);
      },
    });
    render(<GameScreen />);
    const dialog = screen.getByRole('dialog', { name: 'Elección' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /^Carta oculta/ })[0]!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(sent).toEqual([
      {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: state.pending?.id,
        answer: { kind: 'handles', selected: [0] },
      },
    ]);
  });

  it('tells the other seat that somebody is deciding, and nothing else', () => {
    const state = blindChoice();
    loadAsNetwork(state, 'p2');
    render(<GameScreen />);
    // Kind and player. Never between what — the redacted pending has no
    // candidates to leak, so the board has none to draw.
    expect(screen.getByText(/Jugador 1 está decidiendo/)).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'Elección' })).toBeNull();
    const aff = useStore.getState().affordances;
    expect(aff?.global.canConcede).toBe(true);
    expect(aff?.global.mustAnswerChoice).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('raises a banner that promises the history back, and clears it on return', () => {
    const state = buildScenario({ decks });
    loadAsNetwork(state, 'p1');
    render(<NetStatus />);
    // Open: nothing to say.
    expect(screen.queryByRole('status')).toBeNull();

    act(() => useStore.getState().netStatus('lost'));
    expect(screen.getByRole('status').textContent).toBe(m.net.lost);

    act(() => useStore.getState().netStatus('open'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a terminal refusal as itself, not as a retry', () => {
    const state = buildScenario({ decks });
    loadAsNetwork(state, 'p1');
    render(<NetStatus />);
    act(() => receive({ type: 'error', code: SERVER_ERRORS.badToken }));
    expect(screen.getByRole('status').textContent).toContain('código de asiento');
  });

  it('shows a rejection as a notice the next update clears', () => {
    const state = buildScenario({ decks });
    const view = loadAsNetwork(state, 'p1');
    render(<NetStatus />);
    act(() => receive({ type: 'rejected', reason: 'notYourPriority' }));
    // Same rule on the engine's own reason codes: the wire carries
    // `notYourPriority`, the player reads a sentence.
    expect(screen.getByRole('alert').textContent).toBe(
      m.net.rejected(m.reason.notYourPriority),
    );

    act(() => receive({ type: 'update', view, events: [], actions: legalActions(state, 'p1') }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
