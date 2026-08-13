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
 * ## Six decks, in three pairs
 *
 * OP-01 prints eight Leaders across four colours, and deck legality wants every
 * card to share a colour with the Leader — so the fixtures come in colour pairs.
 * **Luffy** and **Law** are red/green and deal the manifestation games for
 * batches 1 and 2; **Crocodile** and **Kaido** are blue/purple and do the same
 * for batch 3. The two `*_EVERYTHING` decks are for the hand-built table tests
 * only, and exist because `buildScenario` can stage only what a decklist holds.
 *
 * Batch 1 recorded that a legal blue deck could not be built at all: OP-01's
 * blue pool held five cards whose printed text the engine already honoured, and
 * a blue/purple Leader reached nine — 36 of the 50 slots. Four pile-A cards sat
 * deferred behind that. **It was never a rules problem**; it was a written-card
 * problem, and batch 3 wrote thirteen. The arithmetic is under
 * `OP01_BP_CROCODILE`.
 *
 * ## What is in the red/green pair
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
    { cardId: 'OP01-027', qty: 1 }, // Round Table — [Main] −10000
    { cardId: 'OP01-028', qty: 3 }, // Green Star Rafflesia — [Counter] and [Trigger], one list
    { cardId: 'OP01-029', qty: 3 }, // Radical Beam!! — [Counter] boost + life gate, [Trigger] +1000
    { cardId: 'OP01-009', qty: 3 }, // Carrot — [Trigger] Play this card
    { cardId: 'OP01-014', qty: 2 }, // Jinbe — [Blocker], [On Block] play a red 2-drop
    // Usopp watches the *opponent* activate an Event, so what makes him fire is
    // the other deck's [Counter] Events, not this one's.
    { cardId: 'OP01-004', qty: 1 }, // Usopp — draw when your opponent plays an Event
    // Batch 8's two red cards, and the three slots they cost were chosen so
    // nothing measured paid for them. Two came off Usopp, whose line this file
    // already carries on `UNREACHED_BY_RANDOM_PLAY` with 1,200 games of evidence
    // — copies of a card no random game can reach buy nothing — and one off the
    // lone vanilla body. The *other* deck was left alone on purpose: its
    // 4000-power bodies are the only attackers `OP01-026` Red Hawk's [Counter]
    // can K.O., and that is the sole route a random red/green game has to the
    // attacker side of CR 7-1-1-4. Cutting them was tried first and measured:
    // it took `OP01-058-counter` and the attacker-side early ending out of the
    // corpus at once.
    //
    // Franky at 2 because his is a `static` read off the board rather than an
    // event, so what it needs is a body with a DON!! on it while the other side
    // has an active Character standing. Shanks at 1 because he costs 9.
    { cardId: 'OP01-021', qty: 2 }, // Franky — [DON!! x1] may attack active Characters
    { cardId: 'OP01-120', qty: 1 }, // Shanks — [Rush]; bans Blockers of 2000 or less
    { cardId: 'OP01-020', qty: 2 }, // Hyogoro — [Activate: Main] rest itself, +2000
    { cardId: 'OP01-007', qty: 2 }, // Caribou — [On K.O.] K.O. up to 1 with 4000 or less
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
    { cardId: 'OP01-032', qty: 3 }, // Ashura Doji — static, +2000 against a rested board
    { cardId: 'OP01-039', qty: 3 }, // Killer — [Blocker], [On Block] draw
    { cardId: 'OP01-012', qty: 2 }, // Sai — vanilla, cost 2, 4000
    { cardId: 'OP01-053', qty: 3 }, // Wire — vanilla, cost 2, 4000
    { cardId: 'OP01-025', qty: 3 }, // Roronoa Zoro — [Rush] only, cost 3, 5000
    { cardId: 'OP01-010', qty: 1 }, // Komachiyo — vanilla, cost 1, 3000
  ],
};

