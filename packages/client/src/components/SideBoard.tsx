import type { ReactElement } from 'react';
import type { PlayerId } from '@optcg/engine';
import { playerLabel, useCanAttachDon, useWhoActs } from '../store/selectors';
import { useStore } from '../store/store';
import { CharacterRow } from './CharacterRow';
import { DonArea } from './DonArea';
import { HandRow } from './HandRow';
import { LeaderSlot } from './LeaderSlot';
import { LifeStack } from './LifeStack';
import { StageSlot } from './StageSlot';
import styles from './SideBoard.module.css';

interface SideBoardProps {
  player: PlayerId;
  /** Top half of the table: rendered upside-down for the non-active player. */
  inverted: boolean;
}

export function SideBoard({ player, inverted }: SideBoardProps): ReactElement | null {
  const gameState = useStore((s) => s.gameState);
  const veilOpponentHand = useStore((s) => s.ui.veilOpponentHand);
  const uiEvent = useStore((s) => s.uiEvent);
  const attachingDon = useStore((s) => s.ui.mode.kind === 'attachingDon');
  const whoActs = useWhoActs();
  const canAttachDon = useCanAttachDon();

  if (gameState === null) {
    return null;
  }
  // "Mine" is relative to who acts now, which is what affordances describe.
  const mine = whoActs === player;
  const ps = gameState.players[player];
  const donActive = ps.don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
  ).length;
  const donRested = ps.don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
  ).length;
  const donDeck = ps.don.filter((don) => don.location.kind === 'donDeck').length;

  return (
    <div className={`${styles.sideBoard} ${inverted ? styles.inverted : ''}`}>
      <div className={styles.playerName}>{playerLabel(player)}</div>
      {/* The veil hides whoever is NOT acting — during a battle that is the
          attacker, so the defender can always read their own counters. */}
      <HandRow ids={ps.hand} mine={mine} veiled={!mine && veilOpponentHand} />
      <div className={styles.fieldRow}>
        <LifeStack count={ps.life.length} />
        <LeaderSlot id={ps.leader} mine={mine} />
        <CharacterRow ids={ps.characters} mine={mine} />
        <StageSlot id={ps.stage} mine={mine} />
        <DonArea
          active={donActive}
          rested={donRested}
          deck={donDeck}
          clickable={mine && canAttachDon}
          attaching={mine && attachingDon}
          onClick={() => uiEvent({ kind: 'clickDonArea' })}
        />
      </div>
    </div>
  );
}
