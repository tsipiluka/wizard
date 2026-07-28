# Card Preselect — Design Spec

**Date:** 2026-07-26
**Status:** Approved for implementation

## Goal

During trick play, let a player tap a card in their hand before it's their turn.
That card auto-plays the instant it becomes their turn, if it's still legal —
so players don't have to sit and watch the table just to react in time.

## Scope

Card play only. Bidding is unaffected — no preselect for bid numbers.

Purely a client-side UX feature: no server, protocol, or shared-engine changes.
The server already computes `legalIds` fresh for whoever's turn it is; this
feature just decides, on the client, when to call the existing `onPlay(cardId)`
without a human tap in the moment.

## Behavior

**Selecting:**
- While `state.phase === 'playing'`, every card in your hand becomes tappable
  (today, only legal-and-your-turn cards are tappable; others are inert).
- Tapping a card:
  - If it's currently your turn and the card is legal → plays immediately
    (existing behavior, unchanged).
  - Otherwise → toggles that card as **queued**. Only one card can be queued
    at a time: tapping the queued card again un-queues it; tapping a
    different card swaps the queue to that card.

**Resolving:**
- A `useEffect` watches for `canPlay` (your turn, phase is `playing`, no
  trick-hold delay in progress) becoming true while a card is queued.
- If the queued card is still in `state.legalIds` → call `onPlay(queuedCardId)`
  and clear the queue.
- If it is not (led suit was established after you queued, and you hold that
  suit) → clear the queue, call `onNotice(...)` to show a toast ("that card
  wasn't playable — pick another"), and fall through to the normal manual
  picker (today's raised/dimmed legal-card UI).
- Safety net: the queue also clears if `state.phase` leaves `'playing'`, or
  the queued card id is no longer present in `state.hand` (defensive only —
  shouldn't happen in normal play since a card only leaves the hand by being
  played).

**Not persisted:** the queue is local component state (`useState` in
`Game.tsx`), not saved to `localStorage` or sent to the server. A page
reload or reconnect simply loses it — acceptable for a convenience feature.

## Why unrestricted selection (not legality-filtered)

Considered filtering the tap targets to only currently-legal cards, mirroring
`legalCardIds` from `@wizard/shared` client-side. Rejected: it requires
either duplicating that logic or faking a `GameState` object client-side to
reuse it, just to filter a picker — and it's frequently moot anyway, since
often nobody has led the trick yet when a player queues (led suit isn't
knowable), so "legal now" would only ever be "everything." The agreed
fallback (cancel + toast) already handles the case where a queued card turns
out illegal by the time the turn arrives, so unrestricted selection is
simpler and covers the same ground.

## UI changes

- `PlayingCard` ([cards.tsx](../../../apps/web/src/cards.tsx)) gets a new
  boolean prop `queued`, styled distinctly from the existing `raised` (legal,
  your turn) state — a dashed gold ring + slight lift, so queued and
  "legal right now" never look the same.
- `Game.tsx`: hand cards become tappable whenever `phase === 'playing'`
  (today's `onClick` is gated on `canPlay && legal.has(card.id)`; it becomes
  a dispatcher that plays-now or toggles-queue depending on `canPlay`).
- A short status line appears under the hand while a card is queued, e.g.
  "Red 7 queued — plays on your turn."
- New prop on `Game`: `onNotice: (message: string) => void`, wired in
  `App.tsx` to the existing `showToast`.

## Testing

No new automated tests planned — this is local React state and interaction
behavior with no server-observable effect beyond the existing `game:play`
call, which is already covered. Verification is manual/visual in the
browser: queue a card, let the turn arrive, confirm auto-play; queue a card
that becomes illegal, confirm the toast and manual fallback.

## Out of scope

- Bidding preselect.
- Persisting the queue across reconnects.
- Queueing more than one card ahead (e.g., "if this card is unplayable, try
  this one next").
