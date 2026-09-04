import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYER_IDS } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import { SERVER_ERRORS, UPGRADE_REFUSALS } from '../src/protocol.js';
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

/**
 * The error channel (threat model M12): the two places a server can speak
 * outside `send` — the `code` of an error message and the reason of a close
 * frame — are held to a fixed vocabulary of bare words. A word names no card,
 * no id and no internal path; a word that is its own key cannot have been
 * built from anything.
 */
describe('the error channel', () => {
  const WORD = /^[a-zA-Z]+$/;

  it('keeps every server code and upgrade refusal a bare word equal to its key', () => {
    for (const [key, value] of Object.entries({ ...SERVER_ERRORS, ...UPGRADE_REFUSALS })) {
      expect(value).toBe(key);
      expect(value).toMatch(WORD);
    }
  });

  it('refuses an upgrade with a word from the vocabulary as the whole body', () => {
    // The channel that speaks before a socket exists: every `done(false,
    // <status>, <reason>)` in `verifyClient` must name an `UPGRADE_REFUSALS`
    // member — a template that quoted the origin would fail here.
    const source = readFileSync(new URL('../src/transport.ts', import.meta.url), 'utf8');
    const refusals = [...source.matchAll(/done\(\s*false\s*,\s*\d{3}\s*,\s*([^)]*)\)/g)].map(
      (match) => (match[1] ?? '').trim(),
    );
    expect(refusals.length).toBe(Object.keys(UPGRADE_REFUSALS).length);
    for (const reason of refusals) {
      const named = reason.match(/^UPGRADE_REFUSALS\.([a-zA-Z]+)$/)?.[1];
      expect(
        named !== undefined && named in UPGRADE_REFUSALS,
        `upgrade refusal "${reason}" is outside the vocabulary`,
      ).toBe(true);
    }
    expect(source).not.toMatch(/done\(\s*false[^)]*['"`]/);
  });

  it('closes with a code from the vocabulary as the whole reason, or with no reason at all', () => {
    // Pinned at the source: every `close(...)` the transport issues either
    // carries no reason (the replaced socket of a reconnection) or a reason
    // that is a `ServerErrorCode` — the typed `code` of the refusal path, or
    // a member of `SERVER_ERRORS` by name. No string literal, no template,
    // no variable of any other type can reach a close frame.
    const source = readFileSync(new URL('../src/transport.ts', import.meta.url), 'utf8');
    const reasons = [...source.matchAll(/\.close\(\s*\w+\s*,\s*([^)]*)\)/g)].map((match) =>
      (match[1] ?? '').trim(),
    );
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      const named = reason.match(/^SERVER_ERRORS\.([a-zA-Z]+)$/)?.[1];
      expect(
        reason === 'code' || (named !== undefined && named in SERVER_ERRORS),
        `close reason "${reason}" is outside the vocabulary`,
      ).toBe(true);
    }
    // And no close anywhere in the file quotes a string of its own.
    expect(source).not.toMatch(/\.close\([^)]*['"`]/);
  });
});
