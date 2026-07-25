import type { EmoteId } from '@wizard/shared';

/** The button that opens the picker: a spoken word, with a little enchantment. */
export const EMOTE_BUTTON_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M12 3.1c-5 0-9.1 3.2-9.1 7.2 0 2.3 1.3 4.3 3.4 5.6-.2 1.2-.8 2.5-1.8 3.6 1.9-.3 3.5-1 4.7-1.9 .9.2 1.8.3 2.8.3 5 0 9.1-3.2 9.1-7.6S17 3.1 12 3.1z"
    />
    <path d="M18.9 1.3l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" fill="currentColor" />
  </svg>
);

/** Arcane-flavoured glyphs, drawn to match the hand-inked suit sigils on the cards. */
export const EMOTE_ICONS: Record<EmoteId, JSX.Element> = {
  greet: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M7.4 21.2a5.6 5.6 0 0 1-2-4.3v-4.3l-1.6-2.8a1.3 1.3 0 0 1 2.2-1.3l1.3 2V4.1a1.25 1.25 0 0 1 2.5 0v5.3h.7V2.9a1.25 1.25 0 0 1 2.5 0v6.5h.7V4.2a1.25 1.25 0 0 1 2.5 0v5.2h.7V6.6a1.25 1.25 0 0 1 2.5 0v9.4c0 2.9-2.1 5.2-4.8 5.2z"
      />
    </svg>
  ),
  'well-played': (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2.6l2.6 5.7 6.2.8-4.6 4.2 1.2 6.1L12 16.4l-5.4 3 1.2-6.1L3.2 9.1l6.2-.8z"
      />
    </svg>
  ),
  'nice-trick': (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M3.6 17.9 15.1 6.4l2.5 2.5L6.1 20.4H3.6zM17.1 4.4l1.6-1.6a1.2 1.2 0 0 1 1.7 0l.8.8a1.2 1.2 0 0 1 0 1.7l-1.6 1.6z"
      />
      <path fill="currentColor" d="M6.2 3.1l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
    </svg>
  ),
  thinking: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        d="M8.7 8.4a3.4 3.4 0 1 1 4.7 3.1c-1 .5-1.4 1.3-1.4 2.4v.6"
      />
      <circle cx="12" cy="18.6" r="1.5" fill="currentColor" />
    </svg>
  ),
  gloat: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M13.4 3.6 10 12.9l-6.5 5h17L15 13.4z" />
      <ellipse cx="12" cy="18.8" rx="9.4" ry="1.9" fill="currentColor" opacity=".8" />
      <path d="M13.6 1.8l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="currentColor" />
    </svg>
  ),
  threat: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2.2 21.4 19a1.1 1.1 0 0 1-1 1.7H3.6a1.1 1.1 0 0 1-1-1.7z"
      />
      <path d="M12 8.6v4.8" stroke="var(--ink-1)" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.15" fill="var(--ink-1)" />
    </svg>
  ),
  oops: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="8.9" cy="9.8" r="1.3" fill="currentColor" />
      <circle cx="15.1" cy="9.8" r="1.3" fill="currentColor" />
      <path
        d="M8.4 17.1a4.6 4.6 0 0 1 7.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        transform="rotate(180 12 16.4)"
      />
    </svg>
  ),
  hurry: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M6.2 2.4h11.6a1 1 0 0 1 .8 1.6L14 9.4a1 1 0 0 0 0 1.2l4.6 5.4a1 1 0 0 1-.8 1.6H6.2a1 1 0 0 1-.8-1.6L10 10.6a1 1 0 0 0 0-1.2L5.4 4a1 1 0 0 1 .8-1.6z"
      />
      <rect x="4.4" y="20" width="15.2" height="1.9" rx=".95" fill="currentColor" />
    </svg>
  ),
};
