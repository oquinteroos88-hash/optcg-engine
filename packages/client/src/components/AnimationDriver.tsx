import { useEffect } from 'react';
import { useStore } from '../store/store';

/**
 * Headless: drains the animation queue one group at a time. Input stays
 * blocked while the queue is non-empty, so this must always keep running.
 */
export function AnimationDriver(): null {
  const head = useStore((s) => s.animQueue[0] ?? null);
  const animTick = useStore((s) => s.animTick);

  useEffect(() => {
    if (head === null) {
      return;
    }
    const timer = setTimeout(() => animTick(head.id), head.durationMs);
    return () => clearTimeout(timer);
  }, [head, animTick]);

  return null;
}
