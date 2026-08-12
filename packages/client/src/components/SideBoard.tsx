import type { ReactElement } from 'react';
import type { PlayerId } from '@optcg/engine';
import { playerLabel, useCanAttachDon, useWhoActs } from '../store/selectors';
import { useStore } from '../store/store';
import { CharacterRow } from './CharacterRow';
import { DeckPile } from './DeckPile';
import { DonArea } from './DonArea';
import { HandRow } from './HandRow';
import { LeaderSlot } from './LeaderSlot';
import { LifeStack } from './LifeStack';
import { StageSlot } from './StageSlot';
import styles from './SideBoard.module.css';

interface SideBoardProps {
  player: PlayerId;
  /**
   * Top half of the table. Mirrors the **order of the rows**, never the glyphs:
   * the row nearest the centre line is still the Character area, but nothing is
   * rotated, so every label on the opponent's half reads the right way up.
   *
   * Phase 1 rotated this half 180deg, which put the Character rows facing each
   * other at the cost of upside-down text. `column-reverse` buys the first
   * without the second, and leaves the DOM order — and therefore every
   * accessible name and every test that walks it — untouched.
   */
  mirrored: boolean;
}

/**
 * One player's half of the table, in the order the official playmat uses,
 * read from the centre line outwards:
 *
 *   Characters · Leader/Stage/Deck (+ Life at the edge) · DON!! row · Hand
 */
export function SideBoard({ player, mirrored }: SideBoardProps): ReactElement | null {
  const gameState = useStore((s) => s.gameState);
  const veilOpponentHand = useStore((s) => s.ui.veilOpponentHand);
  const uiEvent = useStore((s) => s.uiEvent);
  const viewTrash = useStore((s) => s.viewTrash);
  const attachingDon = useStore((s) => s.ui.mode.kind === 'attachingDon');
  const whoActs = useWhoActs();
  const canAttachDon = useCanAttachDon();

  if (gameState === null) {
    return null;
  }
  // "Mine" is relative to who acts now, which is what affordances describe.
  const mine = whoActs === player;
  const label = playerLabel(player);
  const ps = gameState.players[player];
  const donActive = ps.don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
  ).length;
  const donRested = ps.don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
  ).length;
  const donDeck = ps.don.filter((don) => don.location.kind === 'donDeck').length;

  return (
    <section
      className={`${styles.sideBoard} ${mirrored ? styles.mirrored : ''}`}
      aria-label={label}
    >
      <div className={styles.field} role="group" aria-label={`Campo de ${label}`}>
        <CharacterRow ids={ps.characters} mine={mine} />

        <div className={styles.mainRow}>
          <LifeStack count={ps.life.length} />
          <LeaderSlot id={ps.leader} mine={mine} />
          <StageSlot id={ps.stage} mine={mine} />
          <DeckPile label="Mazo" count={ps.deck.length} />
        </div>

        <div className={styles.donRow}>
          <DeckPile label="Mazo DON!!" count={donDeck} compact />
          <DonArea
            active={donActive}
            rested={donRested}
            clickable={mine && canAttachDon}
            attaching={mine && attachingDon}
            onClick={() => uiEvent({ kind: 'clickDonArea' })}
          />
          {/* The one pile you may read: public information in the real game. */}
          <DeckPile
            label="Descarte"
            count={ps.trash.length}
            compact
            onOpen={() => viewTrash(player)}
          />
        </div>
      </div>

      {/* The veil hides whoever is NOT acting — during a battle that is the
          attacker, so the defender can always read their own counters. */}
      <HandRow
        ids={ps.hand}
        mine={mine}
        veiled={!mine && veilOpponentHand}
        owner={label}
        fanUp={!mirrored}
      />
    </section>
  );
}
