# Changelog

All notable changes to `@ozjsey/v-fit-children`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**On evidence.** Every entry under 2.3.0 is backed by a test in `vFitChildren.test.ts` or
`architecture.test.ts` that was shown to fail when the fix is reverted — mutation-tested, not just
written. The four that jsdom cannot honestly reach (a first pass that hides everything, `isOverflowing`
across a real resize, an in-place array mutation, and a dangling separator) were additionally driven
in a real Chrome against **the published 2.2.0 artifact from `node_modules`**, where they fail, and
against the working source, where they pass:

```bash
cd playground
pnpm interactions                                   # 13/13 against the source
PLAYGROUND_UNALIAS=v-fit-children pnpm interactions  # the same checks against 2.2.0 — 6 fail
```

Entries for 2.2.0 and earlier are **reproduced from the README changelog**, which was the package's
only record before this file existed. They have not been independently re-verified; where the 2.3.0
entries contradict them, 2.3.0 is the measured one — see "2.2.0 claims this file corrects" below.

## [2.3.0] — unreleased

Built locally, **not published**. npm's `latest` is 2.2.0.

The engine is not what changed. An independent audit drove the published 2.2.0 through 2,193
measurements and found zero half-clipped children, worst overshoot +0.5px inside its own `EPSILON`,
monotonic everywhere. Everything below is a defect in what the directive *reported* about a row it
was computing correctly, or in what it measured before computing it.

### Fixed — the event

- **A first pass that hid *every* child dispatched nothing.** `state.visible` starts as an empty
  `Set`; when the first computed fit was also empty, the gate read "no change" and skipped the
  dispatch. `data-v-fit-state="overflowing"` was written correctly in the same pass — which is why
  CSS-only styling kept working and **every event-driven consumer silently did not**. The visible
  consequence is an over-full row with no "+N more" badge at exactly the widths where the badge is
  the only affordance the user has left: a phone. Reproduced at mount, after a `v-if` remount, and
  after a resize that keeps the run empty. Playground card 10 mounts in that state on purpose.

- **The dispatch gate compared the *visible* set plus the `data` array's reference identity, while
  every field of the payload is about the *hidden* set.** `items.push()` / `pop()` / `splice()` is
  how Vue code mutates an array, and it moves neither term — so the "+N more" badge, and the
  dropdown behind it, kept naming rows the user had already deleted. Measured against the built
  bundle: six chips in 300px, three hidden ones popped off the array and the DOM; reality 0 hidden,
  last event still `hiddenChildrenCount: 3`, `hiddenData: ["d","e","f"]` and three **detached**
  elements in `hiddenChildren`, while `data-v-fit-state` on the same host correctly read `fits`. The
  gate now compares the payload against the one last dispatched, field by field, which is the only
  thing a listener can actually observe.

- **`isOverflowing` went stale on the resize path.** The attribute write sits above the early return
  and the dispatch below it, so the two outputs of one pass could contradict each other. On a row
  where the visible set cannot move — every child carrying `data-v-fit-keep` — the attribute
  flipped `fits` ↔ `overflowing` correctly across a 140→700px sweep and the event's `isOverflowing`
  stayed `false` throughout. The 2.2.0 changelog lists this case as fixed and a test covered it, but
  only on the **mount** pass, where `state.visible` is empty so the dispatch happens whatever the
  gate says. The resize path was never exercised. Playground card 11 is that row.

- **The gate is still a gate.** Hiding a child is itself a resize, so an unconditional dispatch lets
  a listener that renders a badge from the payload loop forever. A recalculation that changes
  nothing a listener could see remains silent, and that is now tested in both directions.

### Fixed — the payload

- **The two documented ways to pin a child disagreed about `data`.** `isDataChild` excluded the
  `keepVisibleEl`-matched child from the data index but not a `data-v-fit-keep` one, so the same
  layout produced `hiddenData: ["delta"]` one way and `["charlie","delta"]` the other — and
  `hiddenChildrenCount: 2` beside a `hiddenData.length` of 1, with the one name shown being the
  wrong one. The out-of-range index was swallowed by a `.filter()`, turning a mapping bug into a
  quietly short array.

  Membership in `data` is now **declared** — by the absence of `data-v-fit-decorative` — and is not
  inferred from pinning. Pinning is about visibility; membership is about your array; they are
  unrelated, and a child that is pinned *and* not one of your items says both.

  **Behaviour change for existing consumers:** if you pass `keepVisibleEl` pointing at a child that
  *is* one of your `data` items, `hiddenData` changes. It was skewed by one before.

