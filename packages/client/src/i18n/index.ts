/**
 * The client's whole i18n layer: two typed dictionaries, one lookup, no library.
 *
 * There is no runtime key resolution and no `t('some.key')` string lookup —
 * messages are read as properties of a typed object, so a key that does not
 * exist is a compile error and a key that exists in one language and not the
 * other cannot be written at all. `es.ts` is typed `Messages`, which is
 * `typeof en`, and that single line is the entire exhaustiveness mechanism.
 *
 * Parameters go **into** the message, never around it: `m.log.cardDrawn(name)`,
 * never `m.log.drew + ' ' + name`. Word order and plural agreement are not
 * shared between languages, so the sentence has to be one unit per language.
 */
import { en } from './en';
import { es } from './es';
import type { Locale } from './locale';

export type { Messages } from './en';
export type { Locale } from './locale';
export {
  LOCALES,
  initialLocale,
  isLocale,
  loadLocale,
  localeFromNavigator,
  saveLocale,
} from './locale';

const DICTIONARIES = { en, es } as const;

export function messagesFor(locale: Locale): (typeof DICTIONARIES)[Locale] {
  return DICTIONARIES[locale];
}
