import { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useLocale } from './i18n/useMessages';
import { LobbyScreen } from './screens/LobbyScreen';
import { SetupScreen } from './screens/SetupScreen';
import { useStore } from './store/store';

/**
 * The board, and everything only the board needs — including Motion, which is
 * the one runtime library this client depends on and about forty gzipped
 * kilobytes of it.
 *
 * Split here rather than fought with inside Motion. `layoutId` requires
 * Motion's full feature set, so there is no lighter build to pick; what there
 * is, is the fact that nobody choosing a deck needs any of it. Setup and the
 * lobby now load without it and the chunk arrives while somebody reads their
 * opening hand.
 *
 * Suspense falls back to nothing on purpose. It is one chunk on the same
 * origin, already warm by the second game, and a spinner for it would flash.
 */
const GameScreen = lazy(async () => ({
  default: (await import('./screens/GameScreen')).GameScreen,
}));

export function App(): ReactElement {
  const screen = useStore((s) => s.screen);
  const locale = useLocale();
  const [lobby, setLobby] = useState(false);

  // The document's language follows the client's. It is what a screen reader
  // picks a voice from and what the browser offers to translate against, so
  // shipping `lang="es"` in index.html and then rendering English would be a
  // lie told to exactly the readers who cannot check it.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  if (screen === 'playing') {
    return (
      <Suspense fallback={null}>
        <GameScreen />
      </Suspense>
    );
  }
  return lobby ? (
    <LobbyScreen onBack={() => setLobby(false)} />
  ) : (
    <SetupScreen onNetwork={() => setLobby(true)} />
  );
}