/**
 * Every scripted OP-01 card in one legal deck, for the **table tests only**.
 *
 * `buildScenario` stages a card by taking it out of the deck, so a position can
 * only name cards the decklist holds — and the two manifestation decks above
 * deliberately split the Events by colour, which leaves each of them unable to
 * stage half of them.
 *
 * Rather than un-split those (the split is what leaves room for bodies, and
 * bodies are what the batch-1 abilities point at), the hand-built tests get a
 * deck whose only job is availability. Its filler is thin on purpose: nothing
 * here is ever shuffled and dealt, because every position these tests use is
 * constructed.
 *
 * Kept legal all the same — it is asserted alongside the other two, so it
 * cannot drift into something the deckbuilding rules would refuse.
 */
export const OP01_RG_EVERYTHING: Decklist = {
  id: 'OP01-RG-ALL',
  name: 'OP-01 red/green (test fixture, every scripted card)',
  packId: '569101',
  leader: 'OP01-003',
  cards: [
    // Two of every scripted red/green card: a staged position never needs a
    // third, and there is no shuffling here to make copies matter.
    { cardId: 'OP01-006', qty: 2 },
    { cardId: 'OP01-007', qty: 2 },
    { cardId: 'OP01-017', qty: 2 },
    { cardId: 'OP01-020', qty: 2 },
    { cardId: 'OP01-022', qty: 2 },
    { cardId: 'OP01-026', qty: 1 },
    { cardId: 'OP01-027', qty: 2 },
    { cardId: 'OP01-028', qty: 1 },
    { cardId: 'OP01-029', qty: 1 },
    { cardId: 'OP01-032', qty: 2 },
    { cardId: 'OP01-033', qty: 2 },
    { cardId: 'OP01-034', qty: 2 },
    { cardId: 'OP01-035', qty: 2 },
    { cardId: 'OP01-039', qty: 2 },
    { cardId: 'OP01-048', qty: 2 },
    { cardId: 'OP01-052', qty: 2 },
    { cardId: 'OP01-054', qty: 2 },
    { cardId: 'OP01-056', qty: 1 },
    { cardId: 'OP01-057', qty: 2 },
    { cardId: 'OP01-058', qty: 1 },
    { cardId: 'OP01-009', qty: 1 }, // Carrot — [Trigger] Play this card
    { cardId: 'OP01-014', qty: 2 }, // Jinbe — [Blocker], [On Block] play a red 2-drop
    { cardId: 'OP01-004', qty: 1 }, // Usopp — draw when your opponent plays an Event
    // And the inert bodies the positions are built out of. Every one of these
    // is named by a table case somewhere: dropping one silently breaks a test
    // several files away with "no OP01-0xx left in the deck".
    // Batch 8. Their three slots came off `OP01-026`, `OP01-028` and `OP01-029`,
    // whose table cases stage one copy at a time — the filler below could not
    // pay, because every inert body here is named by a case somewhere and
    // dropping one fails a test several files away with "no OP01-0xx left".
    { cardId: 'OP01-021', qty: 2 }, // Franky — [DON!! x1] may attack active Characters
    { cardId: 'OP01-120', qty: 1 }, // Shanks — bans Blockers of 2000 or less
    { cardId: 'OP01-010', qty: 2 }, // Komachiyo — vanilla, cost 1, 3000
    { cardId: 'OP01-012', qty: 2 }, // Sai — vanilla, cost 2, 4000
    { cardId: 'OP01-053', qty: 1 }, // Wire — vanilla, cost 2, 4000
    { cardId: 'OP01-025', qty: 1 }, // Roronoa Zoro — [Rush] only, cost 3, 5000
    { cardId: 'OP01-018', qty: 1 }, // Hajrudin — vanilla, cost 4, 6000
    { cardId: 'OP01-036', qty: 1 }, // Otsuru — vanilla, cost 1, 3000
  ],
};

