# Desktop Layout Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tsipizard web client (`apps/web`) look intentional on desktop-width windows, without changing anything about how it looks or behaves below 1024px.

**Architecture:** Append one new `@media (min-width: 1024px)` block to the bottom of `apps/web/src/styles.css`, built up incrementally across three tasks (Home/Lobby, Game, Sheets). Every rule inside it either widens a container or changes a layout-mode property (e.g. `flex-wrap`); no existing rule outside that block is ever edited. A fourth task does a full cross-screen regression pass.

**Tech Stack:** Plain CSS (no preprocessor), React 18 + Vite dev server, Socket.IO backend (Fastify). Verification uses the Claude Code browser tools (`mcp__Claude_Browser__*`) against the local dev servers — no new automated test framework, per the spec's "no new automated tests needed."

## Global Constraints

- Breakpoint is exactly `min-width: 1024px` (per spec: tablets and phones stay mobile; laptop-and-up gets the desktop rules).
- Single file touched: `apps/web/src/styles.css`. All new rules live inside one `@media (min-width: 1024px)` block appended after the existing `@media (min-width: 700px)` block at the end of the file.
- Never edit a rule outside that new block. Never edit a rule below (inside) the existing `@media (min-width: 700px)` block either — that block's current content must remain byte-identical.
- No JS/TSX changes anywhere. No new dependencies.
- Dev servers: `apps/server` on port 8080 (or `autoPort`), `apps/web` (Vite) on port 5173 proxying `/socket.io`. Both are already configured in `.claude/launch.json` as `wizard-server` and `wizard-web`.

---

## File Structure

Only one file changes:

- Modify: `apps/web/src/styles.css` — append a new `@media (min-width: 1024px)` block at end-of-file, built incrementally:
  - Task 1 creates the block with Home/Lobby rules.
  - Task 2 appends Game-screen rules (container, opponents wrap, seat chips, card sizes, trick area, hand) before the block's closing `}`.
  - Task 3 appends sheet/modal rules before the block's closing `}`.

No test files are created — verification is live-browser assertions against the dev server, run as plan steps (see each task).

---

### Task 1: Home & Lobby desktop scale-up

**Files:**
- Modify: `apps/web/src/styles.css` (end of file, after line 1170)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `@media (min-width: 1024px) { ... }` block itself, which Task 2 and Task 3 append into. It must end with a lone closing `}` on its own line so later tasks have a stable, unique anchor to insert before.

- [ ] **Step 1: Append the new media query block with Home/Lobby rules**

The current end of `apps/web/src/styles.css` (lines 1165–1170) reads:

```css
/* wider screens: cap the game like a table felt */
@media (min-width: 700px) {
  .game { padding-top: 24px; }
  .card { width: 84px; height: 120px; }
  .card--lg { width: 96px; height: 138px; }
}
```

Use the Edit tool with this exact `old_string` (the block above) and replace it with:

```css
/* wider screens: cap the game like a table felt */
@media (min-width: 700px) {
  .game { padding-top: 24px; }
  .card { width: 84px; height: 120px; }
  .card--lg { width: 96px; height: 138px; }
}

/* ── desktop (1024px+): wider layout built on top of the mobile rules above;
   nothing outside this block is touched, so mobile is unaffected ── */
@media (min-width: 1024px) {
  /* home & lobby: scale up the centered card, no structural change */
  .home,
  .lobby {
    max-width: 520px;
  }

  .home {
    padding: 40px 32px calc(40px + env(safe-area-inset-bottom));
  }

  .lobby {
    padding: 36px 32px calc(36px + env(safe-area-inset-bottom));
  }

  .home__title {
    font-size: 4rem;
  }

  .lobby__glyph {
    width: 64px;
    height: 78px;
    font-size: 2.6rem;
  }
}
```

- [ ] **Step 2: Start the dev servers**

Run: `mcp__Claude_Browser__preview_start` with `{"name": "wizard-server"}`, then again with `{"name": "wizard-web"}`.
Expected: both start cleanly; the second call returns a `tabId` with the web app loaded (Home screen visible).

