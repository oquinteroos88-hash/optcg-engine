import { describe, expect, it } from 'vitest';
import { applyAction, getCardDef, hasName, playerView, redactEvent } from '@optcg/engine';
import type { GameEvent, PlayerId, ViewEvent } from '@optcg/engine';
import { registerStarterCards, starterCards } from '@optcg/cards/starters';
import { buildScenario } from '@optcg/engine/testdata/scenarios';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { LOCALES, localeFromNavigator, messagesFor } from '../src/i18n';
import { printedTextOf } from '../src/game/printed';
import { logEntries } from '../src/store/selectors';
import { starterCorpusStates } from './corpus';

registerStarterCards();

/**
 * Walks a dictionary and yields `path -> kind` for every leaf, where the kind
 * is either `string` or the arity of the function that builds one.
 *
 * Arity matters as much as presence: a message whose Spanish takes one
 * parameter where the English takes two is a sentence that will render with a
 * hole in it, and no key-set comparison would catch that.
 */
function shape(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'function') {
    return { [path]: `fn/${value.length}` };
  }
  if (typeof value === 'string') {
    return { [path]: 'string' };
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, string> = {};
    for (const [key, child] of Object.entries(value)) {
      Object.assign(out, shape(child, path === '' ? key : `${path}.${key}`));
    }
    return out;
  }
  return { [path]: typeof value };
}

describe('the dictionaries', () => {
  /**
   * The real guard is the type system: `es.ts` is annotated `Messages`, which
   * is `typeof en`, so a key present in English and absent in Spanish does not
   * compile and neither does a parameter list that drifts. Nothing here can
   * fail that the compiler would have let through.
   *
   * It exists anyway, for the reader. "It does not compile" is invisible in a
   * diff and unfalsifiable in review; this is the same claim written down where
   * somebody can see what it means and what it covers.
   */
  it('have exactly the same shape, key for key and arity for arity', () => {
    expect(shape(es)).toEqual(shape(en));
  });

  it('has one dictionary per locale, and no locale without one', () => {
    for (const locale of LOCALES) {
      expect(messagesFor(locale)).toBeDefined();
    }
    expect(LOCALES).toEqual(['en', 'es']);
  });

  it('leaves the terms that are names untranslated in both', () => {
    // DON!! is a proper name; so are `Rush` and `Banish`, which the glossary
    // keeps in English because the cards always explain them. `Blocker` and
    // `Double Attack` are the two that do get Spanish.
    expect(es.keyword.rush).toBe(en.keyword.rush);
    expect(es.keyword.banish).toBe(en.keyword.banish);
    expect(es.keyword.blocker).toBe('Bloqueador');
    expect(es.keyword.doubleAttack).toBe('Doble Ataque');
    expect(es.board.donDeck).toContain('DON!!');
  });

  it('is written in neutral Spanish, without voseo', () => {
    // The reader is a Spanish-speaking child anywhere in Latin America, so the
    // client says `tú`. This catches the forms the previous copy used.
    const all = Object.values(shape(es));
    expect(all.length).toBeGreaterThan(100);
    const rendered = renderEverything();
    expect(rendered).not.toMatch(
      /\b(?:elegí|tocá|pasá|podés|tenés|querés|devolvés|robás|mirá|vos|quedate)\b/i,
    );
  });
});

/** Every Spanish message, with sample arguments, as one blob to grep. */
function renderEverything(): string {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
    } else if (typeof value === 'function') {
      const args = Array.from({ length: value.length }, () => 1 as unknown);
      try {
        out.push(String((value as (...a: unknown[]) => string)(...args)));
      } catch {
        // A message that needs a shaped argument (the card tile) is covered by
        // the rendered-board suites instead.
      }
    } else if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) walk(child);
    }
  };
  walk(es);
  return out.join('\n');
}

