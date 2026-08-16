import { useState } from 'react';
import type { ReactElement } from 'react';
import { GameScreen } from './screens/GameScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { SetupScreen } from './screens/SetupScreen';
import { useStore } from './store/store';

export function App(): ReactElement {
  const screen = useStore((s) => s.screen);
  const [lobby, setLobby] = useState(false);

  if (screen === 'playing') {
    return <GameScreen />;
  }
  return lobby ? (
    <LobbyScreen onBack={() => setLobby(false)} />
  ) : (
    <SetupScreen onNetwork={() => setLobby(true)} />
  );
}