/**
 * Leader `OP01-001` Roronoa Zoro, mono-red.
 *
 * The only fixture that is a single colour, and it exists for one reason: a
 * Leader's `static` can only manifest in a game that Leader is *leading*, and
 * `OP01-001` is red-only, so its deck cannot hold a green card. Red's pool is
 * comfortably wide enough — nine scripted red cards and five inert ones, 14
 * distinct against the 13 a legal deck needs.
 *
 * It is also the first deck in this repo whose Leader has a **written**
 * ability. Every other OP-01 fixture runs a Leader whose printed text the
 * engine ignores, which the file header has flagged since batch 1; Zoro closes
 * that for one deck.
 */
export const OP01_R_ZORO: Decklist = {
  id: 'OP01-R-ZORO',
  name: 'OP-01 mono-red (test fixture, Zoro)',
  packId: '569101',
  leader: 'OP01-001',
  cards: [
    { cardId: 'OP01-006', qty: 4 }, // Otama — [On Play] −2000
    { cardId: 'OP01-007', qty: 4 }, // Caribou — [On K.O.] K.O.
    { cardId: 'OP01-017', qty: 4 }, // Nico Robin — [When Attacking] K.O.
    { cardId: 'OP01-020', qty: 4 }, // Hyogoro — [Activate: Main] rest itself
    { cardId: 'OP01-022', qty: 4 }, // Brook — [When Attacking] −2000 to two
    { cardId: 'OP01-026', qty: 4 }, // Red Hawk
    { cardId: 'OP01-027', qty: 4 }, // Round Table
    { cardId: 'OP01-028', qty: 4 }, // Green Star Rafflesia
    { cardId: 'OP01-029', qty: 4 }, // Radical Beam!!
    { cardId: 'OP01-010', qty: 4 }, // Komachiyo — vanilla, cost 1, 3000
    { cardId: 'OP01-012', qty: 4 }, // Sai — vanilla, cost 2, 4000
    { cardId: 'OP01-018', qty: 1 }, // Hajrudin — vanilla, cost 4, 6000
    // Batch 9's red card. Two copies off a vanilla body: this deck's {Straw Hat
    // Crew} Characters are what its search has to find, and there are three
    // kinds of them here.
    { cardId: 'OP01-030', qty: 2 }, // In Two Years!! — look 5, keep 1, bury the rest
    { cardId: 'OP01-023', qty: 3 }, // Marco — vanilla, cost 3, 5000
  ],
};

/**
 * Leader `OP01-031` Kouzuki Oden, mono-green, and the second fixture in this
 * repo whose Leader has a written ability.
 *
 * It exists for the same reason `OP01_R_ZORO` does — a Leader's ability is only
 * reachable in a game that Leader is leading — and it is mono-green for the same
 * reason that one is mono-red: Oden prints one colour, so the deck cannot borrow
 * another's cards.
 *
 * The deck is built around a *cost* rather than around an effect, which is new.
 * Oden pays "trash 1 {Land of Wano} type card from your hand", and `canPayCosts`
 * counts matching cards — so a green deck with a thin {Land of Wano} count would
 * simply never offer the ability and the fixture would measure nothing. Ten of
 * its thirteen entries carry the type, 40 of the 50 slots — the green pool holds
 * exactly two inert {Land of Wano} bodies, so the rest of the curve has to come
 * from outside the type. `OP01-059` BE-BENG!!
 * pays out of the same pool and gates its effect on the same type, so the two
 * cards this batch adds to the green pool share one deck rather than needing two.
 */
