import type { ReactElement } from 'react';
import { GameScreen } from './screens/GameScreen';
import { SetupScreen } from './screens/SetupScreen';
import { useStore } from './store/store';

export function App(): ReactElement {
  const screen = useStore((s) => s.screen);
  return screen === 'setup' ? <SetupScreen /> : <GameScreen />;
}