- [ ] **Step 3: Verify Home screen at mobile width (1024px rules must NOT apply)**

Run: `mcp__Claude_Browser__resize_window` with `{"tabId": "<tabId>", "width": 375, "height": 812}`.
Then run: `mcp__Claude_Browser__javascript_tool` with:
```js
JSON.stringify({
  homeMaxWidth: getComputedStyle(document.querySelector('.home')).maxWidth,
  titleFontSize: getComputedStyle(document.querySelector('.home__title')).fontSize,
})
```
Expected: `homeMaxWidth` is `"430px"` (unchanged mobile value) and `titleFontSize` is **not** `"64px"` (i.e. still governed by the original `clamp()`, not the new desktop override).

- [ ] **Step 4: Verify Home screen at desktop width (1024px rules must apply)**

Run: `mcp__Claude_Browser__resize_window` with `{"tabId": "<tabId>", "width": 1280, "height": 900}`.
Then run the same `javascript_tool` snippet as Step 3.
Expected: `homeMaxWidth` is `"520px"` and `titleFontSize` is `"64px"`.

- [ ] **Step 5: Reach the Lobby screen and verify it at both widths**

At 1280×900, fill the form and submit:
- `mcp__Claude_Browser__find` with `{"query": "Your name input field"}` → get `ref`.
- `mcp__Claude_Browser__form_input` with that `ref` and `{"value": "Merlin"}`.
- `mcp__Claude_Browser__find` with `{"query": "Light the candles submit button"}` → get `ref`.
- `mcp__Claude_Browser__computer` `{"action": "left_click", "ref": "<ref>"}`.

Expected: the Lobby screen renders (a 4-letter table code is visible).

Then run `javascript_tool`:
```js
JSON.stringify({
  lobbyMaxWidth: getComputedStyle(document.querySelector('.lobby')).maxWidth,
  glyphWidth: getComputedStyle(document.querySelector('.lobby__glyph')).width,
  glyphHeight: getComputedStyle(document.querySelector('.lobby__glyph')).height,
})
```
Expected at 1280×900: `{"lobbyMaxWidth":"520px","glyphWidth":"64px","glyphHeight":"78px"}`.

