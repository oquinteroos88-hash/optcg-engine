import { findStarterCard } from '@optcg/cards/starters';
import type { CardId } from '@optcg/engine';
import { config } from '../config';

/**
 * Where the client looks for a card's printed art.
 *
 * The art is a **local cache**: `pnpm --filter @optcg/cards run art` copies it
 * out of a local archive into `public/cards/`, which is gitignored. A fresh
 * clone has none of it, and that is the normal case — the tile falls back to
 * the CSS card it has always drawn. Nothing here reports a missing image,
 * because nothing is wrong when one is missing.
 *
 * **The filename is the card id.** No table, no manifest, no `img_url` on
 * `CardDefinition` — presentation stays out of the rules, and a new card is
 * reachable the moment its file exists.
 *
 * The address is built from `config.cardImageBase` rather than hardcoded, so
 * the day this is served from somewhere else the origin is one constant.
 */

/** The board tile: a 120x167 JPEG, ~6 KB. Used at 56-92 px. */
export function cardImageSrc(cardId: CardId): string {
  return `${config.cardImageBase}/${cardId}_small.jpg`;
}

/** The preview panel: the 480x671 PNG, ~190 KB. Shown at ~135 px wide. */
export function cardArtSrc(cardId: CardId): string {
  return `${config.cardImageBase}/${cardId}.png`;
}

/** The DON!! card, one image shared by every DON!! zone. */
export function donArtSrc(): string {
  return `${config.cardImageBase}/don.png`;
}

/**
 * Whether this card is one the archive could have art for.
 *
 * Not the same question as whether the file is on this machine — that one is
 * answered by the `<img>` failing to load, which is the only honest answer a
 * browser can give. This is the cheaper one asked first: the TEST decks are
 * synthetic, no printed card stands behind them, and asking for their art would
 * be twenty guaranteed 404s per board in a console nobody could then read.
 */
export function hasCardImage(cardId: CardId): boolean {
  return findStarterCard(cardId) !== undefined;
}