export const OP01_G_ODEN: Decklist = {
  id: 'OP01-G-ODEN',
  name: 'OP-01 mono-green (test fixture, Oden)',
  packId: '569101',
  leader: 'OP01-031',
  cards: [
    { cardId: 'OP01-036', qty: 4 }, // Otsuru — {Land of Wano}, vanilla, cost 1
    // Kawamatsu, who batch 5 could not use: his whole printed text is
    // "[Trigger] Play this card", and a fixture whose filler has unwritten text
    // measures less than it says. Batch 6 wrote it, so he is back and he is no
    // longer filler.
    { cardId: 'OP01-037', qty: 4 }, // Kawamatsu — [Trigger] Play this card
    { cardId: 'OP01-043', qty: 2 }, // Shinobu — {Land of Wano}, vanilla, cost 3
    // Two Wire, and they are load-bearing rather than filler: the table cases
    // for OP01-031 and OP01-059 need a green card that is *not* {Land of Wano},
    // to show the cost filter refusing one.
    { cardId: 'OP01-053', qty: 2 }, // Wire — {Kid Pirates}, vanilla, cost 2
    { cardId: 'OP01-048', qty: 4 }, // Nekomamushi — [On Play] rest
    { cardId: 'OP01-033', qty: 4 }, // Izo — [On Play] rest
    { cardId: 'OP01-034', qty: 4 }, // Inuarashi — [When Attacking] refresh DON!!
    { cardId: 'OP01-035', qty: 4 }, // Okiku — [When Attacking] rest
    { cardId: 'OP01-052', qty: 4 }, // Raizo — [When Attacking] draw
    { cardId: 'OP01-032', qty: 4 }, // Ashura Doji — static against a rested board
    { cardId: 'OP01-057', qty: 4 }, // Paradise Waterfall — [Counter] and [Trigger]
    { cardId: 'OP01-059', qty: 4 }, // BE-BENG!! — the filtered discard, again
    { cardId: 'OP01-054', qty: 3 }, // X.Drake — [On Play] K.O. a rested Character
    { cardId: 'OP01-045', qty: 1 }, // Jean Bart — vanilla, cost 4, 6000
    // Batch 9's green card, and this is the deck it belongs in: it searches
    // {Land of Wano}, and this fixture is built out of them.
    { cardId: 'OP01-041', qty: 2 }, // Momonosuke — look 5, keep 1, bury the rest
  ],
};

/* ---------------------------------------------------------- blue and purple */

/**
 * ## The blue/purple wall, and how it came down
 *
 * Batch 1 could not build a legal blue deck and said why: a legal deck is 50
 * cards at 4 copies, so it needs 13 distinct, and OP-01's blue pool held **five**
 * cards whose printed text the engine already honoured. Widening to a
 * blue/purple Leader reached nine — 36 of the 50 — and filling the rest with
 * unwritten abilities would have put bodies on the board that lie about what
 * they do. `OP01-070` Mihawk waited there for two batches, joined by `-086`,
 * `-089` and `-117` in batch 2.
 *
 * The wall was never about rules. It was about **written cards**, and batch 3
 * wrote thirteen blue and purple ones. The arithmetic now:
 *
 * | | distinct | slots |
 * | --- | --- | --- |
 * | inert blue (`-065`, `-066`, `-076`, `-081`) | 4 | 16 |
 * | inert purple (`-092`, `-100`, `-103`, `-107`, `-110`) | 5 | 20 |
 * | **scripted in batch 3** | **13** | **52** |
 * | total | 22 | 88 |
 *
 * Fifty needed, eighty-eight available. The four deferred cards did not need
 * anything built for them — they needed *each other*, and eleven neighbours.
 *
 * One property of the pool survives and is worth knowing: it is **top-heavy**.
 * Only three cards in it cost 2 or less (`-076`, `-100`, and `-117`), against a
 * 9-, a 10- and a 7-cost among the scripted. These decks are slower than the
 * red/green pair and their games run longer.
 */

