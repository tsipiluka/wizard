import { describe, expect, test } from 'vitest';
import {
  Card,
  GameError,
  GameState,
  SUITS,
  Suit,
  TrickPlay,
  advanceRound,
  chooseTrump,
  createDeck,
  createGame,
  legalCardIds,
  placeBid,
  playCard,
  scoreDelta,
  totalRounds,
  trickWinner,
} from '../src/index';

/** Deterministic rng (mulberry32) so dealt hands are reproducible. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const suit = (s: Suit, value: number): Card => ({ kind: 'suit', suit: s, value, id: `${s}-${value}` });
const wizard = (n: number): Card => ({ kind: 'wizard', id: `wizard-${n}` });
const jester = (n: number): Card => ({ kind: 'jester', id: `jester-${n}` });
const play = (playerIndex: number, card: Card): TrickPlay => ({ playerIndex, card });

describe('deck', () => {
  test('has 60 unique cards: 4 suits x 13 values + 4 wizards + 4 jesters', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(60);
    expect(new Set(deck.map((c) => c.id)).size).toBe(60);
    expect(deck.filter((c) => c.kind === 'wizard')).toHaveLength(4);
    expect(deck.filter((c) => c.kind === 'jester')).toHaveLength(4);
    for (const s of SUITS) {
      const values = deck.filter((c) => c.kind === 'suit' && c.suit === s);
      expect(values).toHaveLength(13);
    }
  });
});

describe('game setup', () => {
  test('total rounds depend on player count', () => {
    expect(totalRounds(3)).toBe(20);
    expect(totalRounds(4)).toBe(15);
    expect(totalRounds(5)).toBe(12);
    expect(totalRounds(6)).toBe(10);
  });

  test('rejects invalid player counts', () => {
    expect(() => createGame(2)).toThrow(GameError);
    expect(() => createGame(7)).toThrow(GameError);
  });

  test('round 1 deals one card per player and flips a trump indicator', () => {
    const state = createGame(4, seededRng(1));
    expect(state.round).toBe(1);
    expect(state.hands.every((h) => h.length === 1)).toBe(true);
    expect(state.trumpCard).not.toBeNull();
  });

  test('bidding starts left of the dealer', () => {
    const state = createGame(4, seededRng(1));
    if (state.phase === 'bidding') {
      expect(state.turnIndex).toBe((state.dealerIndex + 1) % 4);
    } else {
      // wizard flipped: dealer chooses trump first
      expect(state.phase).toBe('choosingTrump');
      expect(state.turnIndex).toBe(state.dealerIndex);
    }
  });
});

/** Build a fixed mid-game state for targeted rule tests. */
function fixedState(overrides: Partial<GameState>): GameState {
  const base = createGame(3, seededRng(7));
  return {
    ...base,
    phase: 'playing',
    round: 3,
    totalRounds: 20,
    dealerIndex: 2,
    bids: [1, 1, 0],
    tricksWon: [0, 0, 0],
    currentTrick: [],
    trickLeaderIndex: 0,
    turnIndex: 0,
    trumpSuit: 'blue',
    trumpCard: suit('blue', 9),
    ...overrides,
  };
}

describe('trump determination', () => {
  test('jester flip means no trump', () => {
    // brute-force seeds to find each flip kind, proving all three occur
    let sawJester = false;
    let sawWizard = false;
    let sawSuit = false;
    for (let seed = 0; seed < 300 && !(sawJester && sawWizard && sawSuit); seed++) {
      const s = createGame(4, seededRng(seed));
      if (s.trumpCard!.kind === 'jester') {
        sawJester = true;
        expect(s.trumpSuit).toBeNull();
        expect(s.phase).toBe('bidding');
      } else if (s.trumpCard!.kind === 'wizard') {
        sawWizard = true;
        expect(s.trumpSuit).toBeNull();
        expect(s.phase).toBe('choosingTrump');
      } else {
        sawSuit = true;
        expect(s.trumpSuit).toBe(s.trumpCard!.suit);
        expect(s.phase).toBe('bidding');
      }
    }
    expect(sawJester && sawWizard && sawSuit).toBe(true);
  });

  test('dealer chooses trump after wizard flip, then bidding begins', () => {
    let state: GameState | null = null;
    for (let seed = 0; seed < 300; seed++) {
      const s = createGame(4, seededRng(seed));
      if (s.phase === 'choosingTrump') {
        state = s;
        break;
      }
    }
    expect(state).not.toBeNull();
    expect(() => chooseTrump(state!, (state!.dealerIndex + 1) % 4, 'red')).toThrow(GameError);
    const after = chooseTrump(state!, state!.dealerIndex, 'red');
    expect(after.trumpSuit).toBe('red');
    expect(after.phase).toBe('bidding');
    expect(after.turnIndex).toBe((after.dealerIndex + 1) % 4);
  });
});

