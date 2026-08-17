import type { PlayerId } from '@optcg/engine';

/**
 * Which mat each seat plays on.
 *
 * **The mat is presentation and nothing else.** It never travels: not in the
 * protocol, not in an `Action`, not in the state, not to the server. Two seats
 * can play the same match on two different mats and the game does not know —
 * exactly the rule the locale follows, and for the same reason. Changing one is
 * a re-render, never a reconnection.
 *
 * Per seat rather than per client, because a hot-seat device is two players.
 */
export type PlaymatId = string;

/** The one this repository draws itself. Always available, never a file. */
export const NEUTRAL_PLAYMAT = 'neutral';

/**
 * The mats this repository draws, and there is more than one on purpose.
 *
 * A table is two mats, and two mats that look identical are one mat with a line
 * through it. The official ones are Bandai's and most machines do not have
 * them, so a clone with no local archive used to get a single grey sheet twice
 * and no control at all — the picker hid itself, because one option is not a
 * choice. These are the choice.
 *
 * Colours, not pictures: each is a hue the neutral mat's own wash is tinted
 * with, so the whole set costs one number each and nothing is ever loaded. The
 * names are the game's own colours, which is what a player would ask for.
 */
/**
 * A union rather than `string`, so `m.playmat.builtin[id]` resolves against the
 * dictionary's own keys. Adding a mat here without naming it in both languages
 * does not compile — the same guarantee every other message has.
 */
export type BuiltinPlaymatId = 'neutral' | 'red' | 'green' | 'blue' | 'purple';

export interface BuiltinPlaymat {
  id: BuiltinPlaymatId;
  /** Hue angle for the mat's wash. `null` keeps the untinted slate. */
  hue: number | null;
}

export const BUILTIN_PLAYMATS: readonly BuiltinPlaymat[] = Object.freeze([
  { id: NEUTRAL_PLAYMAT, hue: null },
  { id: 'red', hue: 4 },
  { id: 'green', hue: 145 },
  { id: 'blue', hue: 208 },
  { id: 'purple', hue: 276 },
]);

export function builtinPlaymat(id: PlaymatId): BuiltinPlaymat | undefined {
  return BUILTIN_PLAYMATS.find((mat) => mat.id === id);
}

/**
 * The two custom properties a drawn mat's hue becomes.
 *
 * Empty for the untinted one, and for an id nothing recognises — the stylesheet
 * falls back to the surface colour, so "no tint" needs no rule and an unknown
 * mat is a mat rather than a hole. Dark and desaturated: this sits UNDER the
 * cards, and a mat that competes with them is a worse mat.
 */
export function matTint(hue: number | null): Record<string, string> {
  return hue === null
    ? {}
    : { '--mat-base': `hsl(${hue} 30% 13%)`, '--mat-wash': `hsl(${hue} 42% 25%)` };
}

/**
 * What each seat starts on: two different mats, so the table reads as two mats
 * before anybody has chosen anything. Which is the point of a mat.
 */
const DEFAULT_PLAYMATS: Record<PlayerId, PlaymatId> = { p1: 'red', p2: 'blue' };

/** Where the choice lives between reloads. Nothing else about it is stored. */
function storageKey(player: PlayerId): string {
  return `optcg.playmat.${player}`;
}

export function loadPlaymat(player: PlayerId): PlaymatId {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(player));
    return typeof raw === 'string' && raw !== '' ? raw : DEFAULT_PLAYMATS[player];
  } catch {
    // Storage disabled: the client still runs, it just forgets the choice
    // between reloads. Not worth failing a render over.
    return DEFAULT_PLAYMATS[player];
  }
}

export function savePlaymat(player: PlayerId, id: PlaymatId): void {
  try {
    globalThis.localStorage?.setItem(storageKey(player), id);
  } catch {
    // See loadPlaymat.
  }
}

export function initialPlaymats(): Record<PlayerId, PlaymatId> {
  return { p1: loadPlaymat('p1'), p2: loadPlaymat('p2') };
}
