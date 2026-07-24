export * from './protocol';

export type Suit = 'red' | 'yellow' | 'green' | 'blue';
export const SUITS: readonly Suit[] = ['red', 'yellow', 'green', 'blue'];

export type Card =
  | { kind: 'suit'; suit: Suit; value: number; id: string }
  | { kind: 'wizard'; id: string }
  | { kind: 'jester'; id: string };

export interface TrickPlay {
  playerIndex: number;
  card: Card;
}

export type Phase = 'choosingTrump' | 'bidding' | 'playing' | 'roundEnd' | 'gameOver';

export interface RoundScore {
  bid: number;
  tricks: number;
  delta: number;
}

export interface GameState {
  playerCount: number;
  round: number;
  totalRounds: number;
  dealerIndex: number;
  phase: Phase;
  hands: Card[][];
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  bids: (number | null)[];
  tricksWon: number[];
  currentTrick: TrickPlay[];
  trickLeaderIndex: number;
  turnIndex: number;
  scores: number[];
  history: RoundScore[][];
  lastTrick: { plays: TrickPlay[]; winnerIndex: number } | null;
}

export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let value = 1; value <= 13; value++) {
      deck.push({ kind: 'suit', suit, value, id: `${suit}-${value}` });
    }
  }
  for (let n = 0; n < 4; n++) {
    deck.push({ kind: 'wizard', id: `wizard-${n}` });
    deck.push({ kind: 'jester', id: `jester-${n}` });
  }
  return deck;
}