describe('bidding', () => {
  test('players bid in order; out-of-turn and out-of-range bids rejected', () => {
    let state = createGame(4, seededRng(3));
    if (state.phase === 'choosingTrump') state = chooseTrump(state, state.dealerIndex, 'green');
    const first = state.turnIndex;
    expect(() => placeBid(state, (first + 1) % 4, 0)).toThrow(GameError);
    expect(() => placeBid(state, first, 2)).toThrow(GameError); // round 1: max bid is 1
    expect(() => placeBid(state, first, -1)).toThrow(GameError);
    state = placeBid(state, first, 1);
    expect(state.bids[first]).toBe(1);
    expect(state.turnIndex).toBe((first + 1) % 4);
  });

  test('after the last bid, play starts left of the dealer', () => {
    let state = createGame(4, seededRng(3));
    if (state.phase === 'choosingTrump') state = chooseTrump(state, state.dealerIndex, 'green');
    for (let i = 0; i < 4; i++) state = placeBid(state, state.turnIndex, 0);
    expect(state.phase).toBe('playing');
    expect(state.turnIndex).toBe((state.dealerIndex + 1) % 4);
    expect(state.trickLeaderIndex).toBe((state.dealerIndex + 1) % 4);
  });
});

describe('follow suit legality', () => {
  test('must follow led suit when able; wizards and jesters always legal', () => {
    const state = fixedState({
      hands: [
        [suit('red', 5), suit('blue', 2), wizard(0), jester(0)],
        [suit('red', 9), suit('green', 4)],
        [suit('yellow', 1)],
      ],
      currentTrick: [play(1, suit('red', 9))],
      trickLeaderIndex: 1,
      turnIndex: 0,
    });
    expect(legalCardIds(state, 0).sort()).toEqual(['jester-0', 'red-5', 'wizard-0'].sort());
  });

  test('free choice when unable to follow', () => {
    const state = fixedState({
      hands: [[suit('green', 5), suit('blue', 2)], [suit('red', 9)], [suit('yellow', 1)]],
      currentTrick: [play(1, suit('red', 9))],
      trickLeaderIndex: 1,
      turnIndex: 0,
    });
    expect(legalCardIds(state, 0).sort()).toEqual(['blue-2', 'green-5'].sort());
  });

  test('wizard led: no follow requirement', () => {
    const state = fixedState({
      hands: [[suit('red', 5), suit('blue', 2)], [wizard(0)], [suit('yellow', 1)]],
      currentTrick: [play(1, wizard(0)), play(2, suit('yellow', 1))],
      trickLeaderIndex: 1,
      turnIndex: 0,
    });
    expect(legalCardIds(state, 0).sort()).toEqual(['blue-2', 'red-5'].sort());
  });

  test('jester led: first suit card sets the suit to follow', () => {
    const state = fixedState({
      hands: [[suit('yellow', 5), suit('blue', 2)], [jester(0)], [suit('yellow', 1)]],
      currentTrick: [play(1, jester(0)), play(2, suit('yellow', 1))],
      trickLeaderIndex: 1,
      turnIndex: 0,
    });
    expect(legalCardIds(state, 0)).toEqual(['yellow-5']);
  });
});

describe('trick winner', () => {
  test('first wizard wins', () => {
    expect(
      trickWinner([play(0, suit('red', 13)), play(1, wizard(0)), play(2, wizard(1))], 'red'),
    ).toBe(1);
  });

  test('highest trump beats led suit', () => {
    expect(
      trickWinner([play(0, suit('red', 13)), play(1, suit('blue', 2)), play(2, suit('blue', 5))], 'blue'),
    ).toBe(2);
  });

  test('highest card of led suit wins without trump', () => {
    expect(
      trickWinner([play(1, suit('green', 4)), play(2, suit('green', 11)), play(0, suit('red', 13))], null),
    ).toBe(2);
  });

  test('jester led: suit set by next suit card', () => {
    expect(
      trickWinner([play(0, jester(0)), play(1, suit('yellow', 3)), play(2, suit('red', 13))], null),
    ).toBe(1);
  });

  test('all jesters: leader wins', () => {
    expect(
      trickWinner([play(2, jester(0)), play(0, jester(1)), play(1, jester(2))], 'blue'),
    ).toBe(2);
  });
});

