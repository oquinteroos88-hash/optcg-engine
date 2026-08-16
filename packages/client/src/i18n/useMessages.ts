import { useStore } from '../store/store';
import { messagesFor } from './index';
import type { Messages } from './en';
import type { Locale } from './locale';

/**
 * The dictionary for the language this client is set to.
 *
 * Subscribes to the store, so a language change re-renders every component that
 * reads it — which is every component that says anything. There is no provider
 * and no context: the locale already lives in the one store the whole tree
 * reads, and a second mechanism for the same fact is a second thing to keep in
 * sync.
 */
export function useMessages(): Messages {
  return useStore((s) => messagesFor(s.locale));
}

/** The raw locale, for the few places that need the tag itself (`lang=`). */
export function useLocale(): Locale {
  return useStore((s) => s.locale);
}
