import type { ReactElement } from 'react';
import { useStore } from '../store/store';
import { CardPreview } from './CardPreview';
import styles from './HeldCard.module.css';

/**
 * The card a finger is holding down, shown large.
 *
 * The touch answer to a hover. On a desktop the preview lives in a reserved
 * rail so the board never moves when the pointer does; on a phone that rail is
 * not on screen at all, and there is no hover to fill it with — so holding a
 * card raises the same panel over the board and letting go puts it away.
 *
 * The same `CardPreview` the rail draws, deliberately. One card panel, one set
 * of rules about what it shows and what it says about a translation; a second
 * implementation for phones would drift from the first.
 *
 * `pointer-events: none` on the whole thing: this is a thing you are looking at
 * while your finger is still down somewhere else. It must not become a target.
 */
export function HeldCard(): ReactElement | null {
  const pressing = useStore((s) => s.pressing);
  if (pressing === null) {
    return null;
  }
  return (
    <div className={styles.scrim} aria-hidden="true">
      <div className={styles.panel}>
        <CardPreview />
      </div>
    </div>
  );
}