describe('scoring', () => {
  test('exact bid: 20 + 10 per trick', () => {
    expect(scoreDelta(0, 0)).toBe(20);
    expect(scoreDelta(3, 3)).toBe(50);
  });
  test('missed bid: -10 per trick difference', () => {
    expect(scoreDelta(2, 0)).toBe(-20);
    expect(scoreDelta(0, 3)).toBe(-30);
  });
});

describe('full round flow', () => {
  /** Play through the whole current round with everyone bidding 0 and playing any legal card. */
  function playRound(state: GameState): GameState {
    if (state.phase === 'choosingTrump') state = chooseTrump(state, state.dealerIndex, 'red');
    while (state.phase === 'bidding') state = placeBid(state, state.turnIndex, 0);
    while (state.phase === 'playing') {
      const legal = legalCardIds(state, state.turnIndex);
      expect(legal.length).toBeGreaterThan(0);
      state = playCard(state, state.turnIndex, legal[0]!);
    }
    return state;
  }

  test('playing out of turn or an illegal card is rejected', () => {
    const state = fixedState({
      hands: [
        [suit('red', 5), suit('blue', 2)],
        [suit('red', 9), suit('green', 4)],
        [suit('yellow', 1), suit('red', 2)],
      ],
      currentTrick: [play(1, suit('red', 9))],
      trickLeaderIndex: 1,
      turnIndex: 2,
    });
    expect(() => playCard(state, 0, 'red-5')).toThrow(GameError); // not their turn
    expect(() => playCard(state, 2, 'yellow-1')).toThrow(GameError); // must follow red
    const after = playCard(state, 2, 'red-2');
    expect(after.currentTrick).toHaveLength(2);
    expect(after.turnIndex).toBe(0);
  });

  test('completed trick: winner collects and leads next', () => {
    const state = fixedState({
      hands: [
        [suit('red', 5), suit('blue', 2)],
        [suit('red', 9), suit('green', 4)],
        [suit('red', 12), suit('yellow', 1)],
      ],
      currentTrick: [play(1, suit('red', 9)), play(2, suit('red', 12))],
      trickLeaderIndex: 1,
      turnIndex: 0,
      trumpSuit: null,
    });
    const after = playCard(state, 0, 'red-5');
    expect(after.currentTrick).toHaveLength(0);
    expect(after.tricksWon[2]).toBe(1);
    expect(after.turnIndex).toBe(2);
    expect(after.trickLeaderIndex).toBe(2);
    expect(after.lastTrick?.winnerIndex).toBe(2);
  });

  test('round ends with scoring, advanceRound deals the next round', () => {
    let state = createGame(3, seededRng(11));
    state = playRound(state);
    expect(state.phase).toBe('roundEnd');
    expect(state.history).toHaveLength(1);
    const roundScores = state.history[0]!;
    expect(roundScores).toHaveLength(3);
    // one trick total in round 1, everyone bid 0: winner -10, others +20
    const deltas = roundScores.map((r) => r.delta).sort((a, b) => a - b);
    expect(deltas).toEqual([-10, 20, 20]);
    expect(state.scores.reduce((a, b) => a + b, 0)).toBe(30);

    const next = advanceRound(state, seededRng(12));
    expect(next.round).toBe(2);
    expect(next.hands.every((h) => h.length === 2)).toBe(true);
    expect(next.dealerIndex).toBe((state.dealerIndex + 1) % 3);
    expect(next.tricksWon).toEqual([0, 0, 0]);
    expect(next.bids).toEqual([null, null, null]);
  });

  test('a full 3-player game reaches gameOver after 20 rounds', () => {
    const rng = seededRng(42);
    let state = createGame(3, rng);
    for (let r = 1; r <= 20; r++) {
      expect(state.round).toBe(r);
      state = playRound(state);
      if (r < 20) {
        expect(state.phase).toBe('roundEnd');
        state = advanceRound(state, rng);
      }
    }
    expect(state.phase).toBe('gameOver');
    expect(state.hands.every((h) => h.length === 0)).toBe(true);
    // final round has no trump indicator card
    expect(state.trumpCard).toBeNull();
    expect(state.history).toHaveLength(20);
  });

  test('last round flips no trump card', () => {
    let state = createGame(6, seededRng(5)); // 10 rounds of 6 cards
    for (let r = 1; r < 10; r++) {
      state = playRound(state);
      state = advanceRound(state, seededRng(r));
    }
    expect(state.round).toBe(10);
    expect(state.trumpCard).toBeNull();
    expect(state.trumpSuit).toBeNull();
  });
});