Run `resize_window` to `{"width": 375, "height": 812}` and run the same snippet again.
Expected at 375×812: `{"lobbyMaxWidth":"430px","glyphWidth":"54px","glyphHeight":"66px"}` (original mobile values, unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "Add desktop breakpoint with Home/Lobby scale-up"
```

---

### Task 2: Game screen desktop layout

**Files:**
- Modify: `apps/web/src/styles.css` (inside the `@media (min-width: 1024px)` block added in Task 1)

**Interfaces:**
- Consumes: the `@media (min-width: 1024px) { ... }` block from Task 1, specifically its final rule `.lobby__glyph { ... }` immediately followed by the block's closing `}` — this is the anchor for insertion.
- Produces: desktop rules for `.game`, `.game__opponents`, `.seatchip*`, `.card*`, `.trick*`, `.hand`, appended before the same closing `}` so Task 3 can anchor on the new end of the block (`.hand { min-height: 168px; }` followed by `}`).

- [ ] **Step 1: Insert the Game-screen rules into the desktop block**

Use the Edit tool with this exact `old_string`:

```css
  .lobby__glyph {
    width: 64px;
    height: 78px;
    font-size: 2.6rem;
  }
}
```

Replace with:

```css
  .lobby__glyph {
    width: 64px;
    height: 78px;
    font-size: 2.6rem;
  }

  /* game: use the wider viewport instead of floating in a phone-width column */
  .game {
    max-width: 960px;
    padding-left: 24px;
    padding-right: 24px;
  }

  /* opponents: wrap into a static row instead of a horizontal-scroll strip —
     up to 5 opponents fit without ever needing to scroll */
  .game__opponents {
    flex-wrap: wrap;
    overflow-x: visible;
    justify-content: center;
  }

  .seatchip {
    min-width: 110px;
  }

  .seatchip__name {
    font-size: 0.9rem;
    max-width: 130px;
  }

  .seatchip__meta {
    font-size: 0.84rem;
  }

  .seatchip__score {
    font-size: 0.92rem;
  }

  /* cards: another size bump on top of the 700px one */
  .card {
    width: 96px;
    height: 138px;
  }

  .card--sm {
    width: 64px;
    height: 92px;
  }

  .card--lg {
    width: 112px;
    height: 160px;
  }

  .trick {
    min-height: 148px;
  }

  .trick__empty {
    width: 96px;
    height: 138px;
    font-size: 2.6rem;
  }

  .trick__who {
    max-width: 92px;
    font-size: 0.78rem;
  }

  .hand {
    min-height: 168px;
  }
}
```

- [ ] **Step 2: Start the dev servers (if not already running from Task 1)**

Run `mcp__Claude_Browser__preview_list`. If `wizard-server` and `wizard-web` aren't listed, start them as in Task 1 Step 2.

- [ ] **Step 3: Build a live 6-player table (host + 5 bots) to exercise the worst-case opponents row**

At a fresh tab (or reuse the existing one), navigate to the web app root, then:
- `find` "Your name input field" → `form_input` value `"Merlin"`.
- `find` "Light the candles submit button" → `computer` click. (Lands in Lobby, host of a private table.)
- `find` "Add a bot button" → `computer` click it **5 times** (re-run `find` between clicks since the list re-renders; stop once 6 players total are seated — 1 host + 5 bots).
- `find` "Begin the game button" → `computer` click.

Expected: the Game screen renders with 5 opponent seat chips in `.game__opponents`.

- [ ] **Step 4: Verify the opponents row never needs horizontal scrolling at desktop width**

Run `resize_window` to `{"width": 1280, "height": 900}`.
Run `javascript_tool`:
```js
(() => {
  const el = document.querySelector('.game__opponents');
  return JSON.stringify({
    flexWrap: getComputedStyle(el).flexWrap,
    overflowX: getComputedStyle(el).overflowX,
    noHorizontalOverflow: el.scrollWidth <= el.clientWidth + 1, // +1 for rounding
    opponentCount: el.children.length,
  });
})()
```
Expected: `flexWrap` is `"wrap"`, `overflowX` is `"visible"`, `noHorizontalOverflow` is `true`, `opponentCount` is `5`.

- [ ] **Step 5: Verify card and container sizes at desktop width**

Still at 1280×900, run `javascript_tool`:
```js
(() => {
  const handCard = document.querySelector('.hand .card--lg');
  const trumpCard = document.querySelector('.tabletrump .card--sm');
  return JSON.stringify({
    gameMaxWidth: getComputedStyle(document.querySelector('.game')).maxWidth,
    handCardWidth: handCard && getComputedStyle(handCard).width,
    trumpCardWidth: trumpCard && getComputedStyle(trumpCard).width,
  });
})()
```
Expected: `gameMaxWidth` is `"960px"`, `handCardWidth` is `"112px"`, `trumpCardWidth` is `"64px"`.

- [ ] **Step 6: Verify mobile is unaffected**

Run `resize_window` to `{"width": 375, "height": 812}`.
Run `javascript_tool`:
```js
(() => {
  const el = document.querySelector('.game__opponents');
  const handCard = document.querySelector('.hand .card--lg');
  return JSON.stringify({
    gameMaxWidth: getComputedStyle(document.querySelector('.game')).maxWidth,
    flexWrap: getComputedStyle(el).flexWrap,
    overflowX: getComputedStyle(el).overflowX,
    handCardWidth: handCard && getComputedStyle(handCard).width,
  });
})()
```
Expected: `gameMaxWidth` is `"640px"`, `flexWrap` is `"nowrap"`, `overflowX` is `"auto"`, `handCardWidth` is `"96px"` (all original mobile/tablet values — the 700px query still applies below 1024px, exactly as before).

- [ ] **Step 7: Screenshot for visual sanity check**

Run `resize_window` back to `{"width": 1280, "height": 900}`, then `mcp__Claude_Browser__computer` `{"action": "screenshot"}`.
Expected: 5 opponent chips visible in a single row (or two, centered), no scrollbar under them, hand cards visibly larger than a phone-sized card.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "Add desktop Game-screen layout: wider table, wrapping opponents row, bigger cards"
```

