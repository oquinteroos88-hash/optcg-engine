import type { ReactElement } from 'react';
import { TURN_PHASES, usePhaseTrack } from '../store/selectors';
import { useMessages } from '../i18n/useMessages';
import styles from './PhaseTrack.module.css';

interface PhaseTrackProps {
  /**
   * The opponent's mat prints the same track. Both are drawn, because both mats
   * really do have it printed on them, but only one is in the accessibility
   * tree: the phase is one global fact and saying it twice is noise.
   */
  silent: boolean;
}

/**
 * The phase track the official mat prints in its free space.
 *
 * **Signage plus the live moment.** The five boxes are the printed sheet, in
 * turn order, and Main is the one that lights up — because this engine runs
 * Refresh, Draw and DON!! inside one step at the top of a turn and asserts that
 * every resting state is in Main. A track driven by the wire's phase alone
 * would be a widget whose highlight never moves.
 *
 * So the box also carries what is actually happening: Mulligan before the turn
 * structure starts, Block Step and Counter Step inside it. That is the
 * distinction the client has always been able to make — it is what the Banner
 * says — and putting it on the mat is what turns printed signage into an
 * indicator without inventing a phase the engine does not have.
 */
export function PhaseTrack({ silent }: PhaseTrackProps): ReactElement | null {
  const m = useMessages();
  const track = usePhaseTrack();

  if (track === null) {
    return null;
  }
  // The short form. The Banner says "Paso de Bloqueo" at the top of the screen;
  // a mark inside a box on a mat says "Bloqueo". The long form is also how two
  // suites address the battle panel, and a mat that printed the same words
  // would make that panel ambiguous — which is a good reason to be brief.
  const marker =
    track.live && track.moment !== 'main' && track.moment !== 'finished'
      ? m.board.moment[track.moment]
      : null;

  return (
    <div
      className={styles.track}
      {...(silent
        ? { 'aria-hidden': true }
        : { role: 'group', 'aria-label': m.board.phaseTrack })}
    >
      {TURN_PHASES.map((phase) => {
        const lit = track.live && phase === track.phase;
        return (
          <span
            key={phase}
            className={`${styles.box} ${lit ? styles.lit : ''}`}
            {...(lit && !silent ? { 'aria-current': 'step' as const } : {})}
          >
            <span className={styles.name}>{m.board.turnPhase[phase]}</span>
            {lit && marker !== null ? <span className={styles.moment}>{marker}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
