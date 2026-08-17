import type { ReactElement } from 'react';
import { useViewer } from '../store/selectors';
import { useStore } from '../store/store';
import { SideBoard } from './SideBoard';
import styles from './Table.module.css';

export function Table(): ReactElement | null {
  const viewer = useViewer();
  const uiEvent = useStore((s) => s.uiEvent);

  if (viewer === null) {
    return null;
  }
  // Board orientation follows **the seat being rendered**: your side is the
  // bottom half. It used to follow the active player, which stopped working
  // the day the board started drawing a `PlayerView` — the bottom half is the
  // one with faces on it, and the only hand a view publishes in full is the
  // viewer's own. In hot-seat the viewer is whoever holds priority, so the
  // board turns around with the device, which is what pass-and-play meant all
  // along.
  //
  // The top half mirrors WHERE ITS ZONES SIT and rotates nothing, so both
  // Character areas face the centre line and every label stays readable.
  const opponent = viewer === 'p1' ? 'p2' : 'p1';
  return (
    <div className={styles.table} onClick={() => uiEvent({ kind: 'clickEmpty' })}>
      <SideBoard player={opponent} mirrored />
      {/* The centre line is a row of the table's own grid, not a margin: the
          two Character Areas are placed against it rather than left next to a
          gap that happens to be drawn. */}
      <div className={styles.divider} />
      <SideBoard player={viewer} mirrored={false} />
    </div>
  );
}
