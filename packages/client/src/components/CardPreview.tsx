import { useState } from 'react';
import type { ReactElement } from 'react';
import { cardArtSrc, hasCardImage } from '../game/cardImage';
import { usePreview } from '../store/selectors';
import styles from './CardPreview.module.css';

/**
 * The one place a card is shown large.
 *
 * A fixed panel rather than a card that grows in place, and that is the whole
 * point: scaling a tile where it sits moves the row it is in and covers its
 * neighbours, which happens exactly while a player is comparing it against
 * them. The slot is always rendered at a constant size, empty or not, so the
 * board never shifts when the pointer moves.
 *
 * It works with no art at all — a fresh clone has none — by drawing the same
 * text card the tiles fall back to, at a size where the printed text is
 * actually readable.
 */
export function CardPreview(): ReactElement {
  const view = usePreview();
  const [failed, setFailed] = useState<string | null>(null);

  if (view === null) {
    return (
      <aside className={styles.panel} aria-label="Vista de carta">
        <div className={styles.empty} aria-hidden="true">
          Pasá el mouse por una carta
        </div>
      </aside>
    );
  }

  const showArt = hasCardImage(view.cardId) && failed !== view.cardId;

  return (
    <aside className={styles.panel} aria-label="Vista de carta">
      <div className={styles.art}>
        {showArt ? (
          <img
            className={styles.image}
            // The large PNG, not the tile's thumbnail: this is the one place
            // a card is shown big enough for its own art to be worth the bytes.
            src={cardArtSrc(view.cardId)}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={() => setFailed(view.cardId)}
          />
        ) : (
          // The same card the tiles draw when there is no art, at a size where
          // the printed text below it is the point rather than a tooltip.
          <div className={`${styles.fallback} ${styles[view.colorClass] ?? ''}`}>
            <span className={styles.fallbackName}>{view.name}</span>
            <span className={styles.fallbackPower}>{view.power}</span>
          </div>
        )}
      </div>

      <h2 className={styles.name}>{view.name}</h2>
      {view.fromEffect ? <span className={styles.reason}>Efecto en resolución</span> : null}

      <dl className={styles.stats}>
        {view.cost === null ? null : (
          <div className={styles.stat}>
            <dt>Coste</dt>
            <dd>{view.cost}</dd>
          </div>
        )}
        <div className={styles.stat}>
          <dt>Poder</dt>
          <dd>{view.power}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Contra</dt>
          <dd>{view.counter === null ? '—' : `+${view.counter}`}</dd>
        </div>
      </dl>

      {/* The derived power, spelled out. This is the only explanation a
          continuous effect will ever get: statics emit no events. */}
      {view.powerLines.length > 0 ? (
        <ul className={styles.breakdown}>
          <li className={styles.printed}>{view.printedPower} impreso</li>
          {view.powerLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {/* Printed text, in English: it is card text. A two-ability card arrives
          as one string with line breaks in it, so each line gets its own
          paragraph rather than running together. */}
      {view.effectText === null
        ? null
        : view.effectText.split('\n').map((line) => (
            <p key={line} className={styles.text} lang="en">
              {line}
            </p>
          ))}
      {view.triggerText === null ? null : (
        <p className={styles.text} lang="en">
          <span className={styles.marker}>[Trigger]</span> {view.triggerText}
        </p>
      )}
    </aside>
  );
}
