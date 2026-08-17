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

/** Where the choice lives between reloads. Nothing else about it is stored. */
function storageKey(player: PlayerId): string {
  return `optcg.playmat.${player}`;
}

export function loadPlaymat(player: PlayerId): PlaymatId {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(player));
    return typeof raw === 'string' && raw !== '' ? raw : NEUTRAL_PLAYMAT;
  } catch {
    // Storage disabled: the client still runs, it just forgets the choice
    // between reloads. Not worth failing a render over.
    return NEUTRAL_PLAYMAT;
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