export function totalRounds(playerCount: number): number {
  return Math.floor(60 / playerCount);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Deal the given round: hands, trump indicator, and the opening phase. */
function dealRound(
  playerCount: number,
  round: number,
  rounds: number,
  dealerIndex: number,
  scores: number[],
  history: RoundScore[][],
  rng: () => number,
): GameState {
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = [];
  for (let p = 0; p < playerCount; p++) {
    hands.push(deck.slice(p * round, (p + 1) * round));
  }
  const isLastRound = round === rounds;
  const trumpCard = isLastRound ? null : (deck[playerCount * round] ?? null);
  const trumpSuit = trumpCard?.kind === 'suit' ? trumpCard.suit : null;
  const dealerChoosesTrump = trumpCard?.kind === 'wizard';
  const leftOfDealer = (dealerIndex + 1) % playerCount;

  return {
    playerCount,
    round,
    totalRounds: rounds,
    dealerIndex,
    phase: dealerChoosesTrump ? 'choosingTrump' : 'bidding',
    hands,
    trumpCard,
    trumpSuit,
    bids: Array(playerCount).fill(null),
    tricksWon: Array(playerCount).fill(0),
    currentTrick: [],
    trickLeaderIndex: leftOfDealer,
    turnIndex: dealerChoosesTrump ? dealerIndex : leftOfDealer,
    scores,
    history,
    lastTrick: null,
  };
}

export function createGame(playerCount: number, rng: () => number = Math.random): GameState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new GameError('invalid_players', `Wizard is played with ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  return dealRound(
    playerCount,
    1,
    totalRounds(playerCount),
    0,
    Array(playerCount).fill(0),
    [],
    rng,
  );
}

function assertTurn(state: GameState, playerIndex: number, phase: Phase): void {
  if (state.phase !== phase) {
    throw new GameError('wrong_phase', `Expected phase ${phase}, but game is in ${state.phase}`);
  }
  if (state.turnIndex !== playerIndex) {
    throw new GameError('not_your_turn', 'It is not your turn');
  }
}

export function chooseTrump(state: GameState, playerIndex: number, suit: Suit): GameState {
  assertTurn(state, playerIndex, 'choosingTrump');
  if (!SUITS.includes(suit)) {
    throw new GameError('invalid_suit', `Unknown suit: ${suit}`);
  }
  return {
    ...state,
    trumpSuit: suit,
    phase: 'bidding',
    turnIndex: (state.dealerIndex + 1) % state.playerCount,
  };
}

/**
 * The bid the final bidder is barred from: the one that would make all bids
 * sum to the round's trick count (so at least one player must miss).
 * Null when the player is not the last bidder or the difference is out of range.
 */
export function forbiddenBid(state: GameState, playerIndex: number): number | null {
  if (state.phase !== 'bidding') return null;
  const pending = state.bids.filter((b) => b === null).length;
  if (pending !== 1 || state.bids[playerIndex] !== null) return null;
  const others = state.bids.reduce((sum: number, b) => sum + (b ?? 0), 0);
  const gap = state.round - others;
  return gap >= 0 && gap <= state.round ? gap : null;
}

export function placeBid(state: GameState, playerIndex: number, bid: number): GameState {
  assertTurn(state, playerIndex, 'bidding');
  if (!Number.isInteger(bid) || bid < 0 || bid > state.round) {
    throw new GameError('invalid_bid', `Bid must be between 0 and ${state.round}`);
  }
  if (bid === forbiddenBid(state, playerIndex)) {
    throw new GameError(
      'bid_total_forbidden',
      `The bids may not add up to exactly ${state.round} — choose another number`,
    );
  }
  const bids = [...state.bids];
  bids[playerIndex] = bid;
  const allBid = bids.every((b) => b !== null);
  return {
    ...state,
    bids,
    phase: allBid ? 'playing' : 'bidding',
    turnIndex: (playerIndex + 1) % state.playerCount,
  };
}

/**
 * The suit that must be followed in the current trick, if any.
 * A led wizard removes the follow requirement for the whole trick;
 * after a led jester, the first suit card sets the suit.
 */
function ledSuit(trick: TrickPlay[]): Suit | null {
  for (const { card } of trick) {
    if (card.kind === 'wizard') return null;
    if (card.kind === 'suit') return card.suit;
  }
  return null;
}

export function legalCardIds(state: GameState, playerIndex: number): string[] {
  const hand = state.hands[playerIndex] ?? [];
  const suitToFollow = ledSuit(state.currentTrick);
  if (suitToFollow === null) return hand.map((c) => c.id);
  const canFollow = hand.some((c) => c.kind === 'suit' && c.suit === suitToFollow);
  if (!canFollow) return hand.map((c) => c.id);
  return hand.filter((c) => c.kind !== 'suit' || c.suit === suitToFollow).map((c) => c.id);
}

export function trickWinner(plays: TrickPlay[], trumpSuit: Suit | null): number {
  const firstWizard = plays.find((p) => p.card.kind === 'wizard');
  if (firstWizard) return firstWizard.playerIndex;

  const suitPlays = plays.filter(
    (p): p is TrickPlay & { card: Extract<Card, { kind: 'suit' }> } => p.card.kind === 'suit',
  );
  if (suitPlays.length === 0) return plays[0]!.playerIndex; // all jesters: leader wins

  const trumps = trumpSuit ? suitPlays.filter((p) => p.card.suit === trumpSuit) : [];
  const pool = trumps.length > 0 ? trumps : suitPlays.filter((p) => p.card.suit === suitPlays[0]!.card.suit);
  return pool.reduce((best, p) => (p.card.value > best.card.value ? p : best)).playerIndex;
}

export function scoreDelta(bid: number, tricks: number): number {
  return bid === tricks ? 20 + 10 * tricks : -10 * Math.abs(bid - tricks);
}

export function playCard(state: GameState, playerIndex: number, cardId: string): GameState {
  assertTurn(state, playerIndex, 'playing');
  const hand = state.hands[playerIndex] ?? [];
  const card = hand.find((c) => c.id === cardId);
  if (!card) {
    throw new GameError('card_not_in_hand', 'That card is not in your hand');
  }
  if (!legalCardIds(state, playerIndex).includes(cardId)) {
    throw new GameError('must_follow_suit', 'You must follow the led suit');
  }

  const hands = state.hands.map((h, i) => (i === playerIndex ? h.filter((c) => c.id !== cardId) : h));
  const currentTrick = [...state.currentTrick, { playerIndex, card }];

  if (currentTrick.length < state.playerCount) {
    return { ...state, hands, currentTrick, turnIndex: (playerIndex + 1) % state.playerCount };
  }

  // Trick complete
  const winnerIndex = trickWinner(currentTrick, state.trumpSuit);
  const tricksWon = [...state.tricksWon];
  tricksWon[winnerIndex]! += 1;
  const lastTrick = { plays: currentTrick, winnerIndex };

  const roundOver = hands.every((h) => h.length === 0);
  if (!roundOver) {
    return {
      ...state,
      hands,
      currentTrick: [],
      tricksWon,
      lastTrick,
      trickLeaderIndex: winnerIndex,
      turnIndex: winnerIndex,
    };
  }

  // Round complete: score it
  const roundScores: RoundScore[] = state.bids.map((bid, i) => ({
    bid: bid!,
    tricks: tricksWon[i]!,
    delta: scoreDelta(bid!, tricksWon[i]!),
  }));
  const scores = state.scores.map((s, i) => s + roundScores[i]!.delta);
  const gameOver = state.round === state.totalRounds;

  return {
    ...state,
    hands,
    currentTrick: [],
    tricksWon,
    lastTrick,
    trickLeaderIndex: winnerIndex,
    turnIndex: winnerIndex,
    scores,
    history: [...state.history, roundScores],
    phase: gameOver ? 'gameOver' : 'roundEnd',
  };
}

export function advanceRound(state: GameState, rng: () => number = Math.random): GameState {
  if (state.phase !== 'roundEnd') {
    throw new GameError('wrong_phase', 'The round is not over yet');
  }
  return dealRound(
    state.playerCount,
    state.round + 1,
    state.totalRounds,
    (state.dealerIndex + 1) % state.playerCount,
    state.scores,
    state.history,
    rng,
  );
}