- **A `data` array that does not map 1:1 with the mapped children now warns**, once per distinct
  mismatch (a resize drag would otherwise log sixty times a second), instead of returning a short
  array with no explanation.

- **A decorative separator could be left trailing the visible run with nothing after it** —
  `Ada · Grace · Alan ·` followed by `+2 more`, in the canonical demo for the feature. A decorative
  child is punctuation *between* two others; left at the end it introduces nothing, and trimming it
  can only give the row back width.

### Fixed — measurement

- **A flex child that can shrink was measured at the width the row had already given it.** A flex
  item whose `overflow` is not `visible` has an automatic minimum size of zero (CSS Flexbox §4.5),
  so with the default `flex-shrink: 1` the browser squashes it to whatever the host had left —
  which is our own previous answer echoed back. `sum(cost)` then collapses to the available width by
  construction, `full <= available` is satisfied, and the directive concludes "fits" while every
  chip sits ellipsised to a few pixels and no event ever fires. `overflow: hidden; text-overflow:
  ellipsis` is the single most common chip CSS there is. Such a child is now measured by its
  `scrollWidth`, which is what it actually wants. (The playground never revealed this because its
  chips are `white-space: nowrap`, which raises the automatic minimum back to the full text width.)

- **A classic scrollbar was counted as available width.** It sits inside the border box that
  `getBoundingClientRect` reports and outside `clientWidth`, so the budget was ~15px too generous on
  Windows and Linux — one child too many admitted, rendering clipped at the host's edge. On macOS
  overlay scrollbars the correction is zero, which is how it shipped. `getContentWidth` now
  subtracts it, and is deliberately the same quantity a `ResizeObserver` reports in
  `entry.contentRect.width`.

- **The measuring cursor advanced by a spilling child's content extent rather than by its box.** The
  next child's real `rect.left` is laid out against the previous child's *box*, so advancing by the
  larger value clamped the gap in front of it to zero: a row of content-spilling children was billed
  for fewer gaps than it has, and admitted a chip too many.

### Removed

- **The cached "shrinking is free — no DOM is read at all" pass.** Advertised in the README,
  `ARCHITECTURE.md`, the playground manifest and the package brief, and it was never an
  optimisation: a cached pass was only ever allowed to *confirm* the run it was handed, so the only
  shrink it saved a measurement on was a shrink that changed nothing, while every shrink that
  dropped a chip ran the decision twice. What it did cost was a second source of widths —
  `observers.ts` storing `ResizeObserver` content rects, taken with children hidden and under a
  different geometry definition — feeding the same `min(host, container)` as `measure.ts`. That is
  precisely the "second, disagreeing measurement" `ARCHITECTURE.md`'s first invariant exists to
  forbid, and it is the defect class that produced partially-visible children for the whole of 2.x.
  Every pass now measures, with every child shown first. `observers.ts` reads no boxes at all: an
  entry is a signal that geometry moved, never a number the decision consumes.

- The `remeasure` / `lastAvailable` / `appliedAvailable` plumbing that existed to maintain it, and
  an unused `getContentWidth` import left behind in `observers.ts`.

### Added

- **`architecture.test.ts`** — the invariants `ARCHITECTURE.md` names, asserted instead of asserted
  *about*. It fails if a layout API (`getBoundingClientRect`, `getComputedStyle`, `scrollWidth`,
  `offsetWidth`, `clientWidth`, and the height equivalents) appears in any module but `measure.ts`,
  if anything assigns `style.display`, if `constants.ts` or `types.ts` grows an import, or if the
  module graph grows a cycle. Each check is negative-controlled by a mutation that trips it.

- Playground cards **10 (`the event reports what is true now`)** and
  **11 (`isOverflowing on a row that cannot hide anything`)**, and the tab's first browser spec,
  `playground/scripts/interactions/v-fit-children.mjs` — 13 checks over 7 of 11 cards.

### Documentation corrected against the source

The README is the accurate document and matches the published artifact; these are the places it did
not. Also corrected: `ARCHITECTURE.md`, the playground manifest and cards 1, 2, 4, 5 and 6, the
package brief (`instructions/v-fit-children.md`) and the repository's `CLAUDE.md`.

- "the directive element's own margin, border, and padding are subtracted from the available space"
  — nothing is subtracted; the available width is `min(host, container)`, both content widths.
  Naming an ancestor only changes the answer when the host can measure *wider* than the space it is
  given, which a flex item or a block-level host never can.
