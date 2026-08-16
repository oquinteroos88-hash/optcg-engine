/**
 * The two languages this client speaks, and where the choice comes from.
 *
 * **The language is presentation and nothing else.** It never travels: not in
 * the protocol, not in an `Action`, not in the state, not to the server. Two
 * seats can read the same match in two languages and the game does not know.
 * That is why switching is a re-render and not a reconnection.
 */
export type Locale = 'en' | 'es';

export const LOCALES: readonly Locale[] = Object.freeze(['en', 'es']);

/** Where the choice lives between reloads. Nothing else about it is stored. */
const STORAGE_KEY = 'optcg.locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es';
}

/**
 * The browser's preference, reduced to the two languages that exist here.
 *
 * `es-419`, `es-MX` and `es` all mean Spanish; anything else means English,
 * because English is what this project is written in and the one language every
 * card is guaranteed to have text for.
 */
export function localeFromNavigator(language: string | undefined | null): Locale {
  return typeof language === 'string' && language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function loadLocale(): Locale | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    // Storage disabled: the client still runs, it just forgets the choice
    // between reloads. Not worth failing a render over.
    return null;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // See loadLocale.
  }
}

/**
 * The locale a fresh client starts in: the stored choice if there is one, and
 * otherwise whatever the browser asks for.
 *
 * The stored choice wins over the browser on purpose. A player who picked a
 * language picked it; a browser that reports `en-US` on a Spanish-speaking
 * child's borrowed laptop is a guess, and a guess must not overrule an answer.
 */
export function initialLocale(): Locale {
  return loadLocale() ?? localeFromNavigator(globalThis.navigator?.language);
}