---

### Task 3: Sheets/modals desktop centering

**Files:**
- Modify: `apps/web/src/styles.css` (inside the `@media (min-width: 1024px)` block)

**Interfaces:**
- Consumes: the block's current tail, `.hand { min-height: 168px; }` followed by the block's closing `}` (added in Task 2) — anchor for insertion.
- Produces: desktop rules for `.sheet__veil` and `.sheet`, appended before the block's closing `}`.

- [ ] **Step 1: Insert the sheet/modal rules**

Use the Edit tool with this exact `old_string`:

```css
  .hand {
    min-height: 168px;
  }
}
```

Replace with:

```css
  .hand {
    min-height: 168px;
  }

  /* sheets: centered dialog instead of a bottom sheet */
  .sheet__veil {
    align-items: center;
  }

  .sheet {
    max-width: 520px;
    border-radius: 20px;
  }
}
```

- [ ] **Step 2: Start the dev servers (if not already running)**

Run `mcp__Claude_Browser__preview_list`; start `wizard-server` and `wizard-web` if not present, as in Task 1 Step 2.

- [ ] **Step 3: Reach an active game and open the Scores sheet**

Navigate to the web app root, then:
- `find` "Your name input field" → `form_input` value `"Merlin"`.
- `find` "Light the candles submit button" → `computer` click.
- `find` "Add a bot button" → `computer` click **twice** (3 players total, minimum to start).
- `find` "Begin the game button" → `computer` click.
- Resize to `{"width": 1280, "height": 900}`.
- `find` "Scores button" → `computer` click.

Expected: the score sheet opens.

- [ ] **Step 4: Verify the sheet is centered and fully rounded at desktop width**

Run `javascript_tool`:
```js
(() => {
  const veil = document.querySelector('.sheet__veil');
  const sheet = document.querySelector('.sheet');
  return JSON.stringify({
    veilAlignItems: getComputedStyle(veil).alignItems,
    sheetMaxWidth: getComputedStyle(sheet).maxWidth,
    sheetBorderRadius: getComputedStyle(sheet).borderRadius,
  });
})()
```
Expected: `veilAlignItems` is `"center"`, `sheetMaxWidth` is `"520px"`, `sheetBorderRadius` is `"20px"` (all four corners equal — not the mobile `"20px 20px 0px 0px"`).

- [ ] **Step 5: Verify mobile sheets are unaffected**