- "`isOverflowing`: `true` if any children were hidden" — it is `true` whenever the content exceeds
  the available width, whether or not anything could be hidden about it. `v-if="isOverflowing"` on a
  "+N more" badge renders `+0 more` on a clipped, fully-pinned row.
- "When all children fit (including the offset), `isOverflowing` is `false`" — the smart-fit branch
  tests the total *without* the offset, deliberately.
- "`hiddenIndices` … so you can also map manually if needed" — `hiddenIndices` holds DOM child
  positions and `hiddenData` indexes your array; they coincide only in a row with no decorative and
  no `v-show` children.
- "`FitChildrenPlugin`, `DIRECTIVE_NAME`, `data-fit-children-state`" — named only in `CLAUDE.md` and
  the package brief, and present in no version of this package. There is deliberately no plugin
  export and no registration-name constant: `<script setup>` picks `vFitChildren` up by naming
  convention, and anyone who wants it global writes one `app.directive()` call under whatever name
  suits them. The host attribute is and always was **`data-v-fit-state`**.
- A source comment claimed a `||` fallback in `measure.ts` was load-bearing "because the gap tests
  mock `getComputedStyle` down to two keys". No test mocked `getComputedStyle`; the justification
  was false and the branch was unreachable on its own terms.
- Quick start, the `keepVisibleEl` recipes and the inline-badge recipe all used a `tags` that was
  never declared, so none of them compiled as pasted.

### 2.2.0 claims this file corrects

- *"Swapping the `data` array with an unchanged fit left `hiddenData` stale"* — fixed only the
  immutable-replacement half. In-place mutation, and hidden children simply being added or removed,
  were still invisible to the gate. See the first two entries under "Fixed — the event".
- *"`isOverflowing` reported `fits` for a row of entirely pinned children that was visibly
  clipped"* — fixed on the mount pass only; the resize path was still wrong.

## [2.2.0] — 2026-08

*Reproduced from the README changelog; not independently re-verified.*

First release under the `@ozjsey` scope. The unscoped `v-fit-children` package stops here.

Not a drop-in upgrade from `v-fit-children@2.1.0`: the version line is continuous, but hiding moved
from inline `display: none !important` to `data-v-fit-hidden` plus an injected stylesheet — so CSS or
transitions keyed on the inline style need updating, and a strict `style-src` CSP now disables hiding
**silently**. `gap` became a floor over measured spacing rather than a replacement, so it can only
reserve more room, never less.

**Fixed:** hidden children could no longer be measured, so the running total collapsed and the
"everything fits" branch admitted more children than fit; the directive fought `v-show` by clearing
inline `display: none` it had not set; a resizing sibling was invisible; a shrink-to-fit host could
collapse to zero children; a badge labelled from the hidden set could cycle forever; `gap` charged a
leading gap to the first child; `isOverflowing` reported `fits` for a clipped all-pinned row; a
swapped `data` array left `hiddenData` stale; a negative available width produced an invalid
declaration that disabled hiding entirely.

**Added:** `data-v-fit-state="fits" | "overflowing"` on the host; per-child and per-sibling
`ResizeObserver` coverage; the `FitChildrenFitState` exported type.

**Internal:** the ghost element, its clones, the `IntersectionObserver` and the
`requestAnimationFrame` batching are gone; the source is split into single-purpose modules under
`src/`.

## [2.0.0]

*Reproduced from the README changelog; not independently re-verified.*

**Breaking:** removed `sortBySize` (children are hidden purely by overflow in DOM order) and
`rowCount` (the directive operates on a single row).

**Added:** the `data` option and typed `hiddenData`; `hiddenIndices` in the event detail;
`FitChildrenOptions` and `FitChildrenEventDetail` became generic (`<T = unknown>`).

**Internal:** overflow detection rewritten around a ghost DOM + `IntersectionObserver`; content
overflow accounted for via `scrollWidth`; fixed a post-unmount ghost DOM leak with a pending
`requestAnimationFrame`; fixed `gap` being ignored.

## [1.0.1]

*Reproduced from the README changelog; not independently re-verified.*

README subtitle shortened, directive registration guide added, an incomplete sentence in "Known
limitations" fixed.

## [1.0.0]

*Reproduced from the README changelog; not independently re-verified.*

Initial release: auto-hide, smart fit, `gap` support, `keepVisibleEl`, `data-v-fit-keep`,
`ResizeObserver` / `MutationObserver`, and rAF batching.
