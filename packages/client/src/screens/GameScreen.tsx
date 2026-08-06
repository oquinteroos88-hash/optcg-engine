import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { ActionBar } from '../components/ActionBar';
import { AnimationDriver } from '../components/AnimationDriver';
import { Banner } from '../components/Banner';
import { BattleOverlay } from '../components/BattleOverlay';
import { EventLog } from '../components/EventLog';
import { GameOverOverlay } from '../components/GameOverOverlay';
import { MulliganOverlay } from '../components/MulliganOverlay';
import { PassDeviceScreen } from '../components/PassDeviceScreen';
import { Table } from '../components/Table';
import { TrashChoiceModal } from '../components/TrashChoiceModal';
import { useChoosingTrash, useInputBlocked } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './GameScreen.module.css';

export function GameScreen(): ReactElement {
  const uiEvent = useStore((s) => s.uiEvent);
  const blocked = useInputBlocked();
  const cardToPlay = useChoosingTrash();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        uiEvent({ kind: 'escape' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [uiEvent]);

  return (
    <div className={styles.screen}>
      <AnimationDriver />
      <Banner />
      <div className={`${styles.main} ${blocked ? styles.blocked : ''}`}>
        <Table />
        <EventLog />
      </div>
      <ActionBar />
      <BattleOverlay />
      {cardToPlay === null ? null : <TrashChoiceModal cardToPlay={cardToPlay} />}
      <MulliganOverlay />
      <GameOverOverlay />
      <PassDeviceScreen />
    </div>
  );
}
