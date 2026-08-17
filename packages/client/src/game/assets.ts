import { useSyncExternalStore } from 'react';
import { config } from '../config';

/**
 * Which optional local assets this machine has, and nothing else.
 *
 * **None of them is ever committed.** The official card back, the DON!! back
 * and the themed playmats are Bandai's; they live in the same gitignored local
 * archive the card art already uses, and are published into `public/cards/` by
 * `pnpm --filter @optcg/cards run art`. A clone with no archive is the normal
 * case — the client draws its own back and its own neutral mat.
 *
 * The archive cannot be listed at runtime: Vite serves `public/` verbatim, with
 * no index, and probing for filenames would mean hardcoding the list of mats
 * that are allowed to exist. So the script that publishes the files publishes a
 * manifest naming what it placed, and this is the only thing the client reads.
 * A machine with no archive writes no manifest, the fetch 404s, and the answer
 * is `NO_ASSETS`.
 */
export interface PlaymatEntry {
  /** The file's own stem. Not a table: a name derived from what is there. */
  id: string;
  /** Relative to `config.cardImageBase`. */
  file: string;
  /** The stem, made readable. Presentation only; never matched against. */
  name: string;
}

export interface AssetManifest {
  cardBack: string | null;
  donBack: string | null;
  playmats: readonly PlaymatEntry[];
}

export const NO_ASSETS: AssetManifest = Object.freeze({
  cardBack: null,
  donBack: null,
  playmats: Object.freeze([]),
});

/** An absolute URL for something the manifest named, or null for nothing. */
export function assetUrl(file: string | null | undefined): string | null {
  return file === null || file === undefined || file === ''
    ? null
    : `${config.cardImageBase}/${file}`;
}

/** A `background-image` value, or `none` — the value that does not paint. */
export function backgroundImage(file: string | null | undefined): string {
  const url = assetUrl(file);
  return url === null ? 'none' : `url("${url}")`;
}

// ---------------------------------------------------------------------------
// The one-shot load.

function isEntry(value: unknown): value is PlaymatEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['id'] === 'string' &&
    typeof entry['file'] === 'string' &&
    typeof entry['name'] === 'string'
  );
}

function parse(body: unknown): AssetManifest {
  if (typeof body !== 'object' || body === null) {
    return NO_ASSETS;
  }
  const raw = body as Record<string, unknown>;
  const cardBack = raw['cardBack'];
  const donBack = raw['donBack'];
  const playmats = raw['playmats'];
  return {
    cardBack: typeof cardBack === 'string' ? cardBack : null,
    donBack: typeof donBack === 'string' ? donBack : null,
    playmats: Array.isArray(playmats) ? playmats.filter(isEntry) : [],
  };
}

let manifest: AssetManifest = NO_ASSETS;
let started = false;
const listeners = new Set<() => void>();

function publish(next: AssetManifest): void {
  manifest = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reads the manifest once, and **never rejects**.
 *
 * Absent `fetch`, a 404, a body that is not JSON, a body that is JSON but not a
 * manifest: all of them mean the same thing, which is that this machine has no
 * local assets. That is not an error — it is the state every clone starts in.
 */
export function loadAssetManifest(): void {
  if (started) {
    return;
  }
  started = true;
  if (typeof globalThis.fetch !== 'function') {
    return;
  }
  void globalThis
    .fetch(`${config.cardImageBase}/manifest.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const next = parse(body);
      if (next !== NO_ASSETS) {
        publish(next);
      }
    })
    .catch(() => {
      // See above: nothing to report, and nothing to fall back to that is not
      // already what is being drawn.
    });
}

/** Test seam. Resets the module to the state a fresh page load starts in. */
export function resetAssetManifest(next: AssetManifest = NO_ASSETS): void {
  started = false;
  publish(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): AssetManifest {
  return manifest;
}

/**
 * What this machine has, starting at `NO_ASSETS`.
 *
 * The first paint is therefore always the fallback, and the official art is an
 * upgrade that arrives a frame later — never a hole waiting to be filled.
 */
export function useAssetManifest(): AssetManifest {
  loadAssetManifest();
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
