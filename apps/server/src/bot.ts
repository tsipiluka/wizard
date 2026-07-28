import { type Card, type GameState, type Suit, forbiddenBid, legalCardIds } from '@wizard/shared';

const SUIT_ORDER: Suit[] = ['red', 'yellow', 'green', 'blue'];

/**
 * A card's play strength for the simple bot heuristic: Wizards always
 * highest, Jesters always lowest, trump suit cards rank above same-value
 * non-trump, otherwise by face value.
 */
function cardStrength(card: Card, trumpSuit: Suit | null): number {
  if (card.kind === 'wizard') return 1000;
  if (card.kind === 'jester') return -1000;
  const trumpBonus = trumpSuit && card.suit === trumpSuit ? 100 : 0;
  return trumpBonus + card.value;
}

/** Estimate expected tricks from hand strength, then dodge the forbidden bid if forced to. */
export function chooseBotBid(state: GameState, seat: number): number {
  const hand = state.hands[seat] ?? [];
  let estimate = 0;
  for (const card of hand) {
    if (card.kind === 'wizard') estimate += 1;
    else if (card.kind === 'suit' && card.suit === state.trumpSuit) estimate += 0.5;
    else if (card.kind === 'suit' && card.value >= 10) estimate += 0.3;
  }
  let bid = Math.max(0, Math.min(state.round, Math.round(estimate)));
  const forbidden = forbiddenBid(state, seat);
  if (forbidden !== null && bid === forbidden) {
    bid = bid < state.round ? bid + 1 : bid - 1;
  }
  return bid;
}

/** Pick the suit this hand holds the most of, as trump. */
export function chooseBotTrump(state: GameState, seat: number): Suit {
  const hand = state.hands[seat] ?? [];
  const counts: Record<Suit, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const card of hand) {
    if (card.kind === 'suit') counts[card.suit]++;
  }
  return SUIT_ORDER.reduce((best, suit) => (counts[suit] > counts[best] ? suit : best));
}

/** Play to win while short of the bid, otherwise play to lose. */
export function chooseBotCard(state: GameState, seat: number): string {
  const hand = state.hands[seat] ?? [];
  const legal = new Set(legalCardIds(state, seat));
  const legalCards = hand.filter((c) => legal.has(c.id));
  const stillNeedsTricks = (state.bids[seat] ?? 0) > (state.tricksWon[seat] ?? 0);
  const sorted = [...legalCards].sort(
    (a, b) => cardStrength(a, state.trumpSuit) - cardStrength(b, state.trumpSuit),
  );
  const chosen = stillNeedsTricks ? sorted[sorted.length - 1] : sorted[0];
  return chosen!.id;
}
