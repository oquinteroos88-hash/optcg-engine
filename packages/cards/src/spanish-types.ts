/**
 * The shape of the Spanish text, with no loader attached.
 *
 * Separate from `spanish.ts` because that module reads the JSON with `node:fs`,
 * and `starters.generated.ts` — which the browser bundle imports — needs the
 * type and must not pull a Node builtin into its graph. `import type` is erased
 * either way; keeping the declaration here means that is true by construction
 * rather than by remembering to write `type`.
 */
export interface SpanishText {
  /** Never null: a card with no printed effect carries "-", as the English does. */
  effectText: string;
  triggerText: string | null;
}

/** Where the English this was translated from came from, and at which commit. */
export interface SpanishSource {
  repository: string;
  commit: string;
  fields: readonly string[];
  sets: readonly string[];
  glossary: string;
  note: string;
}