/** Every scripted blue/purple card, two copies, for the hand-built tests. */
const BATCH_3_BP = [
  { cardId: 'OP01-068', qty: 2 }, // Gecko Moria — static [Double Attack]
  { cardId: 'OP01-070', qty: 2 }, // Dracule Mihawk — [On Play] bottom-deck
  { cardId: 'OP01-078', qty: 2 }, // Boa Hancock — [When Attacking]/[On Block] draw
  { cardId: 'OP01-079', qty: 4 }, // Ms. All Sunday — [On K.O.] recover an Event
  //                                 four, not two: OP01-087 plays a {Baroque
  //                                 Works} 3-drop, so a staged position needs
  //                                 one on the board and one still in hand
  { cardId: 'OP01-080', qty: 2 }, // Miss Doublefinger — [On K.O.] draw
  { cardId: 'OP01-086', qty: 2 }, // Overheat — [Counter] and [Trigger] bounce
  { cardId: 'OP01-089', qty: 2 }, // Crescent Cutlass — [Counter] bounce
  { cardId: 'OP01-094', qty: 2 }, // Kaido — [On Play] board wipe
  { cardId: 'OP01-096', qty: 2 }, // King — [On Play] two K.O.s, two selections
  { cardId: 'OP01-097', qty: 2 }, // Queen — [On Play] Rush then −2000
  { cardId: 'OP01-108', qty: 2 }, // Hitokiri Kamazo — [On K.O.] K.O.
  { cardId: 'OP01-111', qty: 2 }, // Black Maria — [On Block] +1000
  { cardId: 'OP01-117', qty: 2 }, // Sheep's Horn — [Main] rest
  { cardId: 'OP01-064', qty: 2 }, // Alvida — [When Attacking] discard, bounce
  { cardId: 'OP01-071', qty: 2 }, // Jinbe — [On Play] bottom-deck, [Trigger] play self
  { cardId: 'OP01-082', qty: 2 }, // Monet — [Trigger] Play this card
  { cardId: 'OP01-087', qty: 2 }, // Officer Agents — [Counter]/[Trigger] play a Baroque Works
  { cardId: 'OP01-104', qty: 2 }, // Speed — [Trigger] Play this card
] as const;

/**
 * Leader `OP01-062` Crocodile, and the first legal blue deck this project has
 * been able to build.
 *
 * The Leader is chosen, not defaulted: it carries **both**
 * {The Seven Warlords of the Sea} and {Baroque Works}, which are exactly the two
 * types `OP01-089` and `OP01-079` gate on. Under any other Leader those two
 * abilities would fire and resolve to nothing, and the fixture would be quietly
 * measuring less than it looks like it measures.
 */
export const OP01_BP_CROCODILE: Decklist = {
  id: 'OP01-BP-CROC',
  name: 'OP-01 blue/purple (test fixture, Crocodile)',
  packId: '569101',
  leader: 'OP01-062',
  cards: [
    { cardId: 'OP01-068', qty: 4 },
    { cardId: 'OP01-070', qty: 2 }, // cost 9 — two is already a lot of dead weight
    { cardId: 'OP01-078', qty: 4 },
    { cardId: 'OP01-079', qty: 4 },
    { cardId: 'OP01-080', qty: 4 },
    { cardId: 'OP01-086', qty: 4 },
    { cardId: 'OP01-089', qty: 4 },
    { cardId: 'OP01-064', qty: 4 }, // Alvida — [When Attacking] discard, bounce
    { cardId: 'OP01-082', qty: 4 }, // Monet — [Trigger] Play this card
    { cardId: 'OP01-087', qty: 2 }, // Officer Agents — [Counter]/[Trigger] play a Baroque Works
    { cardId: 'OP01-076', qty: 2 }, // Bellamy — vanilla, cost 2
    { cardId: 'OP01-081', qty: 2 }, // Mocha — vanilla, cost 3
    { cardId: 'OP01-100', qty: 2 }, // Kurozumi Higurashi — [Blocker] only, cost 2
    { cardId: 'OP01-066', qty: 4 }, // Krieg — vanilla, cost 4
    // Four copies, and the Leader is why they are worth it: `OP01-085` gates on
    // a {Baroque Works} Leader and Crocodile is one, so its prohibition is live
    // in every game this deck plays. The two vanilla lines above dropped to 2
    // apiece to pay for them — the deck is 50 either way.
    { cardId: 'OP01-085', qty: 4 }, // Mr.3(Galdino) — [On Play] cannot attack
  ],
};

