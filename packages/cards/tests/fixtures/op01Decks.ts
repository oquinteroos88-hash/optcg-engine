import { validateDecklist } from '../../src/index.js';
import type { Decklist } from '../../src/types.js';

/**
 * Two legal OP-01 decks, built to make the OP-01 abilities fire.
 *
 * **Test fixtures, not product.** ST-01 and ST-02 are transcriptions of real
 * boxes and live in `data/decklists/`; these are constructed. They are
 * deliberately not published from `src/`, not exported through the
 * `/starters` subpath, and not offered by the client's setup screen — the UI
 * still deals ST-01 against ST-02, which is correct until OP-01 has enough
 * written cards to be a real deck.
 *
 * ## Why two red/green decks and not one of each colour
 *
 * OP-01 prints eight Leaders across four colours, and deck legality wants every
 * card to share a colour with the Leader. Nine of the ten cards this batch
 * looked at are red or green, so a red/green Leader carries all nine at once —
 * `OP01-003` Luffy and `OP01-002` Law are the two that do.
 *
 * The tenth, `OP01-070` Dracule Mihawk, is blue, and it could not be shipped in
 * this batch for a reason worth writing down rather than rediscovering:
 *
 * > A legal deck is 50 cards at 4 copies each, so it needs at least 13 distinct
 * > cards. OP-01's blue pool contains **four** Characters with no printed effect
 * > at all (`OP01-065`, `-066`, `-076`, `-081`) plus `OP01-075` Pacifista, whose
 * > only in-game text is `[Blocker]`. Five distinct cards is 20 of the 50.
 * > Widening to a blue/purple Leader adds four more vanilla purple bodies and
 * > `OP01-100`, reaching 40. **There is no way to fill a blue deck out of cards
 * > whose printed text the engine already honours.**
 *
 * Filling the rest with cards whose abilities are not written would put bodies
 * on the board that lie about what they do, which is the one thing a fixture
 * must not do. So Mihawk waits for a batch that also writes enough blue cards
 * to field him.
 *
 * ## What is in them
 *
 * Both decks carry all nine **batch-1 Characters**, at 3 copies rather than 4 —
 * batch 2 needed the room. Each carries the batch-2 **Events of one colour**:
 * Luffy the four red ones, Law the three green. That split is not arbitrary. A
 * `[Counter]` Event fires while its holder is *defending*, and both decks
 * defend, so one copy of the split covers every Event; splitting also leaves
 * each deck enough non-Event bodies to build the boards the batch-1 abilities
 * point at.
 *
 * Every remaining slot is **only** a card with no printed effect or with
 * nothing but a printed keyword — never a card whose ability a later batch will
 * write. A fixture that anticipates unwritten scripts is a fixture that quietly
 * tests nothing, and `op01Decks.test.ts` asserts it rather than trusting this
 * paragraph.
 *
 * The filler is deliberately cheap. Every ability in these batches either
 * targets an opponent's Character by cost or needs a board of its own, so a deck
 * that cannot put small bodies down early never reaches its own effects. The
 * Events are cheap for a sharper reason: `PLAY_COUNTER_EVENT` is offered only
 * when the defender's **active** cost-area DON!! covers the printed cost
 * (CR 7-1-3-2-2), and a defender has spent most of their DON!! on their own
 * turn. A 1- or 2-cost `[Counter]` is reachable; a 5-cost one would not be.
 *
 * One thing neither deck can avoid: **every OP-01 Leader prints an ability, and
 * none of them is written yet.** `OP01-003` is pile A and is queued for the
 * activated-ability batch; `OP01-002` needs put-into-play and is pile C. Both
 * behave as vanilla Leaders here. There is no OP-01 Leader that does not have
 * this problem.
 */

