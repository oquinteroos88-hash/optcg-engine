import { useMediaQuery } from './mediaQuery';

/**
 * Portrait, and narrow enough that two full mats cannot both be one.
 *
 * A phone held upright. Not a width alone: a short landscape window is a
 * cramped table and should stay a table, while a tall narrow one is a
 * different shape of problem and needs a different sheet.
 */
export const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 820px)';

/**
 * Whether the opponent's half should condense.
 *
 * The media query is evaluated here rather than in the stylesheet, and that is
 * deliberate. Condensing is not only a different template — the opponent's
 * piles stop being piles and become counters — so the answer has to be
 * available to the render, not just to the cascade. Asking once, in one place,
 * keeps the class and the markup from ever disagreeing about which sheet is on
 * screen; a `@media` block in the CSS plus a second one in JS would be two
 * sources for one fact.
 */
export function useCondensedLayout(): boolean {
  return useMediaQuery(PORTRAIT_QUERY);
}