/**
 * Leader `OP01-061` Kaido, for the purple half.
 *
 * Also a deliberate choice: `OP01-094` gates on an {Animal Kingdom Pirates}
 * Leader, and this is the only blue/purple Leader that has the type.
 */
export const OP01_BP_KAIDO: Decklist = {
  id: 'OP01-BP-KAIDO',
  name: 'OP-01 blue/purple (test fixture, Kaido)',
  packId: '569101',
  leader: 'OP01-061',
  cards: [
    { cardId: 'OP01-094', qty: 2 }, // cost 10
    { cardId: 'OP01-096', qty: 3 }, // cost 7
    { cardId: 'OP01-097', qty: 3 }, // cost 6
    { cardId: 'OP01-108', qty: 4 },
    { cardId: 'OP01-111', qty: 4 },
    { cardId: 'OP01-117', qty: 4 },
    { cardId: 'OP01-100', qty: 3 }, // Kurozumi Higurashi — [Blocker] only, cost 2
    { cardId: 'OP01-076', qty: 4 }, // Bellamy — vanilla, cost 2
    { cardId: 'OP01-081', qty: 4 }, // Mocha — vanilla, cost 3
    { cardId: 'OP01-103', qty: 1 }, // Scratchmen Apoo — vanilla, cost 4
    // Batch 9's purple card. It plays a {SMILE} Character costing 3 or less out
    // of the five it looked at, and OP01-104 Speed sits at 4 copies here.
    { cardId: 'OP01-116', qty: 2 }, // Artificial Devil Fruit SMILE
    { cardId: 'OP01-066', qty: 4 }, // Krieg — vanilla, cost 4
    // Batch 8's purple card. Three copies: the permission is *bought* with an
    // [Activate: Main] that hands a DON!! back, so it needs the body on the
    // board, the cost payable, and an active enemy Character to point at.
    { cardId: 'OP01-112', qty: 3 }, // Page One — DON!! -1: may attack active Characters
    { cardId: 'OP01-107', qty: 1 }, // Babanuki — vanilla, cost 5
    { cardId: 'OP01-104', qty: 4 }, // Speed — [Trigger] Play this card
    { cardId: 'OP01-110', qty: 2 }, // Fukurokuju — vanilla, cost 6
    // Blue, and legal under a blue/purple Leader. Present so the type-gated
    // abilities of OP01-079 and OP01-089 can be tested where the gate FAILS —
    // Kaido carries neither {Baroque Works} nor {The Seven Warlords of the Sea}.
    { cardId: 'OP01-079', qty: 1 },
    { cardId: 'OP01-089', qty: 1 },
  ],
};

/**
 * Leader `OP01-061` Kaido, mono-purple, and the deck batch 10 exists for.
 *
 * The fourth single-colour fixture, and built for the same reason as the other
 * three: a family whose cards are spread one or two to a mixed deck is a family
 * a random game reaches once in three hundred. Eight OP-01 cards add DON!! from
 * the DON!! deck and all eight are purple, so this is the only deck that can
 * hold them at a density where the bots meet them.
 *
 * The Leader is the ninth. `OP01-061`'s own ability is in this batch — "when
 * your opponent's Character is K.O.'d, add up to 1 DON!! card … and set it as
 * active" — and it needed two batches to arrive: PR #30 built the trigger that
 * watches the other player's board, and this one built what it does.
 *
 * `OP01-118` and `OP01-119` are here at four copies each and they are the point
 * of the count: both are `[Counter]` Events, which is the hardest thing in this
 * repo for a random game to reach, and `OP01-119` is the only card in the set
 * that adds DON!! in **both** orientations — rested on its `[Counter]`, active
 * on its `[Trigger]`.
 */
