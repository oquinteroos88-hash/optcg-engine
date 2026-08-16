import type { ReactElement } from 'react';
import { useMessages } from '../i18n/useMessages';
import { useCardMenu } from '../store/selectors';
import { useStore } from '../store/store';
import styles from './CardMenu.module.css';

/**
 * The disambiguation menu phase 1 deleted as unreachable.
 *
 * It is back because `ACTIVATE_ABILITY` made a Character that can attack AND
 * activate genuinely ambiguous, and it has the shape that note predicted: N
 * entries built from affordances, not a fixed Jugar/Atacar pair. A card with
 * two activated abilities offers three.
 *
 * It is only ever mounted when there is more than one option — a card that can
 * do exactly one thing still does it on the first click, with no menu in the
 * way.
 */
export function CardMenu(): ReactElement | null {
  const menu = useCardMenu();
  const m = useMessages();
  const uiEvent = useStore((s) => s.uiEvent);

  if (menu === null) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={() => uiEvent({ kind: 'escape' })}>
      <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
        <span className={styles.title}>{menu.name}</span>
        {menu.options.map((option, index) => (
          <button
            key={`${index}-${option.label}`}
            type="button"
            className={styles.option}
            onClick={() => uiEvent({ kind: 'chooseMenuOption', index })}
          >
            <span className={styles.label}>{option.label}</span>
            {/* Printed card text, in whatever language the player reads it. No
                `lang` attribute: it follows the document's, which is the
                locale's, and marking it `en` unconditionally is what this
                change removes. */}
            {option.hint === null ? null : <span className={styles.hint}>{option.hint}</span>}
          </button>
        ))}
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
