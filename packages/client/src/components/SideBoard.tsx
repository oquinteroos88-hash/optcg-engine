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
   * Top half of the table. Mirrors **where each zone sits**, never the glyphs:
   * the row nearest the centre line is still the Character Area, but nothing is
   * rotated, so every label on the opponent's half reads the right way up.
   *
   * Phase 1 rotated this half 180deg, which put the Character rows facing each
   * other at the cost of upside-down text. The mirror is now a second
   * `grid-template-areas` — a placement, not a transform — which leaves the DOM
   * order, and therefore every accessible name and every test that walks it,
   * untouched.
   */
  mirrored: boolean;
}

/**
 * One player's half of the table: the official playsheet, as a named grid.
 *
 * The zone names are the ones Bandai prints on the mat, and the template in
 * `SideBoard.module.css` is laid out the way the mat is — Life hugging the
 * outer edge, the Character Area along the edge nearest the opponent, then
 * Leader/Stage/Deck, then the DON!! deck / Cost Area / Trash row, with the
 * phase track in the free space the mat prints it in.
 *
 * The hand is not a zone of the mat and sits outside the grid, which is also
 * why its fan geometry is none of this component's business.
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
        <div className={styles.life}>
          <LifeStack count={side.lifeCount} />
        </div>

        <div className={styles.character}>
          <CharacterRow ids={side.characters} mine={mine} />
        </div>

        <div className={styles.leader}>
          <LeaderSlot id={side.leader} mine={mine} />
        </div>

        <div className={styles.stage}>
          <StageSlot id={side.stage} mine={mine} />
        </div>

        <div className={styles.deck}>
          <DeckPile label={m.board.deck} count={side.deckCount} />
        </div>

        <div className={styles.don}>
          <DeckPile label={m.board.donDeck} count={side.donDeck} compact />
        </div>

        <div className={styles.cost}>
          <DonArea
            active={side.donActive}
            rested={side.donRested}
            clickable={mine && canAttachDon}
            attaching={mine && attachingDon}
            onClick={() => uiEvent({ kind: 'clickDonArea' })}
          />
        </div>

        <div className={styles.trash}>
          {/* The one pile you may read: public information in the real game. */}
          <DeckPile
            label={m.board.trash}
            count={side.trashCount}
            compact
            onOpen={() => viewTrash(player)}
          />
        </div>

        {/* The `phases` area is in the template and is deliberately empty here:
            the mat prints the phase track in this space, and the track itself
            arrives with the selector that knows which phase is live. */}
      </div>

      {/* A hand the view publishes in full is drawn face-up; one it publishes
          as a count is drawn as that many backs, and there is nothing behind
          them to reveal. The veil is the hot-seat courtesy on top of that —
          it hides a hand this seat *may* read but its holder would rather not
          show across the table. */}
      <div className={styles.hand}>
        <HandRow
          ids={side.hand}
          count={side.handCount}
          mine={mine}
          veiled={!mine && veilOpponentHand}
          owner={label}
          fanUp={!mirrored}
        />
      </div>
    </section>
  );
}
