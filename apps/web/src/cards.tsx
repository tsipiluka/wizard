import type { Card, Suit } from '@wizard/shared';

export const SUIT_ICONS: Record<Suit, JSX.Element> = {
  red: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2c.7 3.9-4.9 6.4-3.4 11.2A5.4 5.4 0 0 0 19 12.4c0-2.2-1.2-3.4-2.1-5.2-.6 1.9-1.9 2.4-1.9 2.4C16 6.4 13.3 4.3 12 2z"
      />
    </svg>
  ),
  yellow: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M12 2.2v3M12 18.8v3M2.2 12h3M18.8 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </g>
    </svg>
  ),
  green: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 21.5C5.6 16.6 4.6 8.4 12 2.7c7.4 5.7 6.4 13.9 0 18.8z" />
      <path d="M12 6v13" stroke="var(--card-face, #f3ead2)" strokeWidth="1.2" />
    </svg>
  ),
  blue: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M20.4 14.2A8.8 8.8 0 0 1 9.8 3.6a9 9 0 1 0 10.6 10.6z"
      />
    </svg>
  ),
};

export const WIZARD_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path fill="currentColor" d="M13.4 3.2 10 12.5l-6.5 5h17L15 13z" />
    <ellipse cx="12" cy="18.4" rx="9.4" ry="1.9" fill="currentColor" opacity=".85" />
    <path d="M13.6 1.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="currentColor" />
  </svg>
);

export const JESTER_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M4 15 2.6 6.4 8 10l4-6.6L16 10l5.4-3.6L20 15zM4.4 17h15.2v2.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1z"
    />
    <circle cx="2.9" cy="6" r="1.5" fill="currentColor" />
    <circle cx="12" cy="3.4" r="1.5" fill="currentColor" />
    <circle cx="21.1" cy="6" r="1.5" fill="currentColor" />
  </svg>
);

export function cardLabel(card: Card): string {
  if (card.kind === 'wizard') return 'Wizard';
  if (card.kind === 'jester') return 'Jester';
  return `${card.suit} ${card.value}`;
}

export function PlayingCard({
  card,
  size = 'md',
  raised = false,
  dimmed = false,
  onClick,
  style,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  raised?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const classes = [
    'card',
    `card--${size}`,
    card.kind === 'suit' ? `card--${card.suit}` : `card--${card.kind}`,
    raised ? 'card--raised' : '',
    dimmed ? 'card--dimmed' : '',
    onClick ? 'card--tappable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const corner =
    card.kind === 'suit' ? String(card.value) : card.kind === 'wizard' ? 'W' : 'J';
  const icon =
    card.kind === 'suit' ? SUIT_ICONS[card.suit] : card.kind === 'wizard' ? WIZARD_ICON : JESTER_ICON;

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={!onClick}
      aria-label={cardLabel(card)}
      style={style}
    >
      <span className="card__corner card__corner--tl">{corner}</span>
      <span className="card__icon">{icon}</span>
      <span className="card__corner card__corner--br">{corner}</span>
    </button>
  );
}

/** Sort a hand for display: jesters, then each suit low→high, wizards last. */
export function sortHand(hand: Card[]): Card[] {
  const suitOrder: Record<Suit, number> = { red: 0, yellow: 1, green: 2, blue: 3 };
  return [...hand].sort((a, b) => rank(a) - rank(b));
  function rank(c: Card): number {
    if (c.kind === 'jester') return Number(c.id.split('-')[1]);
    if (c.kind === 'wizard') return 1000 + Number(c.id.split('-')[1]);
    return 100 + suitOrder[c.suit] * 20 + c.value;
  }
}