export const OP01_P_KAIDO: Decklist = {
  id: 'OP01-P-KAIDO',
  name: 'OP-01 mono-purple (test fixture, Kaido)',
  packId: '569101',
  leader: 'OP01-061',
  cards: [
    // Batch 10, the whole family bar the Leader.
    { cardId: 'OP01-093', qty: 4 }, // Ulti - rest a DON!!, add a rested one
    { cardId: 'OP01-101', qty: 4 }, // Sasaki - trash a card, add a rested one
    { cardId: 'OP01-106', qty: 4 }, // Basil Hawkins - [On Play] add, [Trigger] play self
    { cardId: 'OP01-113', qty: 4 }, // Holedem - [On K.O.] add a rested one
    { cardId: 'OP01-115', qty: 4 }, // Elephant's Marchoo - K.O., then add an active one
    { cardId: 'OP01-118', qty: 4 }, // Ulti-Mortar - [Counter]; [Trigger] adds active
    { cardId: 'OP01-119', qty: 4 }, // Thunder Bagua - adds rested and active, one per half
    // Bodies for the [On K.O.] and [When Attacking] halves to happen on, and
    // cheap enough that the board fills early. Every one is vanilla or
    // keyword-only, which `op01Decks.test.ts` asserts rather than trusts.
    { cardId: 'OP01-104', qty: 4 }, // Speed - vanilla, cost 2
    { cardId: 'OP01-103', qty: 4 }, // Scratchmen Apoo - vanilla, cost 4
    { cardId: 'OP01-092', qty: 2 }, // Kaido - vanilla {Land of Wano} 7-drop
    { cardId: 'OP01-107', qty: 4 }, // Babanuki - vanilla, cost 5
    { cardId: 'OP01-110', qty: 4 }, // Fukurokuju - vanilla, cost 6
    { cardId: 'OP01-100', qty: 4 }, // Kurozumi Higurashi - [Blocker] only, cost 2
  ],
};

/**
 * Every scripted blue/purple card in one legal deck, for the table tests — the
 * blue/purple twin of `OP01_RG_EVERYTHING`, and for the same reason.
 *
 * Crocodile-led, so the two type-gated abilities are live. `OP01-094`'s gate
 * wants a different Leader, so its own cases stage from `OP01_BP_KAIDO`
 * instead — the one place a table test names a deck by hand.
 */
export const OP01_BP_EVERYTHING: Decklist = {
  id: 'OP01-BP-ALL',
  name: 'OP-01 blue/purple (test fixture, every scripted card)',
  packId: '569101',
  leader: 'OP01-062',
  cards: [
    ...BATCH_3_BP,
    { cardId: 'OP01-076', qty: 2 }, // Bellamy — vanilla, cost 2
    { cardId: 'OP01-081', qty: 2 }, // Mocha — vanilla, cost 3
    { cardId: 'OP01-100', qty: 2 }, // Kurozumi Higurashi — [Blocker] only, cost 2
    { cardId: 'OP01-066', qty: 2 }, // Krieg — vanilla, cost 4
    { cardId: 'OP01-065', qty: 2 }, // Vergo — vanilla, cost 5
    { cardId: 'OP01-103', qty: 2 }, // Scratchmen Apoo — vanilla, cost 4
    // `OP01-085` Mr.3(Galdino) is deliberately **not** here. This is the deck
    // every hand-built blue/purple position stages from, it is already exactly
    // 50, and every filler line in it is a body some staged board needs two of —
    // `op01Batch3.test.ts` names all six in its own `FILLERS`. Mr.3 lives in
    // `OP01_BP_CROCODILE` instead, which is Crocodile-led and therefore the only
    // fixture where his {Baroque Works} gate is open at all.
  ],
};

