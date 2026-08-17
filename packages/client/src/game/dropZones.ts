import type { InstanceId } from '@optcg/engine';

/**
 * Where a dragged card may be dropped.
 *
 * **The affordances decide, the UI reads.** A zone lights up because the engine
 * said this card can be played, never because a component worked out that it
 * looked playable. There is exactly one destination for `PLAY_CARD` — the
 * player's own field — so the set is one zone wide today, and it is a set
 * rather than a boolean so that a rule which adds a destination adds it here
 * and lights it everywhere at once.
 */
export type DropZone = 'field';

/** Marks a droppable element; the drag hit-tests for it by name. */
export const DROP_ZONE_ATTR = 'data-drop-zone';

export interface DragState {
  card: InstanceId;
  zones: readonly DropZone[];
}

/**
 * The zone under a point, or null.
 *
 * `elementFromPoint` rather than measured rectangles: the board is a grid whose
 * cells move with the window, the phone rotates, and the mat has two templates.
 * Asking the document what is under the finger is the one method that cannot
 * drift from what is on screen.
 */
export function zoneAt(x: number, y: number, doc: Document = document): DropZone | null {
  const el = doc.elementFromPoint(x, y);
  const zone = el?.closest(`[${DROP_ZONE_ATTR}]`)?.getAttribute(DROP_ZONE_ATTR) ?? null;
  return zone === 'field' ? 'field' : null;
}
