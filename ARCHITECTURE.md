# Architecture

`vFitChildren.ts` is the build entry; it re-exports `src/index.ts`. Each module has one purpose;
dependencies point strictly downward — no cycles.

```
vFitChildren.ts            entry — re-exports src/index
├── src/
│   ├── index.ts           public surface: vFitChildren + the three types
│   ├── directive.ts       option resolution and the three renderer hooks
│   ├── observers.ts       every TRIGGER: the host, the width-restricting container, the
│   │                      host's parent, every sibling, every child — plus a
│   │                      MutationObserver for DOM injected outside Vue. Reads no boxes.
│   ├── schedule.ts        when a pass runs, and the loop guard that keeps a "+N" badge
│   │                      labelled from the hidden set from cycling forever
│   ├── measure.ts         THE layout read: un-hide, then one rect pass over real children
│   ├── fit.ts             THE decision: numbers in, numbers out, no DOM
│   ├── visibility.ts      THE write: hide/show, the state attribute, the event
│   ├── dom.ts             hiding mechanism, and the three questions asked about a child
│   ├── constants.ts       attribute names, event name, defaults, EPSILON
│   └── types.ts           all types, public and internal
└── architecture.test.ts   the invariants below, asserted rather than described
```

Three invariants the layout encodes. **All three are enforced by `architecture.test.ts`**, which
reads the module sources and fails the suite on a violation — they were prose-only through 2.2.0,
and two of the three were being broken at the time.

- **`measure.ts` reads, `visibility.ts` writes, `fit.ts` does neither.** One measurement per pass,
  used by one decision, applied by one writer. A second, disagreeing measurement is the defect class
  that produced partially-visible children for the whole of 2.x — and it came back in 2.2.0 through
  `observers.ts`, which stored `ResizeObserver` content rects (taken with children hidden, and
  excluding a scrollbar `measure.ts`'s own arithmetic included) into the same
  `min(host, container)`. `getBoundingClientRect`, `getComputedStyle`, `scrollWidth`, `offsetWidth`
  and `clientWidth` now appear in `measure.ts` and nowhere else, and the test says so.

  The letter of it has two deliberate exceptions, both of which the test permits because neither
  reads layout: `measure.ts` un-hides every child before reading (a `display: none` child measures
  zero, and un-hiding in place is the whole of the alternative to a ghost element), and
  `visibility.ts` reads `host.children` and `child.style.display` to decide *what* to write.

- **Hiding never touches `el.style.display`.** `dom.ts` sets `data-v-fit-hidden` and injects one
  rule. `v-show`, Vue's style-prop patcher and `<Transition>` all read and write that property
  between them; a fourth writer means the last one wins, so a `v-show` child flipping to true
  silently un-hides a child that does not fit. Staying off it also makes "the consumer hid this" an
  exact test (`el.style.display === 'none'`) rather than a guess about who set the inline style —
  `isConsumerHidden` would invert the moment anything here wrote `display`, with no test or type to
  notice, which is why the check exists.

- **Every pass measures.** There is no cached pass and no `requestAnimationFrame`. 2.2.0 had both a
  "shrinking is free, no DOM is read at all" fast path and the `remeasure` state to police it; the
  fast path could only ever *confirm* the current run, never produce a different one, so the sole
  shrink it saved a read on was a shrink that changed nothing. Removing it also removed the second
  width lineage above. Measuring fresh, with every child shown first, reads the real budget instead
  of the previous decision echoing back: a host that sizes to its own children reports a narrower
  box the instant we hide something, and a cached pass had no way to tell that number from a real
  one.

  What the fresh measurement cannot settle is feedback through the *consumer's* render — a "+N"
  badge whose label comes from the hidden set widens a frame later, outside any single pass. That is
  what `schedule.ts`'s `oversizedRuns` record is for: runs that did not survive being chosen are
  remembered, against the width they were chosen at, and not re-entered.

  `observers.ts` therefore supplies no number to the decision. A `ResizeObserver` entry is read only
  to answer "did the geometry change since we last measured", and the host's parent is watched
  purely as a growth signal — its width includes any sibling badge, so it is never a budget.

Copy-paste consumers: every file under `src/` plus the entry is self-contained TypeScript with no
dependencies beyond the `vue` peer — take the folder as-is. `architecture.test.ts` comes with it and
needs only Vitest; it is what tells you if a later edit broke one of the three rules above.