/** The nine Characters batch 1 scripted, three copies each. In both decks. */
const BATCH_1 = [
  { cardId: 'OP01-006', qty: 3 }, // Otama — [On Play] −2000
  { cardId: 'OP01-017', qty: 3 }, // Nico Robin — [When Attacking] K.O.
  { cardId: 'OP01-022', qty: 3 }, // Brook — [When Attacking] −2000 to two
  { cardId: 'OP01-033', qty: 3 }, // Izo — [On Play] rest
  { cardId: 'OP01-034', qty: 3 }, // Inuarashi — [When Attacking] refresh DON!!
  { cardId: 'OP01-035', qty: 3 }, // Okiku — [When Attacking] rest
  { cardId: 'OP01-048', qty: 3 }, // Nekomamushi — [On Play] rest
  { cardId: 'OP01-052', qty: 3 }, // Raizo — [When Attacking] draw
  { cardId: 'OP01-054', qty: 3 }, // X.Drake — [On Play] K.O. a rested Character
] as const;

/**
 * Leader `OP01-003` Monkey.D.Luffy, carrying batch 2's four red Events.
 *
 * `OP01-027` Round Table is the only one at 2 copies: it costs 4, so a hand
 * holding several of them stalls rather than plays. The three `[Counter]`
 * Events cost 1, 1 and 2, which is what makes them reachable while defending.
 */
export const OP01_RG_LUFFY: Decklist = {
  id: 'OP01-RG-LUFFY',
  name: 'OP-01 red/green (test fixture, Luffy)',
  packId: '569101',
  leader: 'OP01-003',
  cards: [
    ...BATCH_1,
    { cardId: 'OP01-026', qty: 3 }, // Red Hawk — [Counter] boost + K.O., [Trigger] −10000
    { cardId: 'OP01-027', qty: 2 }, // Round Table — [Main] −10000
    { cardId: 'OP01-028', qty: 3 }, // Green Star Rafflesia — [Counter] and [Trigger], one list
    { cardId: 'OP01-029', qty: 3 }, // Radical Beam!! — [Counter] boost + life gate, [Trigger] +1000
    { cardId: 'OP01-010', qty: 4 }, // Komachiyo — vanilla, cost 1, 3000
    { cardId: 'OP01-036', qty: 4 }, // Otsuru — vanilla, cost 1, 3000
    { cardId: 'OP01-053', qty: 4 }, // Wire — vanilla, cost 2, 4000
  ],
};

/**
 * Leader `OP01-002` Trafalgar Law, carrying batch 2's three green Events.
 *
 * `OP01-056` Demon Face costs 6 and sits at 2 copies for the same reason Round
 * Table does. `OP01-025` prints `[Rush]`, so this side attacks a turn earlier —
 * which is what gets the *other* deck's `[Counter]` Events reached.
 */
export const OP01_RG_LAW: Decklist = {
  id: 'OP01-RG-LAW',
  name: 'OP-01 red/green (test fixture, Law)',
  packId: '569101',
  leader: 'OP01-002',
  cards: [
    ...BATCH_1,
    { cardId: 'OP01-056', qty: 2 }, // Demon Face — [Main] K.O. up to 2 rested
    { cardId: 'OP01-057', qty: 3 }, // Paradise Waterfall — [Counter] boost + wake, [Trigger] K.O.
    { cardId: 'OP01-058', qty: 3 }, // Punk Gibson — [Counter] boost + rest, [Trigger] rest
    { cardId: 'OP01-012', qty: 4 }, // Sai — vanilla, cost 2, 4000
    { cardId: 'OP01-053', qty: 4 }, // Wire — vanilla, cost 2, 4000
    { cardId: 'OP01-025', qty: 4 }, // Roronoa Zoro — [Rush] only, cost 3, 5000
    { cardId: 'OP01-010', qty: 3 }, // Komachiyo — vanilla, cost 1, 3000
  ],
};

export const OP01_TEST_DECKS: readonly Decklist[] = Object.freeze([OP01_RG_LUFFY, OP01_RG_LAW]);

/**
 * Throws unless both decks are legal.
 *
 * Called at import time rather than left to a test, because an illegal fixture
 * makes every suite that uses it fail somewhere far from the cause — and
 * `validateDecklist` is the same gate the transcribed starter decks pass.
 */
export function assertFixtureDecksAreLegal(): void {
  for (const deck of OP01_TEST_DECKS) {
    const problems = validateDecklist(deck);
    if (problems.length > 0) {
      throw new Error(`${deck.id} is not a legal deck:\n  - ${problems.join('\n  - ')}`);
    }
  }
}
