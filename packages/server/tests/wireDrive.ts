import type { GameState, PlayerId } from '@optcg/engine';
import { blindHandleOrder } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { GameServer } from '../src/transport.js';
import type { TestClient } from './wsHelpers.js';

/**
 * Plays a match out over the wire with the shared test policy — `driveMatch`'s
 * loop with two real sockets in the middle. Decisions are made from the
 * server's own state (`getMatch`), which a test may read and a client never
 * can; blind choices are answered by handle, the multiplayer alphabet. Every
 * accepted action is awaited as an `update` on both sockets, so the loop is
 * also the proof that both seats kept receiving to the end.
 *
 * Returns the number of accepted actions, which is what a rate or a sweep
 * count is measured in.
 */
export async function playOut(
  server: GameServer,
  matchId: string,
  clients: Record<PlayerId, TestClient>,
  seed: number,
  opts: {
    /** Runs before every legitimate action with the state it will be decided
     * from — the adversary's slot, where an attack fits between two honest
     * moves. It must drain whatever replies it provoked before returning. */
    beforeStep?: (game: GameState) => Promise<void>;
  } = {},
): Promise<number> {
  let decision = 0;
  let accepted = 0;
  for (let step = 0; step < 1_500; step += 1) {
    const game = server.getMatch(matchId)?.game;
    if (game === undefined) {
      throw new Error(`match ${matchId} vanished mid-game`);
    }
    if (game.status === 'finished') {
      return accepted;
    }
    if (opts.beforeStep !== undefined) {
      await opts.beforeStep(game);
    }
    const player = game.priority;
    let action = decide(game, player, seed, decision);
    decision += 1;
    if (action === undefined) {
      throw new Error(`no action for ${player} in a live game`);
    }
    const pending = game.pending;
    if (
      pending !== null &&
      pending.blind === true &&
      action.type === 'ANSWER_CHOICE' &&
      action.answer?.kind === 'cards'
    ) {
      const order = blindHandleOrder(pending.id, pending.candidates);
      const selected = action.answer.selected.map((id) => order.indexOf(id));
      action = { ...action, answer: { kind: 'handles', selected } };
    }
    clients[player].send({ type: 'action', action });
    await clients.p1.expect('update');
    await clients.p2.expect('update');
    accepted += 1;
  }
  throw new Error('the match did not finish within 1,500 actions');
}
