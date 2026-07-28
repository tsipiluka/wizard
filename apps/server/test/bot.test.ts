import { describe, expect, test } from 'vitest';
import { type Card, type GameState, type Suit, type TrickPlay, createGame } from '@wizard/shared';
import { chooseBotBid, chooseBotCard, chooseBotTrump } from '../src/bot';

const suitCard = (s: Suit, value: number): Card => ({ kind: 'suit', suit: s, value, id: `${s}-${value}` });
const wizard = (n: number): Card => ({ kind: 'wizard', id: `wizard-${n}` });
const jester = (n: number): Card => ({ kind: 'jester', id: `jester-${n}` });
const play = (playerIndex: number, card: Card): TrickPlay => ({ playerIndex, card });

/** Build a fixed 3-player mid-game state for targeted bot-logic tests. */
function fixedState(overrides: Partial<GameState>): GameState {
  const base = createGame(3, () => 0.42);
  return {
    ...base,
    phase: 'bidding',
    round: 5,
    totalRounds: 20,
    dealerIndex: 2,
    hands: [[], [], []],
    bids: [null, null, null],
    tricksWon: [0, 0, 0],
    currentTrick: [],
    trickLeaderIndex: 0,
    turnIndex: 0,
    trumpSuit: null,
    trumpCard: null,
    ...overrides,
  };
}

describe('chooseBotBid', () => {
  test('a hand of two Wizards and a Jester estimates 2 tricks', () => {
    const state = fixedState({
      hands: [[wizard(1), wizard(2), jester(1)], [], []],
    });
    expect(chooseBotBid(state, 0)).toBe(2);
  });

  test('a hand of low off-suit cards estimates 0 tricks', () => {
    const state = fixedState({
      trumpSuit: 'blue',
      hands: [[suitCard('red', 2), suitCard('green', 3), jester(1)], [], []],
    });
    expect(chooseBotBid(state, 0)).toBe(0);
  });

  test('clamps to the round size even with a huge hand', () => {
    const state = fixedState({
      round: 1,
      hands: [[wizard(1), wizard(2), wizard(3), wizard(4)], [], []],
    });
    expect(chooseBotBid(state, 0)).toBeLessThanOrEqual(1);
  });

  test('never lands on the forbidden bid when forced to be the last bidder', () => {
    // Two Wizards estimates a bid of 2, but bids so far already total 3, so
    // the forbidden number for the last bidder (round 5) is exactly 5-3=2.
    const state = fixedState({
      round: 5,
      bids: [1, 2, null],
      hands: [[], [], [wizard(1), wizard(2), jester(1)]],
    });
    const bid = chooseBotBid(state, 2);
    expect(bid).not.toBe(2);
    expect(bid).toBeGreaterThanOrEqual(0);
    expect(bid).toBeLessThanOrEqual(5);
  });
});

describe('chooseBotTrump', () => {
  test('picks the suit the hand holds the most of', () => {
    const state = fixedState({
      hands: [[suitCard('green', 1), suitCard('green', 5), suitCard('red', 9), jester(1)], [], []],
    });
    expect(chooseBotTrump(state, 0)).toBe('green');
  });
});

describe('chooseBotCard', () => {
  test('plays the strongest legal card when still short of its bid', () => {
    const state = fixedState({
      phase: 'playing',
      trumpSuit: 'blue',
      bids: [2, 0, 0],
      tricksWon: [0, 0, 0],
      currentTrick: [],
      hands: [[suitCard('red', 3), suitCard('red', 11), wizard(1)], [], []],
    });
    expect(chooseBotCard(state, 0)).toBe('wizard-1');
  });

  test('plays the weakest legal card once its bid is already met', () => {
    const state = fixedState({
      phase: 'playing',
      trumpSuit: 'blue',
      bids: [1, 0, 0],
      tricksWon: [1, 0, 0],
      currentTrick: [],
      hands: [[suitCard('red', 3), suitCard('red', 11), wizard(1)], [], []],
    });
    expect(chooseBotCard(state, 0)).toBe('red-3');
  });

  test('only chooses among cards that follow the led suit when it can', () => {
    const state = fixedState({
      phase: 'playing',
      trumpSuit: null,
      bids: [2, 0, 0],
      tricksWon: [0, 0, 0],
      currentTrick: [play(1, suitCard('green', 4))],
      hands: [[suitCard('red', 13), suitCard('green', 2)], [], []],
    });
    // red-13 would rank higher, but green is led and this hand holds a green card
    expect(chooseBotCard(state, 0)).toBe('green-2');
  });
});
