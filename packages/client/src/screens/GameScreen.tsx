import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { ActionBar } from '../components/ActionBar';
import { AnimationDriver } from '../components/AnimationDriver';
import { Banner } from '../components/Banner';
import { BattleOverlay } from '../components/BattleOverlay';
import { CardMenu } from '../components/CardMenu';
import { CardPreview } from '../components/CardPreview';
import { ChoiceOverlay } from '../components/ChoiceOverlay';
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
        {/* Two constant-width rails around a fluid board: the preview on the
            left, the log on the right. The preview slot is always rendered,
            empty or not, so nothing on the board moves when the pointer does. */}
        <CardPreview />
        <Table />
        <EventLog />
      </div>
      <ActionBar />
      <BattleOverlay />
      {cardToPlay === null ? null : <TrashChoiceModal cardToPlay={cardToPlay} />}
      <CardMenu />
      {/* Above the menu and the battle panel: an open choice is the only legal
          move its owner has, so nothing may sit on top of it. */}
      <ChoiceOverlay />
      <MulliganOverlay />
      <GameOverOverlay />
      <PassDeviceScreen />
    </div>
  );
}
