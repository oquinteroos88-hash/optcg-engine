import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';
import type { Decklist } from '@optcg/engine';
import { startServer } from './transport.js';

/**
 * The runnable server: **card data plus a socket, and nothing else.**
 *
 * This file is the one place in the package allowed to know a card exists, and
 * the separation is the point. The library — session, transport, replay —
 * answers no game question and holds no game data; an application has to
 * supply both the port and the catalog. So this is where `@optcg/cards` is
 * registered and where the deck ids a `create` may name come from, and
 * `tests/imports.test.ts` allows it here and nowhere else.
 *
 * It is also where the perimeter meets the environment (`docs/threat-model.md`):
 *
 *   PORT                    the port, unless one is given as the argument
 *   OPTCG_ALLOWED_ORIGINS   comma-separated origins a browser may connect
 *                           from (M9); unset means no check, and says so
 *
 *   node packages/server/dist/main.js [port]
 */

registerStarterCards();

const decks: Record<string, Decklist> = {};
for (const deck of starterDecklists) {
  decks[deck.id] = toEngineDecklist(deck);
}

const port = Number(process.argv[2] ?? process.env['PORT'] ?? 8787);

const originsEnv = process.env['OPTCG_ALLOWED_ORIGINS'];
const allowedOrigins =
  originsEnv === undefined || originsEnv.trim() === ''
    ? undefined
    : originsEnv
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== '');

const server = await startServer({
  port,
  decks,
  ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
  // M3: one JSON line per event on stderr — an event name, a message type
  // and an error name, never a payload. What the transport gives is all
  // there is to print.
  log: (entry) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(entry));
  },
});
// eslint-disable-next-line no-console
console.log(
  `OPTCG server listening on ws://localhost:${server.port} — decks: ${Object.keys(decks).join(', ')}`,
);
// eslint-disable-next-line no-console
console.log(
  allowedOrigins === undefined
    ? 'origin check disabled (OPTCG_ALLOWED_ORIGINS unset)'
    : `allowed origins: ${allowedOrigins.join(', ')}`,
);
