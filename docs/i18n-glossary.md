# EN → ES glossary

The single table this project translates game terms by. Every one of the 155
Spanish card texts in `packages/cards/data/cards.es.json` and every Spanish
string in the client use the term this table gives — always the same one.

That last clause is the whole reason the file exists. A `[Blocker]` that is
"Bloqueador" on one card and "Defensor" on the next teaches nothing: the reader
has to relearn the game on every card. Consistency is not tidiness here, it is
the pedagogy.

## Who this is for, and what follows from it

Spanish-speaking children. The One Piece Card Game has no official Spanish
printing, so a child who does not read English cannot read the cards — and this
simulator can remove that barrier.

Three consequences, and they decide the hard calls further down:

1. **Neutral Spanish.** Latin-American standard: `tú`, never `vos`, never
   `vosotros`. No regionalisms — not "el mazo se baraja" as "se mezcla", not
   "coger". A nine-year-old in Bogotá, Lima, Ciudad de México or Buenos Aires
   reads the same sentence.
2. **Short, direct sentences.** "Elige 1 Personaje de tu rival" — the reader has
   to know what to *do*.
3. **Fidelity over clarity when they conflict.** See
   [Fidelity](#fidelity-the-rule-that-overrides-taste).

## Fidelity: the rule that overrides taste

**The English is the authority.** The scripts in `packages/cards/src/abilities.ts`
were derived from the English `effectText`; `hasName`, the `names` filter and
the name-resolution guard of PR #38 all match English strings. None of that is
translated and none of it reads this file.

So the Spanish says **what the English says** — not what it should have said.
No improving, no clarifying, no summarising, no splitting a long sentence into
two easier ones if that changes what is asserted. **If the English is ambiguous,
the Spanish inherits the ambiguity**: the script implements the English, and a
"clearer" Spanish that resolves the ambiguity the other way is a card that lies
in Spanish.

## What is never translated

| Kind | Example | Why |
| --- | --- | --- |
| Card names | `Monkey.D.Luffy`, `Gum-Gum Jet Pistol` | The art prints them in English. A child has to be able to match the preview panel against the picture. |
| Card names cited in text | `[Uta]`, `[Penguin]`, `[Kouzuki Oden]` | Same, and the engine resolves these by English string. |
| Type names | `{Straw Hat Crew}`, `{Land of Wano}` | Printed on the card in English, and matched by English string. |
| Attributes | `＜Strike＞`, `＜Slash＞` | Printed on the card in English. |
| `DON!!` | `DON!! x1`, `DON!! −2`, `mazo de DON!!` | A proper name, not a word. |

## Timing and activation markers

Every marker the 155 cards use, and nothing else. All translated: they are
structural labels, not names, and a reader who cannot tell `[Al Jugar]` from
`[Al Atacar]` cannot play the card.

| English | Spanish |
| --- | --- |
| `[Activate: Main]` | `[Activar: Principal]` |
| `[Main]` | `[Principal]` |
| `[Counter]` | `[Contraataque]` |
| `[On Play]` | `[Al Jugar]` |
| `[On K.O.]` | `[Al Quedar K.O.]` |
| `[On Block]` | `[Al Bloquear]` |
| `[When Attacking]` | `[Al Atacar]` |
| `[Your Turn]` | `[Tu Turno]` |
| `[Opponent's Turn]` | `[Turno del Rival]` |
| `[End of Your Turn]` | `[Fin de Tu Turno]` |
| `[Once Per Turn]` | `[Una Vez por Turno]` |
| `[Trigger]` | `[Disparador]` |
| `[DON!! x1]`, `[DON!! x2]` | `[DON!! x1]`, `[DON!! x2]` |
| `DON!! −1`, `DON!! −2`, `DON!! −6` | `DON!! −1`, `DON!! −2`, `DON!! −6` |

`[When Attacking]/[On Block]` — the one card that prints both on one line,
`OP01-078` — keeps the slash: `[Al Atacar]/[Al Bloquear]`.

## Keywords: the term-by-term decision

The four keywords are the only place this glossary had a genuine choice, so the
criterion is written down rather than applied by feel:

> **A keyword is translated when Spanish offers a word a nine-year-old already
> knows, or when the printed text never explains it. It stays in English when
> Spanish has no everyday equivalent *and* the card always prints its reminder
> text — in Spanish — immediately after it.**

| English | Spanish | Decision |
| --- | --- | --- |
| `[Blocker]` | `[Bloqueador]` | **Translated.** "Bloqueador" is an everyday word and a direct cognate; a child reads it and knows what it does before reaching the reminder. |
| `[Double Attack]` | `[Doble Ataque]` | **Translated.** Literal, everyday, and unambiguous. |
| `[Trigger]` | `[Disparador]` | **Translated**, and this one is forced: `[Trigger]` is the only keyword the cards *never* explain — `[Trigger] Play this card.` carries no reminder. Left in English it would be opaque, so the everyday-word test does not get to apply. "Disparador" is the standard Spanish rendering and its root (`disparar`) is known. |
| `[Rush]` | `[Rush]` | **Kept.** Spanish has no everyday word for it — *ímpetu*, *arremetida*, *prisa* are each rarer than the mechanic and none is standard. It functions as a proper name, it is printed on the art, and every printing follows it with "(Esta carta puede atacar en el turno en que se juega.)", which is the actual explanation. |
| `[Banish]` | `[Banish]` | **Kept**, same test. *Destierro* is a real word but not a child's word, and the reminder — "(Cuando esta carta hace daño, la carta objetivo va al descarte sin activar su Disparador.)" — carries the whole meaning. |

The two kept terms are exactly the two that always arrive with an explanation.
That is not a coincidence, it is the rule.

## Zones

| English | Spanish |
| --- | --- |
| field | campo |
| hand | mano |
| deck | mazo |
| trash | descarte |
| Life area | área de Vida |
| Life card | carta de Vida |
| cost area | área de coste |
| DON!! deck | mazo de DON!! |
| top of your deck | tope de tu mazo |
| bottom of your deck | fondo de tu mazo |

**"Trash" is `descarte` and nothing else** — never *basurero*, *cementerio* or
*pila de descarte*. The verb is `descartar`.

## Card categories

| English | Spanish |
| --- | --- |
| Leader | Líder |
| Character | Personaje |
| Event | Evento |
| Stage | Escenario |

## Stats

| English | Spanish |
| --- | --- |
| power | poder |
| cost | coste |
| Counter (the printed value) | Contraataque |
| Life | Vida |
| damage | daño |

`Counter` is **one** word in this project — `Contraataque` — for the value on
the card, for the `[Contraataque]` marker, for the Counter Step
(`Paso de Contraataque`) and for the client's own button. The stat column in the
card preview is the single place it is abbreviated, to `Contra.`, because the
column is fixed-width; it is an abbreviation of the same term, not a second one.

## Orientation: the one collision worth avoiding

English uses *activate* for two unrelated things — turning a rested card
upright, and putting an effect on the stack. Spanish would collide on
`activar`, so it does not:

| English | Spanish | Note |
| --- | --- | --- |
| rest (verb) | agotar | "Agota hasta 1 Personaje de tu rival." |
| rested | agotada / agotado | The state. |
| set as active | poner activa | "Pon hasta 1 de tus cartas DON!! como activa." |
| active | activa / activo | The state. |
| activate (an Event, a `[Bloqueador]`, an effect) | activar | Reserved for this meaning **only**. |

So `activar` never means "untap". The pair `agotar` / `poner activa` covers
orientation, and the client's board says the same: `Activos: 3`,
`Agotados: 1`, "queda agotada", "queda activa".

## Verbs and rules vocabulary

| English | Spanish |
| --- | --- |
| draw | robar |
| play (a card) | jugar |
| reveal | revelar |
| look at | mirar |
| add … to your hand | agregar … a tu mano |
| return … to the owner's hand | devolver … a la mano de su dueño |
| place … at the bottom of the deck | poner … en el fondo del mazo |
| shuffle | barajar |
| trash (verb) | descartar |
| K.O. (verb) | dejar K.O. |
| be K.O.'d | quedar K.O. |
| attack | atacar |
| block | bloquear |
| declare an attack | declarar un ataque |
| battle (noun) | combate |
| gain (power) | ganar |
| give … −2000 power | dar … −2000 de poder |
| choose | elegir |
| select | seleccionar |
| owner | dueño |
| your opponent | tu rival |
| target | objetivo |

`choose` and `select` both appear in the English of these 155 cards. They are
kept apart in Spanish (`elegir` / `seleccionar`) rather than merged, because
[fidelity](#fidelity-the-rule-that-overrides-taste) says the Spanish mirrors the
English wording, not the rules reading of it.

**K.O. keeps its dots** — `K.O.`, as printed. The client's log writes the same.

## Recurring phrases

Fixed renderings, so the same English sentence is never two Spanish sentences.

| English | Spanish |
| --- | --- |
| up to 1 / up to 2 | hasta 1 / hasta 2 |
| with a cost of 5 or less | con un coste de 5 o menos |
| with 4000 power or less | con 4000 de poder o menos |
| 3 or more Characters | 3 o más Personajes |
| other than `[Uta]` | que no sea `[Uta]` |
| a `{Straw Hat Crew}` type Character card | una carta de Personaje de tipo `{Straw Hat Crew}` |
| ＜Strike＞ attribute Characters | Personajes de atributo ＜Strike＞ |
| during this turn | durante este turno |
| during this battle | durante este combate |
| until the end of your opponent's next turn | hasta el final del próximo turno de tu rival |
| You may X: Y | Puedes X: Y |
| Then, … | Después, … |
| for every card in your hand | por cada carta en tu mano |
| according to the rules | según las reglas |
| in any order | en el orden que quieras |
| your opponent cannot … | tu rival no puede … |
| this Character / this card | este Personaje / esta carta |

## Reminder text

The parenthetical reminders are translated too. They are the most didactic part
of a card — a child learns the game from them — and this project exists to be
learned from. The four that recur:

| English | Spanish |
| --- | --- |
| (You may rest the specified number of DON!! cards in your cost area.) | (Puedes agotar esa cantidad de cartas DON!! de tu área de coste.) |
| (You may return the specified number of DON!! cards from your field to your DON!! deck.) | (Puedes devolver esa cantidad de cartas DON!! de tu campo a tu mazo de DON!!.) |
| (After your opponent declares an attack, you may rest this card to make it the new target of the attack.) | (Después de que tu rival declare un ataque, puedes agotar esta carta para convertirla en el nuevo objetivo del ataque.) |
| (This card can attack on the turn in which it is played.) | (Esta carta puede atacar en el turno en que se juega.) |
| (This card deals 2 damage.) | (Esta carta hace 2 de daño.) |
| (When this card deals damage, the target card is trashed without activating its Trigger.) | (Cuando esta carta hace daño, la carta objetivo va al descarte sin activar su Disparador.) |

## Where the client says the same things

The client's Spanish dictionary (`packages/client/src/i18n/es.ts`) uses this
table too, so the board and the cards agree. The board terms that come from it:

| Board | Spanish |
| --- | --- |
| Counter Step | Paso de Contraataque |
| Block Step | Paso de Bloqueo |
| trash pile viewer | Descarte |
| DON!! cost area | área de coste |
| rested / active counts | Agotados / Activos |
| concede | Rendirse |

## The pin

`packages/cards/data/cards.es.json` records the revision of the English text it
was translated from — the same `buhbbl/punk-records` commit that
`packages/cards/data/PROVENANCE.md` pins for `cards.en.json`. The translation
inherits that pin: re-ingesting the English at a newer commit is a change the
Spanish has to be re-checked against, and the recorded revision is what makes
that checkable rather than a matter of memory.

## Legal note

This translation is **fan-made and unofficial**. Bandai has published no Spanish
printing of the One Piece Card Game; nothing here is endorsed by or affiliated
with the rights holders. See the repository README for the full scope note.
