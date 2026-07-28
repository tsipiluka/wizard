# Card Preselect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player tap a card in their hand before it's their turn; it auto-plays the instant it becomes their turn if it's still legal, otherwise the selection is dropped with a toast and they pick manually.

**Architecture:** Pure client-side feature in `apps/web`. One new local `useState` in `Game.tsx` tracks the queued card id; a `useEffect` resolves it (plays or cancels) whenever the player's turn arrives. No server, protocol, or `packages/shared` changes.

**Tech Stack:** React 18 (function components, hooks), TypeScript, existing `PlayingCard` component and `styles.css`.

## Global Constraints

- Card play only — no preselect for bidding (spec: Scope).
- No server, protocol, or shared-engine changes (spec: Goal).
- The queue is local component state only, not persisted to `localStorage` or sent to the server (spec: Behavior — Not persisted).
- Only one card can be queued at a time; tapping the queued card again un-queues it, tapping a different card swaps the queue (spec: Behavior — Selecting).
- If the queued card is illegal when the turn arrives: cancel the queue, call `onNotice` with a toast message, and fall through to the normal manual picker (spec: Behavior — Resolving, and the user's explicit fallback choice).
- Queued and "legal-and-your-turn" cards must never look the same (spec: UI changes).

---

### Task 1: `PlayingCard` queued styling

**Files:**
- Modify: `apps/web/src/cards.tsx:62-107` (the `PlayingCard` component)
- Modify: `apps/web/src/styles.css` (near `.hand .card--raised` at line 668, and near `.hand::-webkit-scrollbar` at line 649)

**Interfaces:**
- Consumes: nothing new — existing `PlayingCard` props (`card`, `size`, `raised`, `dimmed`, `onClick`, `style`).
- Produces: `PlayingCard` accepts a new optional prop `queued?: boolean` (default `false`). When true, the rendered `<button>` gets class `card--queued` in addition to its existing classes. CSS classes `.hand .card--queued` and `.hand__note` are defined in `styles.css` for later tasks to use.

- [ ] **Step 1: Add the `queued` prop to `PlayingCard`**

Edit `apps/web/src/cards.tsx`. Replace the `PlayingCard` function signature and the `classes` array:

```tsx
export function PlayingCard({
  card,
  size = 'md',
  raised = false,
  dimmed = false,
  queued = false,
  onClick,
  style,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  raised?: boolean;
  dimmed?: boolean;
  queued?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const classes = [
    'card',
    `card--${size}`,
    card.kind === 'suit' ? `card--${card.suit}` : `card--${card.kind}`,
    raised ? 'card--raised' : '',
    dimmed ? 'card--dimmed' : '',
    queued ? 'card--queued' : '',
    onClick ? 'card--tappable' : '',
  ]
    .filter(Boolean)
    .join(' ');
```

Leave the rest of the function (the `corner`, `icon`, and returned JSX) unchanged.

- [ ] **Step 2: Add the `.card--queued` style**

Edit `apps/web/src/styles.css`. Find this block (around line 668):

```css
.hand .card--raised {
  transform: translateY(-10px) rotate(calc((var(--i) - (var(--n) - 1) / 2) * 1.6deg));
  box-shadow: 0 0 0 2px var(--gold), 0 10px 26px #d9ab5a45;
}
```

Immediately after it, add:

```css
.hand .card--queued {
  transform: translateY(-6px) rotate(calc((var(--i) - (var(--n) - 1) / 2) * 1.6deg));
  outline: 2px dashed var(--gold-bright);
  outline-offset: 3px;
}
```

- [ ] **Step 3: Add the `.hand__note` style**

In the same file, find:

```css
.hand::-webkit-scrollbar { display: none; }
```

Immediately after it, add:

```css
.hand__note {
  text-align: center;
  color: var(--gold-bright);
  font-size: 0.8rem;
  padding: 2px 0 4px;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/cards.tsx apps/web/src/styles.css
git commit -m "Add queued styling to PlayingCard for preselect"
```

---

### Task 2: Preselect state and resolution in `Game.tsx`

**Files:**
- Modify: `apps/web/src/screens/Game.tsx`

**Interfaces:**
- Consumes: `PlayingCard`'s `queued` prop and the `.card--queued` / `.hand__note` CSS classes from Task 1. Also uses the existing `cardLabel` export from `apps/web/src/cards.tsx` (already defined, not new).
- Produces: the `Game` component now requires a new prop `onNotice: (message: string) => void`, which Task 3 must supply from `App.tsx`.

- [ ] **Step 1: Import `cardLabel`**

Edit `apps/web/src/screens/Game.tsx`. Change the import line:

```tsx
import { PlayingCard, SUIT_ICONS, sortHand } from '../cards';
```

to:

```tsx
import { cardLabel, PlayingCard, SUIT_ICONS, sortHand } from '../cards';
```

- [ ] **Step 2: Add `onNotice` to the component's props**

Replace the `Game` function signature (the destructured props and their type):

```tsx
export function Game({
  state,
  emotes,
  muted,
  onToggleMute,
  onEmote,
  onBid,
  onPlay,
  onChooseTrump,
  onAgain,
  onExit,
  onNotice,
}: {
  state: ClientState;
  emotes: LiveEmote[];
  muted: number[];
  onToggleMute: (seat: number) => void;
  onEmote: (id: EmoteId) => void;
  onBid: (bid: number) => void;
  onPlay: (cardId: string) => void;
  onChooseTrump: (suit: Suit) => void;
  onAgain: () => void;
  onExit: () => void;
  onNotice: (message: string) => void;
}) {
```

- [ ] **Step 3: Add the `queuedCardId` state**

Find the existing state declarations:

```tsx
  const [showScores, setShowScores] = useState(false);
  const [showEmotes, setShowEmotes] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMove, setShowMove] = useState(false);
```

Add a fifth line right after them:

```tsx
  const [queuedCardId, setQueuedCardId] = useState<string | null>(null);
```

- [ ] **Step 4: Memoize `legal` and add the click handler**

Find:

```tsx
  const hand = useMemo(() => sortHand(state.hand), [state.hand]);
  const legal = new Set(state.legalIds);
  const canPlay = state.phase === 'playing' && myTurn && !heldTrick;
```

Replace with:

```tsx
  const hand = useMemo(() => sortHand(state.hand), [state.hand]);
  const legal = useMemo(() => new Set(state.legalIds), [state.legalIds]);
  const canPlay = state.phase === 'playing' && myTurn && !heldTrick;

  /**
   * Plays immediately if it's legally your turn; otherwise toggles the card
   * as queued so the resolving effect below can play it once your turn comes.
   */
  const handleCardClick = (cardId: string) => {
    if (canPlay && legal.has(cardId)) {
      onPlay(cardId);
      return;
    }
    if (state.phase === 'playing') {
      setQueuedCardId((prev) => (prev === cardId ? null : cardId));
    }
  };

  // Resolve a queued card once it's actually playable, or drop it if it
  // turned out illegal (led suit was established after it was queued).
  useEffect(() => {
    if (!queuedCardId) return;
    if (state.phase !== 'playing' || !hand.some((c) => c.id === queuedCardId)) {
      setQueuedCardId(null);
      return;
    }
    if (!canPlay) return;
    if (legal.has(queuedCardId)) {
      onPlay(queuedCardId);
    } else {
      onNotice("That card wasn't playable — pick another.");
    }
    setQueuedCardId(null);
  }, [queuedCardId, state.phase, canPlay, legal, hand, onPlay, onNotice]);
```

- [ ] **Step 5: Wire the hand rendering to the click handler and queued styling**

Find:

```tsx
        <div className={`hand ${hand.length > 8 ? 'hand--crowded' : ''}`}>
          {hand.map((card, i) => (
            <PlayingCard
              key={card.id}
              card={card}
              size="lg"
              raised={canPlay && legal.has(card.id)}
              dimmed={canPlay && !legal.has(card.id)}
              onClick={canPlay && legal.has(card.id) ? () => onPlay(card.id) : undefined}
              style={{ ['--i' as string]: i, ['--n' as string]: hand.length }}
            />
          ))}
        </div>
```

Replace with:

```tsx
        <div className={`hand ${hand.length > 8 ? 'hand--crowded' : ''}`}>
          {hand.map((card, i) => (
            <PlayingCard
              key={card.id}
              card={card}
              size="lg"
              raised={canPlay && legal.has(card.id)}
              dimmed={canPlay && !legal.has(card.id) && queuedCardId !== card.id}
              queued={queuedCardId === card.id}
              onClick={state.phase === 'playing' ? () => handleCardClick(card.id) : undefined}
              style={{ ['--i' as string]: i, ['--n' as string]: hand.length }}
            />
          ))}
        </div>
        {queuedCardId && (
          <p className="hand__note">
            {cardLabel(hand.find((c) => c.id === queuedCardId)!)} queued — plays on your turn
          </p>
        )}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: errors referencing `onNotice` not supplied by `App.tsx` (that's Task 3) — no other errors. If you see any error not about a missing `onNotice` prop at the `<Game ...>` call site in `App.tsx`, stop and fix it before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/Game.tsx
git commit -m "Add card preselect: queue a card, auto-play it on your turn"
```

---

### Task 3: Wire `onNotice` from `App.tsx` and verify

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `Game`'s new `onNotice` prop (Task 2) and the existing `showToast` callback already defined in `App.tsx`.
- Produces: nothing further consumes this — end of the chain.

- [ ] **Step 1: Pass `onNotice` to `Game`**

Find the `Game` render block in `apps/web/src/App.tsx`:

```tsx
  } else {
    screen = (
      <Game
        state={state}
        emotes={emotes}
        muted={muted}
        onToggleMute={(seat) =>
          setMuted((prev) => (prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]))
        }
        onEmote={(id) => act(() => api.emote(id))}
        onBid={(n) => act(() => api.bid(n))}
        onPlay={(id) => act(() => api.play(id))}
        onChooseTrump={(s) => act(() => api.chooseTrump(s))}
        onAgain={() => act(api.again)}
        onExit={() => {
          clearSession();
          setState(null);
        }}
      />
    );
  }
```

Add `onNotice={showToast}` as a new prop (order doesn't matter; add it after `onExit`):

```tsx
  } else {
    screen = (
      <Game
        state={state}
        emotes={emotes}
        muted={muted}
        onToggleMute={(seat) =>
          setMuted((prev) => (prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]))
        }
        onEmote={(id) => act(() => api.emote(id))}
        onBid={(n) => act(() => api.bid(n))}
        onPlay={(id) => act(() => api.play(id))}
        onChooseTrump={(s) => act(() => api.chooseTrump(s))}
        onAgain={() => act(api.again)}
        onExit={() => {
          clearSession();
          setState(null);
        }}
        onNotice={showToast}
      />
    );
  }
```

- [ ] **Step 2: Typecheck and build the whole project**

Run: `npm run build`
Expected: all three workspace builds succeed (`@wizard/shared` tsc, `@wizard/server` esbuild, `@wizard/web` vite build) with no TypeScript errors.

- [ ] **Step 3: Run the existing automated test suite**

Run: `npm test`
Expected: all existing tests still pass (this feature adds no new automated tests per the spec — it's UI-only local state with no server-observable effect beyond the already-tested `game:play` call).

- [ ] **Step 4: Manual verification — happy path**

Start the server and web dev servers per the project README (`npm run dev:server` in one terminal, `npm run dev:web` in another), then open the app in three browser tabs/profiles and get a 3-player game past bidding into the `playing` phase.

In a tab where it is **not** your turn:
1. Tap any card in your hand.
2. Confirm it gets a dashed gold outline and lifts slightly (the queued style), and a note appears below the hand: "`<card>` queued — plays on your turn".
3. Tap the same card again — confirm the outline and note disappear (un-queued).
4. Tap it again to re-queue it, then wait for your turn to arrive (let the other two tabs play their cards).
5. Confirm the queued card is played automatically the instant it becomes your turn, with no tap needed, and the note disappears.

- [ ] **Step 5: Manual verification — illegal fallback**

Set up a trick where you can force a mismatch: in a tab where it is not your turn and the current trick hasn't been led yet (empty `currentTrick`), queue an off-suit card that you'd only be forced to abandon if another player later leads a suit you also hold. Then, in a different tab, play a card that leads a suit you hold, before the queued player's turn arrives.

Confirm that when the turn reaches the tab with the queued card:
1. A toast appears saying the card wasn't playable.
2. The queue is cleared (no dashed outline, no note).
3. The normal manual picker appears (legal cards raised, illegal cards dimmed) and you can tap a legal card to play it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "Wire onNotice into Game for card preselect fallback toast"
```
