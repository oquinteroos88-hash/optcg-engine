import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useLocale } from './i18n/useMessages';
import { GameScreen } from './screens/GameScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { SetupScreen } from './screens/SetupScreen';
import { useStore } from './store/store';

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
    return <GameScreen />;
  }
  return lobby ? (
    <LobbyScreen onBack={() => setLobby(false)} />
  ) : (
    <SetupScreen onNetwork={() => setLobby(true)} />
  );
}
