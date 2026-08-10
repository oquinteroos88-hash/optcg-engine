import { useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { cardImageSrc, hasCardImage } from '../game/cardImage';
import {
  useCardView,
  useClickState,
  useIsHighlighted,
  usePowerBreakdown,
  useTargeting,
} from '../store/selectors';
import { useStore } from '../store/store';
import styles from './CardTile.module.css';

interface CardTileProps {
  id: InstanceId;
  /** Which zone the tile lives in — decides which UiEvent a click fires. */
  zone: 'hand' | 'field';
  /** True when the tile belongs to the player who acts now. */
  mine: boolean;
  /** Face-down rendering (veiled opponent hand). */
  veiled?: boolean;
}

export function CardTile({ id, zone, mine, veiled = false }: CardTileProps): ReactElement | null {
  const view = useCardView(id);
  const clickState = useClickState(id);
  const targeting = useTargeting();
  const highlighted = useIsHighlighted(id);
  const power = usePowerBreakdown(id);
  const uiEvent = useStore((s) => s.uiEvent);
  /**
   * The art is a local cache that a fresh clone does not have, so "no image" is
   * the normal state and not an error. `failed` stops asking; `ok` is what
   * turns on the scrim, and only once a picture is really behind the text.
   */
  const [art, setArt] = useState<'unknown' | 'ok' | 'failed'>('unknown');

  if (view === null) {
    return null;
  }
  if (veiled) {
    return <div className={`${styles.card} ${styles.back}`} aria-label="Carta oculta" />;
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    // Cards must not bubble into the table background (which clears the mode).
    e.stopPropagation();
    if (zone === 'hand') {
      uiEvent({ kind: 'clickHandCard', instanceId: id });
    } else {
      uiEvent({ kind: 'clickFieldCard', instanceId: id, mine });
    }
  };

  const colorClass = styles[view.colorClass] ?? '';
  const restedClass = view.rested ? styles.rested : '';
  const stateClass = styles[clickState] ?? '';
  const dimClass = targeting && clickState === 'inert' ? styles.dimmed : '';
  const animClass = highlighted ? styles.animating : '';
  const artClass = art === 'ok' ? styles.withArt : '';

  const counterLabel = view.counter === null ? 'sin contraataque' : `contraataque ${view.counter}`;
  const costLabel = view.cost === null ? '' : `coste ${view.cost}, `;

  // Why this card shows the power it shows. Continuous effects emit no events,
  // so the log can never explain one — the only place a player can find out is
  // on the card itself. Printed text goes in the same tooltip: with real cards
  // a player cannot play what they cannot read.
  const powerLines: string[] = [];
  if (power.fromDon > 0) {
    powerLines.push(`+${power.fromDon} por DON!! adjuntados`);
  }
  if (power.fromModifiers !== 0) {
    const from =
      power.modifierSources.length > 0 ? ` (${power.modifierSources.join(', ')})` : '';
    powerLines.push(`${power.fromModifiers > 0 ? '+' : ''}${power.fromModifiers} temporal${from}`);
  }
  if (power.fromStatics !== 0) {
    const from =
      power.staticSources.length > 0 ? ` (${power.staticSources.join(', ')})` : ' (efecto continuo)';
    powerLines.push(`${power.fromStatics > 0 ? '+' : ''}${power.fromStatics} continuo${from}`);
  }
  if (power.grantedKeywords.length > 0) {
    powerLines.push(`Otorgado: ${power.grantedKeywords.join(', ')}`);
  }

  const tooltip = [
    view.name,
    powerLines.length > 0 ? `Poder ${power.printed} base · ${powerLines.join(' · ')}` : '',
    view.effectText ?? '',
    view.triggerText === null ? '' : `[Trigger] ${view.triggerText}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const boostLabel = powerLines.length > 0 ? `, ${powerLines.join(', ')}` : '';

  return (
    <button
      type="button"
      className={`${styles.card} ${colorClass} ${restedClass} ${stateClass} ${dimClass} ${animClass} ${artClass}`}
      onClick={handleClick}
      title={tooltip}
      aria-label={`${view.name}, ${costLabel}poder ${view.power}, ${counterLabel}${view.rested ? ', agotada' : ''}${boostLabel}`}
    >
      {/* Underneath everything, and never a click target: every indicator the
          engine derives - power, DON!!, rested, the continuous badge, the
          affordance highlight - has to stay readable ON TOP of the art, because
          none of it is printed on the card. An onError drops back to the CSS
          tile this component has always drawn. */}
      {art === 'failed' || !hasCardImage(view.cardId) ? null : (
        <img
          className={styles.art}
          src={cardImageSrc(view.cardId)}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={() => setArt('ok')}
          onError={() => setArt('failed')}
        />
      )}
      <div className={styles.header}>
        {view.cost === null ? null : <span className={styles.cost}>{view.cost}</span>}
        <span className={styles.name}>{view.name}</span>
      </div>
      <div className={styles.stats}>
        <span className={`${styles.power} ${power.fromStatics !== 0 ? styles.boosted : ''}`}>
          {view.power}
        </span>
        <span className={styles.counter}>{view.counter === null ? '—' : `+${view.counter}`}</span>
      </div>
      {view.donCount > 0 ? <span className={styles.donBadge}>DON ×{view.donCount}</span> : null}
      {/* A continuous effect writes nothing to the state and emits no event, so
          this marker is the only trace of it anywhere in the UI. */}
      {power.fromStatics !== 0 ? (
        <span className={styles.staticBadge} aria-hidden="true">
          {power.fromStatics > 0 ? '+' : ''}
          {power.fromStatics}
        </span>
      ) : null}
      {view.effectText === null && view.triggerText === null ? null : (
        <span className={styles.textMark} aria-hidden="true">
          ★
        </span>
      )}
    </button>
  );
}
