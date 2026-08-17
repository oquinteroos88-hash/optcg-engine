import type { Transition } from 'motion/react';
import { useMediaQuery } from './mediaQuery';

/**
 * **An animation is never the carrier of truth.**
 *
 * The `PlayerView` is the source and the store reflects it the instant it
 * arrives. Everything in this module interpolates *towards* a DOM that already
 * says the truth — nothing here delays a state change, gates one, or is waited
 * on. No logic anywhere reads an `onAnimationComplete`. If an update lands
 * mid-flight the card is already where it belongs and the motion re-targets or
 * is cut; that is a property of animating layout rather than sequencing it, and
 * it is why every animation below is expressed as "where this element is now"
 * and never as "play this, then apply that".
 *
 * The practical consequence: turning motion off changes nothing but the
 * pixels. The DOM, the accessible names and the order of operations are
 * identical either way, which is what lets the whole jsdom suite run with
 * motion off and still be testing the real component.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The card spring. Quick and slightly damped: a card is light and it lands. */
export const CARD_SPRING: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.7,
};

/** Everything that is not a journey: opacity, a flip's halves, a lunge. */
export const CARD_EASE: Transition = { type: 'tween', duration: 0.22, ease: 'easeOut' };

/** What "off" means, and it is not "slow". */
export const NO_MOTION: Transition = { duration: 0 };

/**
 * Whether this environment should animate at all.
 *
 * Two ways to be off, and they are different in kind:
 *
 *  - the reader asked for it, through `prefers-reduced-motion`. Motion has its
 *    own handling of that flag, but it only suppresses transforms; a zero
 *    transition suppresses the rest too, and "reduced" here means none.
 *  - it is a test. jsdom has no layout engine, so a layout animation there
 *    animates between two zeroes and has nothing to show — but `AnimatePresence`
 *    would still hold a removed card in the DOM for the length of its exit, and
 *    a suite asserting that a K.O.'d card is gone would be asserting against a
 *    corpse. Zero duration removes it in the same tick, so the ~250 jsdom tests
 *    see exactly the DOM they saw before this existed.
 */
export function motionOff(): boolean {
  return isTest();
}

function isTest(): boolean {
  // Vitest sets MODE to 'test'; Vite sets it to 'development' or 'production'.
  // Read defensively: this module is imported by components that also run under
  // plain node in the non-jsdom suites.
  try {
    return import.meta.env?.MODE === 'test';
  } catch {
    return false;
  }
}

/**
 * The transition every animated element on the board inherits, via a single
 * `MotionConfig` at the root of the game screen.
 */
export function useBoardTransition(): Transition {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  return reduced || motionOff() ? NO_MOTION : CARD_SPRING;
}

/** True when journeys, flips and lunges should actually play. */
export function useMotionEnabled(): boolean {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  return !reduced && !motionOff();
}
