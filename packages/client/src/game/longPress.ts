import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Press and hold to look at a card.
 *
 * **The replacement for hover, and only for the pointers that have no hover.**
 * A mouse keeps `onMouseEnter`; a finger has never had a hover state and until
 * now had no way to read a card at all without playing it. Holding is what a
 * player already does with a physical card they are thinking about.
 *
 * Tap is untouched and stays the primary path. This suppresses exactly one
 * click — the one the browser fires after the press that opened a preview —
 * because that click was a look, not a move. A press that never reached the
 * threshold suppresses nothing.
 *
 * Pointer events rather than touch events: one code path, and `pointerType`
 * is the honest way to ask "is this a finger" instead of sniffing the device.
 */
export const LONG_PRESS_MS = 350;

/** Past this the finger is scrolling or dragging, and it is not a press. */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
  /** True while the press has fired; the caller uses it to swallow the click. */
  consumeClick: () => boolean;
}

export function useLongPress(
  onOpen: () => void,
  onClose: () => void,
  enabled = true,
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      // A mouse keeps its hover; only a pointer with no hover needs this.
      if (!enabled || e.pointerType === 'mouse') {
        return;
      }
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        onOpen();
      }, LONG_PRESS_MS);
    },
    [enabled, onOpen],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const from = origin.current;
      if (from === null) {
        return;
      }
      const moved = Math.hypot(e.clientX - from.x, e.clientY - from.y);
      if (moved > MOVE_TOLERANCE_PX) {
        clear();
      }
    },
    [clear],
  );

  const finish = useCallback(() => {
    clear();
    if (fired.current) {
      onClose();
    }
  }, [clear, onClose]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    consumeClick: () => {
      const swallow = fired.current;
      fired.current = false;
      return swallow;
    },
  };
}
