import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { playerLabel, useTrashView } from '../store/selectors';
import { useStore } from '../store/store';
import { CardTile } from './CardTile';
import styles from './PileViewer.module.css';

/**
 * The trash, laid out so a player can read it.
 *
 * The pile on the board is a count, and a count is not enough: what is in the
 * trash decides whether a K.O. was worth it and whether an Event is still
 * coming. It is public information in the real game, so both piles open, at any
 * time, and opening one is not a move — closing it leaves the board exactly as
 * it was.
 *
 * The tiles are real `CardTile`s, so hovering one fills the preview panel with
 * its art and printed text like anywhere else on the board.
 */
export function PileViewer(): ReactElement | null {
  const view = useTrashView();
  const m = useMessages();
  const viewTrash = useStore((s) => s.viewTrash);

  if (view === null) {
    return null;
  }

  const close = (): void => viewTrash(null);
  const owner = playerLabel(view.player, m);

  return (
    <div className={styles.overlay} onClick={close}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label={m.pile.label(owner)}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>{m.pile.title(owner, view.ids.length)}</h2>
        <p className={styles.hint}>{m.pile.hint}</p>
        <div className={styles.cards}>
          {view.ids.map((id) => (
            // `mine` is false throughout: a card in the trash carries no
            // affordance, so nothing here can be clicked into an action.
            <CardTile key={id} id={id} zone="field" mine={false} />
          ))}
        </div>
        <button type="button" className={styles.close} onClick={close}>
          {m.common.close}
        </button>
      </div>
    </div>
  );
}
