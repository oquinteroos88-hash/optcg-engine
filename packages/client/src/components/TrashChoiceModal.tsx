import type { ReactElement } from 'react';
import { useCardView, useTrashCandidates } from '../store/selectors';
import { useStore } from '../store/store';
import { CardTile } from './CardTile';
import styles from './TrashChoiceModal.module.css';

/** Sixth-character sacrifice: pick which own character leaves the field. */
export function TrashChoiceModal(): ReactElement | null {
  const mode = useStore((s) => s.ui.mode);
  const uiEvent = useStore((s) => s.uiEvent);
  const cardToPlay = mode.kind === 'choosingTrash' ? mode.cardToPlay : '';
  const candidates = useTrashCandidates(cardToPlay);
  const pending = useCardView(cardToPlay);

  if (mode.kind !== 'choosingTrash') {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={() => uiEvent({ kind: 'escape' })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>
          El campo está lleno — elegí un personaje para descartar
          {pending === null ? '' : ` y jugar ${pending.name}`}
        </h2>
        <div className={styles.candidates}>
          {candidates.map((id) => (
            <CardTile key={id} id={id} zone="field" mine />
          ))}
        </div>
        <button
          type="button"
          className={styles.cancel}
          onClick={() => uiEvent({ kind: 'escape' })}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
