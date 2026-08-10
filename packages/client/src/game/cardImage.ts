import { STARTER_IMAGE_URLS } from '@optcg/cards/starters';
import type { CardId } from '@optcg/engine';
import { config } from '../config';

/**
 * Where the tile looks for a card's printed art.
 *
 * The art is a **local cache**, downloaded on demand by
 * `pnpm --filter @optcg/cards run images` into `public/cards/`, which is
 * gitignored. A fresh clone has none of it, and that is the normal case: the
 * tile falls back to the CSS card it has always drawn. Nothing here reports a
 * missing image, because nothing is wrong when one is missing.
 *
 * The address is built from `config.cardImageBase` rather than hardcoded, so
 * the day this is served from somewhere else the origin is one constant. It is
 * deliberately NOT the upstream URL: pointing a published page at somebody
 * else's images would be redistribution by another name, and that decision
 * belongs to whoever publishes, not to this module.
 *
 * `@optcg/cards` knows the upstream addresses (`STARTER_IMAGE_URLS`). Only the
 * download script reads their *values*; this module reads their keys, and only
 * to know which cards have art at all.
 */
export function cardImageSrc(cardId: CardId): string {
  return `${config.cardImageBase}/${cardId}.png`;
}

/**
 * Whether art exists for this card *at all*, upstream.
 *
 * Not the same question as whether it is in the local cache — that one is
 * answered by the `<img>` failing to load, which is the only honest answer
 * available to a browser. This is the cheaper one asked first: the TEST decks
 * are synthetic and have no printed card behind them, so asking for their art
 * would be 20 guaranteed 404s per board and a console nobody can read.
 *
 * `STARTER_IMAGE_URLS` is generated from the pinned dataset, so this is exactly
 * "the dataset knows about this card".
 */
export function hasCardImage(cardId: CardId): boolean {
  return Object.hasOwn(STARTER_IMAGE_URLS, cardId);
}
