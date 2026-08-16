import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useChoiceOverlay } from '../store/selectors';
import { useStore } from '../store/store';
import { CardBack } from './CardBack';
import { CardTile } from './CardTile';
import styles from './ChoiceOverlay.module.css';

/**
 * The one overlay a player cannot dismiss.
 *
 * There is no cancel and no backdrop click: while the engine holds a choice
 * open its owner has exactly one legal action, and offering a way out would
 * offer a move that does not exist. It is also the one place where the answer
 * space comes from `state.pending` rather than from `legalActions` — the
 * documented exception, see `game/affordances.ts`.
 *
 * It appears only once the animation queue has drained, so the board has
 * finished showing what happened before the player is asked about it.
 */
export function ChoiceOverlay(): ReactElement | null {
  const view = useChoiceOverlay();
  const m = useMessages();
  const uiEvent = useStore((s) => s.uiEvent);

  if (view === null) {
    return null;
  }

  const blind = view.blind;
  const partition = view.kind === 'partitionCards';
  // A partition is an ordering plus a side, so everything the ordering mode does
  // — click in draw order, show the position — it does too.
  const ordering = view.kind === 'orderCards' || partition;

  // An ordering is a permutation, so its cardinality line is not about *how
  // many* — it is about which end of the list comes back first. The engine puts
  // the first card of the answer nearest the top of the deck, and a player who
  // has to work that out from a count is a player guessing.
  //
  // The partition says the same thing twice, because it is true of both sides:
  // each list reads as draw order, and the only extra decision is which end.
  const cardinality =
    view.kind === 'yesNo'
      ? null
      : blind !== null
        ? view.min === view.max
          ? m.choice.blindExactly(view.min)
          : m.choice.blindUpTo(view.max)
        : partition
          ? m.choice.partitionHint
          : ordering
            ? m.choice.orderHint
            : view.min === view.max
              ? m.choice.exactly(view.min)
              : view.min === 0
                ? m.choice.upToNone(view.max)
                : m.choice.between(view.min, view.max);

  const progress =
    blind !== null
      ? m.choice.progressBlind(blind.selected.length, blind.count)
      : partition
        ? m.choice.progressPartition(
            view.selected.length,
            view.candidates.length,
            view.toTop.length,
            view.selected.length -
              view.toTop.filter((id) => view.selected.includes(id)).length,
          )
        : ordering
          ? m.choice.progressOrdered(view.selected.length, view.candidates.length)
          : m.choice.progressSelected(view.selected.length);

  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={m.choice.dialogLabel}
      >
        <span className={styles.who}>{m.choice.decides(playerLabel(view.player, m))}</span>
        {view.sourceName === null ? null : (
          <span className={styles.source}>{view.sourceName}</span>
        )}
        {/* Verbatim engine text, and it stays English in every locale: the
            prompt is a string the ability composed, not a message this client
            owns. The line under it is the card's own effect text, translated —
            which is the sentence a Spanish reader can actually work from. */}
        <p className={styles.prompt} lang="en">
          {view.prompt}
        </p>
        {view.sourceText === null ? null : (
          <p className={styles.sourceText}>{view.sourceText}</p>
        )}
        {/* The card doing the asking is already on show in the preview rail —
            `usePreview` falls back to the top of the stack while a choice is
            open. This is the pointer to it, so the question reads as being
            about a card rather than about a prompt string. */}
        <span className={styles.previewHint}>{m.choice.previewHint}</span>

        {view.kind === 'yesNo' ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.no}
              onClick={() => uiEvent({ kind: 'answerYesNo', value: false })}
            >
              {m.common.no}
            </button>
            <button
              type="button"
              className={styles.yes}
              onClick={() => uiEvent({ kind: 'answerYesNo', value: true })}
            >
              {m.common.yes}
            </button>
          </div>
        ) : (
          <>
            <span className={styles.cardinality}>
              {cardinality} — {progress}
            </span>
            {/* The one line that says why there is nothing to look at. A blind
                choice offers backs, and the preview rail — which every other
                choice leans on — has no face to enlarge here. Saying so is the
                difference between a deliberate rule and a broken panel. */}
            {blind === null ? null : <p className={styles.blindNote}>{m.choice.blindNote}</p>}
            <div className={styles.candidates}>
              {blind === null
                ? null
                : Array.from({ length: blind.count }, (_, handle) => (
                    <CardBack
                      key={handle}
                      label={m.choice.blindCard(handle + 1, blind.count)}
                      selected={blind.selected.includes(handle)}
                      onClick={() => uiEvent({ kind: 'toggleChoiceHandle', handle })}
                    />
                  ))}
              {/* CardTile is itself a button and already fires a zone event,
                  which the reducer routes to a toggle while a choice is open —
                  so no wrapper button here, and no nested interactive element.
                  The ordering mode adds a position badge and nothing else: the
                  interaction is "click them in order", which needs no drag
                  library and no second way to click a card. Hovering still
                  previews, which matters more here than anywhere else — the
                  player is choosing what to bury and has to be able to read it. */}
              {view.candidates.map((id) => {
                if (!ordering) {
                  return <CardTile key={id} id={id} zone="field" mine />;
                }
                const at = view.selected.indexOf(id);
                const onTop = view.toTop.includes(id);
                return (
                  <span
                    key={id}
                    className={styles.ordered}
                    aria-label={at === -1 ? m.choice.unordered : m.choice.position(at + 1)}
                  >
                    <span className={styles.position} data-placed={at !== -1}>
                      {at === -1 ? '–' : at + 1}
                    </span>
                    <CardTile id={id} zone="field" mine />
                    {/* The side toggle, and it is a real button rather than a
                        second meaning for the tile click: the tile already means
                        "put this next in the order", and a control that changed
                        meaning depending on where you hit the card would be the
                        one place in this UI a player could not predict. It reads
                        its own state, so a screen reader gets the side without
                        the colour. */}
                    {!partition ? null : (
                      <button
                        type="button"
                        className={styles.side}
                        data-top={onTop}
                        aria-pressed={onTop}
                        aria-label={onTop ? m.choice.toTop : m.choice.toBottom}
                        onClick={() => uiEvent({ kind: 'toggleChoiceSide', instanceId: id })}
                      >
                        {onTop ? m.choice.top : m.choice.bottom}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.confirm}
                disabled={!view.canConfirm}
                onClick={() => uiEvent({ kind: 'confirmChoice' })}
              >
                {m.common.confirm}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
