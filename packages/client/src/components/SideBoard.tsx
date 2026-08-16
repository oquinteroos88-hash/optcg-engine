import type { ReactElement } from 'react';
import type { PlayerId } from '@optcg/engine';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useCanAttachDon, useSide, useWhoActs } from '../store/selectors';
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
  const side = useSide(player);
  const m = useMessages();
  const veilOpponentHand = useStore((s) => s.ui.veilOpponentHand);
  const uiEvent = useStore((s) => s.uiEvent);
  const viewTrash = useStore((s) => s.viewTrash);
  const attachingDon = useStore((s) => s.ui.mode.kind === 'attachingDon');
  const whoActs = useWhoActs();
  const canAttachDon = useCanAttachDon();

  if (side === null) {
    return null;
  }
  // "Mine" is relative to who acts now, which is what affordances describe.
  const mine = whoActs === player;
  const label = playerLabel(player, m);

  return (
    <section
      className={`${styles.sideBoard} ${mirrored ? styles.mirrored : ''}`}
      aria-label={label}
    >
      <div className={styles.field} role="group" aria-label={m.board.fieldOf(label)}>
        <CharacterRow ids={side.characters} mine={mine} />

        <div className={styles.mainRow}>
          <LifeStack count={side.lifeCount} />
          <LeaderSlot id={side.leader} mine={mine} />
          <StageSlot id={side.stage} mine={mine} />
          <DeckPile label={m.board.deck} count={side.deckCount} />
        </div>

        <div className={styles.donRow}>
          <DeckPile label={m.board.donDeck} count={side.donDeck} compact />
          <DonArea
            active={side.donActive}
            rested={side.donRested}
            clickable={mine && canAttachDon}
            attaching={mine && attachingDon}
            onClick={() => uiEvent({ kind: 'clickDonArea' })}
          />
          {/* The one pile you may read: public information in the real game. */}
          <DeckPile
            label={m.board.trash}
            count={side.trashCount}
            compact
            onOpen={() => viewTrash(player)}
          />
        </div>
      </div>

      {/* A hand the view publishes in full is drawn face-up; one it publishes
          as a count is drawn as that many backs, and there is nothing behind
          them to reveal. The veil is the hot-seat courtesy on top of that —
          it hides a hand this seat *may* read but its holder would rather not
          show across the table. */}
      <HandRow
        ids={side.hand}
        count={side.handCount}
        mine={mine}
        veiled={!mine && veilOpponentHand}
        owner={label}
        fanUp={!mirrored}
      />
    </section>
  );
}
