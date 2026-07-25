/**
 * The fixed emote vocabulary. Keeping it small and closed means the server can
 * validate ids cheaply and no player can inject arbitrary text at the table.
 */
export const EMOTES = [
  { id: 'greet', label: 'Greetings' },
  { id: 'well-played', label: 'Well played' },
  { id: 'nice-trick', label: 'Nice trick' },
  { id: 'thinking', label: 'Hmm…' },
  { id: 'gloat', label: 'Too easy' },
  { id: 'threat', label: 'Beware' },
  { id: 'oops', label: 'Oops' },
  { id: 'hurry', label: 'Any day now' },
] as const;

export type EmoteId = (typeof EMOTES)[number]['id'];

const EMOTE_IDS = new Set<string>(EMOTES.map((e) => e.id));

export function isEmoteId(value: unknown): value is EmoteId {
  return typeof value === 'string' && EMOTE_IDS.has(value);
}

/** Minimum gap between one player's emotes. Spam is the real failure mode here. */
export const EMOTE_COOLDOWN_MS = 2500;