/**
 * Leader `OP01-060` Donquixote Doflamingo, mono-blue.
 *
 * The third fixture built around a Leader's own ability and the first built
 * around what that ability *reveals*: Doflamingo turns the top card of the deck
 * over and may play it rested if it is a {The Seven Warlords of the Sea}
 * Character costing 4 or less. Two written cards in OP-01's blue pool answer
 * that description — `OP01-068` Gecko Moria and `OP01-078` Boa Hancock — so both
 * sit at 4 copies, 8 of the 50, which is what makes the reveal hit often enough
 * for a random game to walk the branch.
 *
 * Mono-blue because Doflamingo is. `OP01-073` — the pool's third {Seven
 * Warlords} 4-drop — used to stay out of it, because its `[On Play]` needed the
 * top-or-bottom split and filler with unwritten text measures less than it
 * says. That is no longer true: the split is built, so `OP01-073` and
 * `OP01-077` are in the list below and are the only two cards in this deck that
 * ask the partition question.
 */
export const OP01_B_DOFLAMINGO: Decklist = {
  id: 'OP01-B-DOFFY',
  name: 'OP-01 mono-blue (test fixture, Doflamingo)',
  packId: '569101',
  leader: 'OP01-060',
  cards: [
    { cardId: 'OP01-068', qty: 4 }, // Gecko Moria — {Seven Warlords}, cost 4
    { cardId: 'OP01-078', qty: 4 }, // Boa Hancock — {Seven Warlords}, cost 4
    { cardId: 'OP01-064', qty: 4 }, // Alvida — [When Attacking] discard, bounce
    { cardId: 'OP01-071', qty: 4 }, // Jinbe — [On Play] bottom-deck, [Trigger] play self
    { cardId: 'OP01-082', qty: 4 }, // Monet — [Trigger] Play this card
    { cardId: 'OP01-087', qty: 4 }, // Officer Agents — [Counter]/[Trigger] play
    { cardId: 'OP01-079', qty: 4 }, // Ms. All Sunday — [On K.O.] recover an Event
    { cardId: 'OP01-080', qty: 4 }, // Miss Doublefinger — [On K.O.] draw
    { cardId: 'OP01-086', qty: 4 }, // Overheat — [Counter] and [Trigger] bounce
    { cardId: 'OP01-089', qty: 2 }, // Crescent Cutlass — [Counter] bounce
    { cardId: 'OP01-076', qty: 2 }, // Bellamy — vanilla, cost 2
    { cardId: 'OP01-081', qty: 2 }, // Mocha — vanilla, cost 3
    { cardId: 'OP01-066', qty: 2 }, // Krieg — vanilla, cost 4
    // The top-or-bottom partition, and this is where the pair belongs: both are
    // mono-blue, and the comment above about `OP01-073` staying out was true for
    // exactly as long as the split was unbuilt. Two copies apiece, paid for by
    // the two vanilla lines above dropping from four — the deck is 50 either
    // way, and a staged position needs only one of each filler.
    { cardId: 'OP01-073', qty: 2 }, // Doflamingo — [Blocker] + look 5, split
    { cardId: 'OP01-077', qty: 2 }, // Perona — cost 1, look 5, split
    // Batch 9's blue card. It searches {Baroque Works} *Events*, and this deck
    // holds six of them between OP01-087 and OP01-089.
    { cardId: 'OP01-084', qty: 2 }, // Mr.2.Bon.Kurei — look 5, keep 1, bury the rest
  ],
};

export const OP01_TEST_DECKS: readonly Decklist[] = Object.freeze([
  OP01_RG_LUFFY,
  OP01_R_ZORO,
  OP01_RG_LAW,
  OP01_G_ODEN,
  OP01_RG_EVERYTHING,
  OP01_BP_CROCODILE,
  OP01_B_DOFLAMINGO,
  OP01_BP_KAIDO,
  OP01_P_KAIDO,
  OP01_BP_EVERYTHING,
]);

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