Close the sheet (`find` "Close button" → click, or click the veil background), resize to `{"width": 375, "height": 812}`, reopen the Scores sheet the same way, then run the same `javascript_tool` snippet.
Expected: `veilAlignItems` is `"flex-end"`, `sheetMaxWidth` is `"480px"`, `sheetBorderRadius` is `"20px 20px 0px 0px"` (original mobile bottom-sheet values, unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "Center sheets/modals as dialogs at desktop width"
```

---

### Task 4: Full cross-screen regression pass

**Files:**
- None (verification only; fix-and-recommit here only if a regression is found).

**Interfaces:**
- Consumes: the complete `apps/web/src/styles.css` from Tasks 1–3.
- Produces: confidence that the whole feature works end-to-end and mobile is provably untouched.

- [ ] **Step 1: Confirm the diff is purely additive**

Run: `git diff 9b594f5..HEAD -- apps/web/src/styles.css` is not meaningful here (that range predates this feature); instead run:
```bash
git log --oneline -4
git diff HEAD~3 -- apps/web/src/styles.css
```
Expected: the diff shows only **added** lines (`+`), all located after the original `@media (min-width: 700px) { ... }` block; zero removed or modified lines (no `-` lines except possibly a trailing blank-line context line).

- [ ] **Step 2: Start the dev servers (if not already running)**

Run `mcp__Claude_Browser__preview_list`; start `wizard-server` and `wizard-web` if not present, as in Task 1 Step 2.

- [ ] **Step 3: Desktop pass — Home, Lobby, and a full round through round-end**

At `{"width": 1280, "height": 900}`:
- Home: navigate to root, screenshot. Confirm centered card, larger title, no console errors (`mcp__Claude_Browser__read_console_messages` with `{"onlyErrors": true}` → expect empty).
- Create a table (name "Merlin"), add 2 bots (3 players total), start the game. Screenshot the Lobby before starting, and the Game screen right after.
- Play through bidding: `find` a bid button (e.g. "bid 0 button") and click it when it's your turn (status line reads "Your turn"/"Your bid" — check via `get_page_text`).
- Play through the round: when the status line shows it's your turn to play, `find` any card in your hand's raised/legal state and click it (or use `read_page` to find a `.card` with `raised` styling). Repeat until the round-end sheet ("the reckoning") appears — `find` "the reckoning" text or wait via `mcp__Claude_Browser__get_page_text` polling.
- Screenshot the round-end sheet. Confirm it's centered (same `.sheet` class as Task 3 verified) and legible at this width.

Expected: no layout breakage (no clipped text, no horizontal page-level scrollbar — check `document.documentElement.scrollWidth <= window.innerWidth` via `javascript_tool`), no console errors at any point.

- [ ] **Step 4: Also check 1440px width**

Resize to `{"width": 1440, "height": 900}` on the same in-progress game (or Home if the game ended). Screenshot the current screen.
Expected: layout still centered/capped sensibly (game caps at 960px, home/lobby at 520px — should not stretch edge-to-edge), no overflow.

- [ ] **Step 5: Mobile pass — confirm nothing changed**

Resize to `{"width": 375, "height": 812}`. Navigate fresh to the web app root (Home), screenshot. Repeat the create-table → Lobby → start-game flow with 2 bots, screenshot the Game screen.
Expected: visually identical to the pre-existing mobile design (narrow column, horizontal-scroll opponents strip if more chips than fit, bottom-anchored sheets) — no visual regressions. Combined with Step 1's diff proof, this confirms the mobile experience is unchanged.

- [ ] **Step 6: Record outcome**

If any check in Steps 3–5 fails, fix the offending rule in `apps/web/src/styles.css` (staying inside the `@media (min-width: 1024px)` block unless the bug is that a mobile rule was accidentally touched, in which case revert that specific edit), re-run the failing step, then:
```bash
git add apps/web/src/styles.css
git commit -m "Fix desktop layout regression found in final pass"
```
If everything passes, no commit is needed for this task — it's verification-only.

---

## Self-Review Notes

- **Spec coverage:** Home/Lobby scale-up (Task 1), Game container + opponents wrap + card sizes (Task 2), sheets/modals centering (Task 3), and the spec's required mobile/desktop verification pass (Task 4) are all covered. The spec's explicit "no new automated tests needed" is honored — all verification is live-browser assertion, not a new test suite.
- **Placeholder scan:** every step has literal CSS, literal JS assertions, and literal expected values — no "add appropriate styling" language.
- **Type/selector consistency:** class names (`.game`, `.game__opponents`, `.seatchip`, `.card`, `.card--sm`, `.card--lg`, `.trick`, `.trick__empty`, `.trick__who`, `.hand`, `.sheet`, `.sheet__veil`, `.home`, `.home__title`, `.lobby`, `.lobby__glyph`) are all taken verbatim from the current `apps/web/src/styles.css` and `apps/web/src/screens/*.tsx` — none invented.
- **Anchors:** each task's `old_string` is the literal tail of the previous task's insertion, verified unique (it's newly-added text, so it only occurs once in the file).
