import type { ReactElement } from 'react';
import type { InstanceId } from '@optcg/engine';
import { useMessages } from '../i18n/useMessages';
import { useCardView, useTrashCandidates } from '../store/selectors';
import { useStore } from '../store/store';
import { CardTile } from './CardTile';
import styles from './TrashChoiceModal.module.css';

interface TrashChoiceModalProps {
  /** Always a real card: the parent mounts this only while a choice is pending. */
  cardToPlay: InstanceId;
}

/** Sixth-character sacrifice: pick which own character leaves the field. */
export function TrashChoiceModal({ cardToPlay }: TrashChoiceModalProps): ReactElement {
  const uiEvent = useStore((s) => s.uiEvent);
  const m = useMessages();
  const candidates = useTrashCandidates(cardToPlay);
  const pending = useCardView(cardToPlay);

  return (
    <div className={styles.overlay} onClick={() => uiEvent({ kind: 'escape' })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>
          {m.trashChoice.title}
          {pending === null ? '' : m.trashChoice.andPlay(pending.name)}
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
          {m.common.cancel}
        </button>
      </div>
    </div>
  );
}
