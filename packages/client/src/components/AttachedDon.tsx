import type { CSSProperties, ReactElement } from 'react';
import styles from './AttachedDon.module.css';

/**
 * The DON!! given to a card, drawn the way they lie on the table: fanned out
 * from under the card that carries them, offset by a few pixels each.
 *
 * They live in the slack a square slot already reserves for a rested card, so
 * they cost the layout nothing and cannot reach a neighbour — the slot clips
 * them. Under the tile, never over it: everything the player has to read is
 * printed on the card's own face.
 *
 * Decoration, and marked as such. The tile already draws a `DON ×n` badge and
 * this says the same thing in pictures; announcing it twice would be noise.
 * (That the badge itself is not in the tile's accessible name is older than
 * this component and is not something drawing cards under it changes.)
 *
 * A count, never an identity. Which DON!! is attached is not information the
 * game asks anyone to keep, and `SideView.attachedDon` does not carry it.
 */
export function AttachedDon({ count }: { count: number }): ReactElement | null {
  if (count <= 0) {
    return null;
  }
  // Past four the fan stops being readable and the badge is what answers "how
  // many". Drawing thirty slivers would answer nothing.
  const drawn = Math.min(count, 4);
  return (
    <div className={styles.fan} aria-hidden="true">
      {Array.from({ length: drawn }, (_, i) => (
        <div key={i} className={styles.don} style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}
