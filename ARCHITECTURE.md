# Architecture

`vFitChildren.ts` is the build entry; it re-exports `src/index.ts`. Each module has one purpose;
dependencies point strictly downward — no cycles.

```
vFitChildren.ts            entry — re-exports src/index
└── src/
    ├── index.ts           public surface: vFitChildren + the three types
    ├── directive.ts       option resolution and the four renderer hooks
    ├── observers.ts       every trigger: container / host / parent / child boxes, plus
    │                      a MutationObserver for DOM injected outside Vue
    ├── schedule.ts        when a pass runs, and whether it may re-measure
    ├── measure.ts         THE layout read: un-hide, then one rect pass over real children
    ├── fit.ts             THE decision: numbers in, numbers out, no DOM
    ├── visibility.ts      THE write: hide/show, the state attribute, the event
    ├── dom.ts             hiding mechanism, content widths, kept/consumer-hidden tests
    ├── constants.ts       attribute names, event name, defaults, EPSILON
    └── types.ts           all types, public and internal
```

Three invariants the layout encodes:

- **`measure.ts` reads, `visibility.ts` writes, `fit.ts` does neither.** One measurement per pass,
  used by one decision, applied by one writer. A second, disagreeing measurement is the defect class
  that produced partially-visible children for the whole of 2.x, and separating the three is what
  makes reintroducing it a visible change rather than an accident.

- **Hiding never touches `el.style.display`.** `dom.ts` sets `data-v-fit-hidden` and injects one
  rule. `v-show`, Vue's style-prop patcher and `<Transition>` all read and write that property
  between them; a fourth writer means the last one wins, so a `v-show` child flipping to true
  silently un-hides a child that does not fit. Staying off it also makes "the consumer hid this" an
  exact test (`el.style.display === 'none'`) rather than a guess about who set the inline style.

- **A cached pass may only confirm the current run, never change it.** `schedule.ts` re-measures
  before acting on anything that would alter the visible set. A host that sizes to its own children
  reports a new width the instant one is hidden, and that width is the previous decision echoing
  back — measured, acting on it walks 3 visible → 0 in five rounds. Growth has the mirror problem:
  such a host stops tracking the row once its content is narrower than the space available, so
  `observers.ts` watches the parent purely as a growth signal. Its width is never used as a budget —
  it includes any sibling badge — only as a reason to measure again.

Copy-paste consumers: every file under `src/` plus the entry is self-contained TypeScript with no
dependencies beyond the `vue` peer — take the folder as-is.
