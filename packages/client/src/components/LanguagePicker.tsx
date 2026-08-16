import type { ReactElement } from 'react';
import { LOCALES } from '../i18n';
import type { Locale } from '../i18n';
import { useMessages } from '../i18n/useMessages';
import { useStore } from '../store/store';
import styles from './LanguagePicker.module.css';

/**
 * The language control, offered in the lobby and during play alike.
 *
 * **Hot, and that is the whole design.** The language is presentation: no
 * action is dispatched, no socket byte is written, no game state is touched.
 * Switching mid-match re-renders the board and the log in the other language
 * and changes nothing about the match — the two seats can read the same game in
 * two languages at once, because neither of them ever told the other one.
 *
 * A `<select>` rather than a pair of buttons: it is two options now and the
 * project is one where a third is a translation away, and a select does not
 * grow a layout problem when that happens.
 */
export function LanguagePicker(): ReactElement {
  const m = useMessages();
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);

  return (
    <label className={styles.picker}>
      <span className={styles.label}>{m.language.label}</span>
      <select
        className={styles.select}
        value={locale}
        aria-label={m.language.label}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((option) => (
          // Each language names itself in itself: somebody looking for Spanish
          // is looking for the word "Español", not for whatever the language
          // they cannot read calls it.
          <option key={option} value={option}>
            {m.language[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
