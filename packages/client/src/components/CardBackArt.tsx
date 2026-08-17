import type { ReactElement } from 'react';
import styles from './CardBackArt.module.css';

/**
 * The card back this repository ships.
 *
 * **Ours, and deliberately not a copy of anyone else's.** The official back is
 * Bandai's artwork; this project redistributes none of it, so a clone with no
 * local archive still needs a back to draw — every pile, every life card, every
 * hand a view publishes as a count, and the blind candidates of a choice. This
 * is that back: a ring and a compass rose over the same plum the tiles already
 * use, drawn from the palette in `tokens.css`.
 *
 * An inline SVG rather than a file. `.gitignore` refuses every raster format
 * repository-wide and `packages/cards/tests/noTrackedArt.test.ts` fails if one
 * reaches the index, so the committed fallback has to be vector — and an
 * imported `.svg` asset would need Vite's asset pipeline, which the client's
 * `vitest.config.ts` does not load. A component needs neither.
 *
 * When the local archive *does* have the official back, it is painted over this
 * one as a `background-image` on the card element. A missing file is then a
 * declaration that does not paint, which is why there is no error state here.
 */
export function CardBackArt(): ReactElement {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 63 88"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="63" height="88" rx="4" className={styles.field} />
      <rect x="3.5" y="3.5" width="56" height="81" rx="2.5" className={styles.frame} />
      <circle cx="31.5" cy="44" r="17" className={styles.ring} />
      <circle cx="31.5" cy="44" r="11" className={styles.ring} />
      {/* A compass rose: four points, because a back needs a centre and this
          project is about a crew that sails. */}
      <path d="M31.5 27 L35 44 L31.5 61 L28 44 Z" className={styles.rose} />
      <path d="M14.5 44 L31.5 40.5 L48.5 44 L31.5 47.5 Z" className={styles.rose} />
    </svg>
  );
}
