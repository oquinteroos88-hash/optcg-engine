import type { CSSProperties, ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { CardTile } from './CardTile';
import styles from './HandRow.module.css';

interface HandRowProps {
  ids: readonly InstanceId[];
  mine: boolean;
  /** Face-down rendering for the opponent's hand. */
  veiled?: boolean;
  /** Whose hand this is, for the accessible name. */
  owner: string;
  /** True for the bottom half: the arc opens upward, away from the board. */
  fanUp: boolean;
}

/**
 * The fan.
 *
 * Three numbers, all derived from how many cards there are:
 *
 * - **overlap** is solved from a width budget rather than picked: the fan is
 *   never allowed to occupy more than `FAN_BUDGET_CARDS` card widths, so it
 *   compresses instead of overflowing. A six-card hand does not overlap at all;
 *   a twenty-eight-card one — which a game of nothing but End Turn really
 *   produces — squeezes to the same footprint. Capped at 80% so every card
 *   keeps a visible sliver.
 *
 *   Cards stack left-to-right with the later ones on top, which is why the
 *   sliver that survives is the LEFT edge: that is where the cost badge sits
 *   and where the affordance border shows, so a playable card still reads as
 *   playable however tight the fan gets.
 *
 * - **rotation** is a fixed total sweep divided by the hand, so the fan gets
 *   denser rather than wider.
 * - **lift** is quadratic in the distance from the middle, which is what makes
 *   it an arc rather than a slant.
 *
 * All three are written as custom properties and consumed by the stylesheet,
 * never as an inline `transform`. That is deliberate: an inline transform
 * cannot be overridden by a `:hover` rule, and the hover state — straighten,
 * lift, raise — is the whole reason the fan is usable.
 *
 * **The 90deg rested rotation cannot collide with this.** The fan transform
 * lives on the wrapper; `rested` lives on the tile inside it, so even a rested
 * card in hand would compose the two rather than fight over one property. It
 * never happens anyway: `tests/handFan.test.ts` measures that no card in any
 * hand of the corpus is rested, which is the claim this design does not have to
 * rely on.
 */
const FAN_SWEEP_DEG = 26;
const MAX_TILT_DEG = 5.5;
/** The fan never occupies more than this many card widths. */
const FAN_BUDGET_CARDS = 7.5;
const MAX_OVERLAP = 0.8;

export interface FanGeometry {
  rotation: number;
  lift: number;
  overlap: number;
}

export function fanGeometry(index: number, count: number): FanGeometry {
  if (count <= 1) {
    return { rotation: 0, lift: 0, overlap: 0 };
  }
  const middle = (count - 1) / 2;
  const offset = index - middle;
  const step = Math.min(MAX_TILT_DEG, FAN_SWEEP_DEG / (count - 1));
  // width = card * (1 + (count - 1) * (1 - overlap)) <= card * FAN_BUDGET_CARDS
  const overlap = Math.min(
    MAX_OVERLAP,
    Math.max(0, 1 - (FAN_BUDGET_CARDS - 1) / (count - 1)),
  );
  // Normalized so the outermost card lifts the same however big the hand is: a
  // two-card hand should not arc as hard as a ten-card one.
  const lift = middle === 0 ? 0 : (offset / middle) ** 2 * 10;
  return { rotation: offset * step, lift, overlap };
}

export function HandRow({ ids, mine, veiled = false, owner, fanUp }: HandRowProps): ReactElement {
  return (
    <div className={styles.hand} role="group" aria-label={`Mano de ${owner}`}>
      <span className={styles.label}>Mano ({ids.length})</span>
      <div className={`${styles.cards} ${fanUp ? styles.up : styles.down}`}>
        {ids.map((id, index) => {
          const { rotation, lift, overlap } = fanGeometry(index, ids.length);
          const style = {
            '--fan-rot': `${(fanUp ? rotation : -rotation).toFixed(2)}deg`,
            '--fan-lift': `${(fanUp ? lift : -lift).toFixed(2)}px`,
            marginLeft: index === 0 ? undefined : `calc(var(--card-w) * ${-overlap})`,
            zIndex: index,
          } as CSSProperties;
          return (
            <div key={id} className={styles.slot} style={style}>
              <CardTile id={id} zone="hand" mine={mine} veiled={veiled} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
