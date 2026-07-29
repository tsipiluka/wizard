# Desktop Layout Optimization — Design Spec

**Date:** 2026-07-29
**Status:** Approved for implementation

## Goal

The web client (`apps/web`) is mobile-first and looks it: every screen is a single
narrow column (max-width 420–640px) centered on the page, with only one existing
desktop concession (a small card-size bump at 700px). On a real desktop/laptop
window this leaves large empty margins and small, cramped elements.

Add a desktop-optimized layout **without changing the mobile experience at all**.
Light polish, not a redesign: same structure, screens, and components — just used
better on wide screens.

## Non-goals

- No structural/markup rework (no new panels, no rearranging opponents around a
  virtual table, no persistent sidebar). That's a bigger project for later if wanted.
- No JS-driven layout branching (no `useMediaQuery` hook, no conditional rendering
  by viewport). CSS media query only.
- Zero changes to any rule that applies below the new breakpoint — mobile output
  must be byte-for-byte behaviorally identical.

## Approach

A single additive `@media (min-width: 1024px)` block, appended to
`apps/web/src/styles.css` (after the existing `@media (min-width: 700px)` block).
It only widens containers, scales up sizes, and overrides layout-mode properties
(e.g. `flex-wrap`) for elements that exist at all breakpoints — it never edits an
existing base (mobile) rule in place. This is the lowest-risk way to guarantee
mobile is untouched: the base rules stay exactly as written, and desktop is
strictly additive on top.

1024px was chosen so tablets (portrait and most landscape) and all phones keep the
mobile layout; only laptop-and-up windows get the desktop treatment.

## Changes by screen

### Home & Lobby

Both are already a centered-card pattern that reads fine on desktop — they just
feel small. At 1024px+:
- `.home` / `.lobby` max-width: 430px → ~520px.
- Scale up a few standout elements: `.home__title`, `.lobby__glyph` (the table
  code tiles), form padding.
- No structural change.

### Game screen

The main piece, and where the reported pain point lives (opponents row not
scrollable without a trackpad — no visible scrollbar, horizontal-only overflow,
plain mouse wheel does nothing).

- `.game` max-width: 640px → ~960px, so the table area uses the extra width
  instead of floating in a narrow column.
- `.game__opponents`: at desktop, replace the horizontal-scroll strip
  (`overflow-x: auto`, single row) with `flex-wrap: wrap` and no scroll
  container. With at most 5 opponents (6-player max game), they wrap into a
  static row (or two) that fully fits on screen — this removes the need to
  scroll at all, which is the actual fix for the reported problem, not just a
  scrolling-mechanism workaround.
- Card sizes get another bump on top of the existing 700px one (e.g. hand cards
  ~96px → ~110px tall-equivalent, trick/table cards similarly), sized so a full
  20-card hand (3-player game, round 20) still fits the wider hand strip without
  looking sparse or forcing scroll where it didn't before.
- Trick area, seat chips, status text: modest size/gap increases to match the
  larger canvas. No structural change.

### Sheets/modals (scores, table menu, emotes, round-end reckoning, game-over)

Currently a mobile bottom-sheet: pinned to the bottom edge of the viewport, only
top corners rounded (`align-items: flex-end` on the veil). At 1024px+, switch to
a centered dialog: `align-items: center`, all four corners rounded, modest
max-width increase (480px → ~520px). Small CSS-only change, common "desktop-ify a
mobile sheet" pattern.

## Testing / verification

Pure CSS, no logic changes — verification is visual, via the dev server:
- Desktop widths (1024px and 1440px+): Home, Lobby, and Game (bidding prompt,
  active trick, round-end sheet, game-over sheet) all check out — no overflow,
  no clipped text, opponents row never needs scrolling.
- Mobile width (375px): re-check all screens look and behave exactly as before.
  Since the change is purely additive at a `min-width: 1024px` query, the mobile
  rules are provably unchanged (diff of `styles.css` shows only additions after
  the existing 700px block) — the visual check is a confirmation, not the only
  evidence.
- No new automated tests needed (nothing here is unit-testable game logic).
