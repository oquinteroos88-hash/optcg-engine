import { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import type { MouseEvent, ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { cardImageSrc, hasCardImage } from '../game/cardImage';
import { useLongPress } from '../game/longPress';
import { useMessages } from '../i18n/useMessages';
import {
  powerLinesOf,
  useCardView,
  useClickState,
  useIsHighlighted,
  useIsFlipping,
  useLungingAttacker,
  usePowerBreakdown,
  useTargeting,
} from '../store/selectors';
import { useStore } from '../store/store';
import { CardBackArt } from './CardBackArt';
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
  const flipping = useIsFlipping(id);
  const lungingAttacker = useLungingAttacker();
  const power = usePowerBreakdown(id);
  const m = useMessages();
  const uiEvent = useStore((s) => s.uiEvent);
  const hover = useStore((s) => s.hover);
  const pressCard = useStore((s) => s.pressCard);
  const press = useLongPress(
    useCallback(() => pressCard(id), [pressCard, id]),
    useCallback(() => pressCard(null), [pressCard]),
  );
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
    // The same back the piles and the Life column draw. A hand you may not
    // read looks like a hand nobody can read, because that is what it is.
    return (
      <div className={`${styles.card} ${styles.back}`} aria-label={m.common.hiddenCardLabel}>
        <CardBackArt />
      </div>
    );
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    // Cards must not bubble into the table background (which clears the mode).
    e.stopPropagation();
    // The click a browser fires after a long press was a look, not a move.
    // Exactly one is swallowed, and only when the press really opened a view.
    if (press.consumeClick()) {
      return;
    }
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

  // Why this card shows the power it shows. Continuous effects emit no events,
  // so the log can never explain one - the only place a player can find out is
  // on the card itself, and now also in the preview panel, which is why the
  // lines are built once in the view-model layer rather than here.
  const powerLines = powerLinesOf(power, m);

  const tooltip = [
    // The name is the card's own and stays English; everything around it is a
    // message.
    view.name,
    powerLines.length > 0 ? m.card.tooltipPower(power.printed, powerLines) : '',
    view.effectText ?? '',
    view.triggerText === null ? '' : `${m.card.triggerPrefix} ${view.triggerText}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const clickable = clickState !== 'inert';
  // Keyframe arrays only when the moment is on. A card that is not flipping
  // gets the scalar 0, so an unrelated re-render cannot replay the turn.
  const lunging = lungingAttacker === id;

  return (
    /**
     * `layoutId` is the whole journey system: one card, one id, and Motion
     * animates it between wherever it was and wherever the new view puts it —
     * hand to field, field to trash, deck to hand. Nothing schedules those
     * moves. The store has already applied the update and this element is
     * already in its new parent; the animation is catching up to a DOM that is
     * telling the truth, which is why an update landing mid-flight re-targets
     * rather than corrupting anything.
     *
     * The id is the viewer's own `InstanceId` from its own view. Motion
     * consumes `layoutId` and never writes it to the DOM, and a card the viewer
     * may not identify has no id in the view to begin with — it is drawn as an
     * anonymous back, which is exactly what it is.
     */
    <motion.button
      type="button"
      layoutId={id}
      layout="position"
      /* Rested is a real rotation, and now an animated one. It used to be a CSS
         class; Motion owns `transform` on this element, so a CSS rule setting
         one would be overridden and silently stop working. Same for the hover
         lift and the highlight bounce — all three live here now. */
      /* A flip needs depth or it reads as a horizontal squash. */
      style={{ transformPerspective: 700 }}
      animate={{
        rotate: view.rested ? 90 : 0,
        y: highlighted ? -3 : 0,
        /* The flip. Half a turn about the vertical axis, from back to face, for
           a card the view has just decided this seat may see: your own draw,
           your own life card, and a `[Trigger]` whose activation revealed it.
           `useIsFlipping` reads that off the redacted events, so the card turns
           over exactly when the rules turned it over. */
        rotateY: flipping ? [180, 0] : 0,
        /* The lunge: a shove towards the defender and back. Sign follows the
           seat, so both attackers move towards the centre line. */
        x: lunging ? [0, mine ? -14 : 14, 0] : 0,
      }}
      {...(clickable ? { whileHover: { y: highlighted ? -3 : -4 } } : {})}
      className={`${styles.card} ${colorClass} ${restedClass} ${stateClass} ${dimClass} ${animClass} ${artClass}`}
      onClick={handleClick}
      /* Hold to look. Only on a pointer that has no hover — a mouse keeps the
         two handlers below and never reaches this. See game/longPress.ts. */
      onPointerDown={press.onPointerDown}
      onPointerMove={press.onPointerMove}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onMouseEnter={() => hover(id)}
      onMouseLeave={() => hover(null)}
      // Keyboard parity: tabbing through the board previews too.
      onFocus={() => hover(id)}
      onBlur={() => hover(null)}
      title={tooltip}
      aria-label={m.card.tile({
        name: view.name,
        cost: view.cost,
        power: view.power,
        counter: view.counter,
        rested: view.rested,
        boosts: powerLines,
      })}
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
    </motion.button>
  );
}
