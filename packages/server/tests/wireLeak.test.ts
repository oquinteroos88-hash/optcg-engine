import { describe, expect, it } from 'vitest';
import { PLAYER_IDS } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import { rejoinPayload } from '../src/session.js';
import { driveMatch, payloadLeaks } from './helpers.js';

/**
 * The #43 arbiter, pointed at the wire. That one proved `playerView`; this
 * one proves **everything the server emits**: every update payload to every
 * seat over full sweep games, every injected rejection, and the reconnection
 * payload with its whole journal — all searched for forbidden ids, with the
 * unknown list computed from the opposite side (secret zones minus the raw
 * `knownBy`), never through the machinery under test.
 *
 * Sabotaged once during construction to prove the arbiter bites: emitting
 * unredacted events from the session produced findings on the first seed
 * (see the PR report for the count) before the revert.
 */

describe('nothing the server emits leaks', () => {
  it('holds for every payload of the ability sweep, rejections included', { timeout: 240_000 }, () => {
    const leaks: string[] = [];
    for (let seed = 1; seed <= 8; seed += 1) {
      const run = driveMatch(seed, { p1: ABIL_DECK, p2: ABIL_DECK }, { injectRejections: true });
      for (const { seat, payload, state } of run.emissions) {
        for (const leak of payloadLeaks(state, seat, payload)) {
          leaks.push(`seed ${seed}: update — ${leak}`);
        }
      }
      for (const { seat, reason, state } of run.rejections) {
        for (const leak of payloadLeaks(state, seat, { type: 'rejected', reason })) {
          leaks.push(`seed ${seed}: rejection — ${leak}`);
        }
      }
      // The reconnection payload, arbitrated the only way that is honest:
      // the **view** against the present, each **journal batch** against the
      // state it was redacted for. Checking history against final knowledge
      // would be the live-vs-re-derive divergence showing up inside the
      // arbiter itself — a batch that showed a reveal live is entitled to an
      // id a later shuffle made untrackable, because re-sending the same
      // bytes teaches a returning client nothing it did not learn live.
      for (const seat of PLAYER_IDS) {
        const rejoin = rejoinPayload(run.match, seat);
        for (const leak of payloadLeaks(run.match.game, seat, rejoin.view)) {
          leaks.push(`seed ${seed}: rejoin view — ${leak}`);
        }
        // The affordance field gets the same treatment as everything else.
        // Inside `update` it already rides along in the payload above; here it
        // is checked on its own because the rejoin payload is arbitrated part
        // by part against different states.
        for (const leak of payloadLeaks(run.match.game, seat, rejoin.actions)) {
          leaks.push(`seed ${seed}: rejoin actions — ${leak}`);
        }
        const batchStates = [
          run.initialState,
          ...run.emissions.filter((emission) => emission.seat === seat).map((e) => e.state),
        ];
        rejoin.journal.forEach((batch, index) => {
          const state = batchStates[index];
          if (state === undefined) {
            leaks.push(`seed ${seed}: rejoin journal batch ${index} has no matching state`);
            return;
          }
          for (const leak of payloadLeaks(state, seat, batch)) {
            leaks.push(`seed ${seed}: rejoin journal batch ${index} — ${leak}`);
          }
        });
      }
      expect(run.rejections.length).toBeGreaterThan(0);
    }
    expect(leaks).toEqual([]);
  });

  it('holds over the vanilla sweep', { timeout: 120_000 }, () => {
    const leaks: string[] = [];
    for (let seed = 1; seed <= 4; seed += 1) {
      const run = driveMatch(seed, { p1: RED_DECK, p2: GREEN_DECK });
      for (const { seat, payload, state } of run.emissions) {
        for (const leak of payloadLeaks(state, seat, payload)) {
          leaks.push(`seed ${seed}: ${leak}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