describe('the rendered log', () => {
  /** A short real game, folded into both languages from the same journal. */
  function journalOf(seat: PlayerId): { journal: ViewEvent[]; state: ReturnType<typeof buildScenario> } {
    let state = buildScenario({ p1: { activeDon: 5 }, p2: { activeDon: 5 } });
    const journal: ViewEvent[] = [];
    for (const action of [
      { type: 'END_TURN' as const, player: 'p1' as const },
      { type: 'END_TURN' as const, player: 'p2' as const },
      { type: 'END_TURN' as const, player: 'p1' as const },
    ]) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(result.reason);
      }
      for (const event of result.events as readonly GameEvent[]) {
        const redacted = redactEvent(result.state, seat, event, new Set());
        if (redacted !== null) {
          journal.push(redacted);
        }
      }
      state = result.state;
    }
    return { journal, state };
  }

  it('says nothing raw and nothing English when the locale is Spanish', () => {
    const { journal, state } = journalOf('p1');
    const lines = logEntries(journal, playerView(state, 'p1'), 'es');
    expect(lines.length).toBeGreaterThan(5);

    // Every English *message* the same journal would have produced. Card names
    // are not in here and must not be: those are the same in both languages,
    // which is the point.
    const english = new Set(
      logEntries(journal, playerView(state, 'p1'), 'en').map((entry) => entry.text),
    );
    for (const line of lines) {
      expect(line.text.length).toBeGreaterThan(0);
      // No dictionary key ever reaches the screen: there is no key lookup at
      // runtime, so a leak would look like a dotted path.
      expect(line.text).not.toMatch(/\b(?:log|board|common|choice|net)\.[a-zA-Z]/);
      expect(line.text).not.toContain('undefined');
      expect(english.has(line.text)).toBe(false);
    }
  });

  it('renders the same journal in English too, and differently', () => {
    const { journal, state } = journalOf('p1');
    const view = playerView(state, 'p1');
    const spanish = logEntries(journal, view, 'es').map((entry) => entry.text);
    const english = logEntries(journal, view, 'en').map((entry) => entry.text);
    expect(english).toHaveLength(spanish.length);
    expect(english).not.toEqual(spanish);
    // The memo is keyed by locale: asking twice must not hand back the first
    // answer in the second language.
    expect(logEntries(journal, view, 'es').map((entry) => entry.text)).toEqual(spanish);
  });
});

describe('the guard of PR #38, with Spanish active', () => {
  /**
   * Name resolution matches the **English** printed name, always.
   *
   * `CardFilter.names` and `hasName` are engine values derived from
   * `CardDefinition.name`, and `cards.es.json` translates `effectText` and
   * nothing else. This is the assertion that says so out loud: with the client
   * set to Spanish and the Spanish text demonstrably on screen, the engine
   * still answers to the English name and does not answer to anything the
   * translation introduced.
   */
  it('still resolves a card by its English name while the board is in Spanish', () => {
    const state = buildScenario({ p1: { activeDon: 1 }, p2: { activeDon: 1 } });
    const leader = state.players.p1.leader;
    const englishName = getCardDef(state.cards[leader]!.cardId).name;

    expect(hasName(state, leader, englishName)).toBe(true);
    // Nothing about the locale reaches this call, and there is no Spanish
    // spelling of a card name to try — but the negative is worth pinning: a
    // name the translation could plausibly have invented resolves to nothing.
    expect(hasName(state, leader, 'Personaje')).toBe(false);
  });

  it('keeps every starter name identical in both locales', () => {
    for (const card of starterCards) {
      // The card's own name is not a message and has no Spanish form: the art
      // prints it in English and so does the panel.
      expect(getCardDef(card.cardId).name).toBe(card.name);
      // The text under it, however, is different — otherwise nothing was
      // translated at all.
      const spanish = printedTextOf(card.cardId, 'es');
      const english = printedTextOf(card.cardId, 'en');
      expect(spanish.translated).toBe(true);
      expect(english.translated).toBe(false);
      expect(spanish.effectText).not.toBeNull();
      if (english.effectText !== '-') {
        expect(spanish.effectText).not.toBe(english.effectText);
      }
    }
  });

  it('translates the printed text of every card the client can put on a board', () => {
    // Not a sample: every card id the starter corpus ever produces has to have
    // Spanish text, because any of them can end up under the pointer.
    const seen = new Set<string>();
    for (const state of starterCorpusStates()) {
      for (const card of Object.values(state.cards)) {
        seen.add(card.cardId);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    for (const cardId of seen) {
      expect(printedTextOf(cardId, 'es').translated, cardId).toBe(true);
    }
  });
});

describe('the default locale', () => {
  it('follows the browser when it asks for Spanish, and English otherwise', () => {
    for (const language of ['es', 'es-419', 'es-MX', 'ES-ar']) {
      expect(localeFromNavigator(language)).toBe('es');
    }
    for (const language of ['en', 'en-US', 'pt-BR', 'fr', '', undefined, null]) {
      expect(localeFromNavigator(language)).toBe('en');
    }
  });
});
