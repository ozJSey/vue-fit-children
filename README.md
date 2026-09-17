# @ozjsey/v-fit-children

See in action: [npm portfolio playground](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children).

**Or go straight to the card** — drag the width slider on any of them:
[chips with a +N badge](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/basic) ·
[data mapping](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/data-mapping) ·
[pinned children](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/keep-visible) ·
[inline badge](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/inline-badge) ·
[the state attribute](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/state-attribute) ·
[the event contract](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/event-contract)

## Auto-hide overflowing children, emit the hidden ones for "+N more" badges

> **Note:** Watch the [usage example video](https://github.com/ozJSey/v-fit-children-resources/blob/main/Screen%20Recording%202026-02-08%20at%2019.09.25.mov) to see the directive in action (temporary link).

A Vue 3 directive that automatically hides child elements that don't fit within a container's width. Ideal for chips, badges, tags, or any inline elements in a tight space.

## Features

- Hides children that overflow the container width
- Emits a custom event with hidden children count, references, and optional data mapping (for "+N more" indicators)
- Supports `gap` / `column-gap` in parent container
- Accounts for margins, padding, and borders on both container and children
- Measures what a child *wants*, not what the row squeezed it into — a flex item with `flex-shrink: 1` and `overflow: hidden` has an automatic minimum size of zero, so its box is our own answer echoed back; `scrollWidth` is read instead
- Pin specific children so they are never hidden (`keepVisibleEl` or `data-v-fit-keep`)
- Pass your `v-for` array via `data` to receive typed `hiddenData` and `hiddenIndices`
- Measures the real children in place — no clones, so margins, gaps and inherited styles are whatever the browser actually laid out
- Watches the container, the host, its parent, every child **and every sibling** — a "+N" badge growing beside the row changes none of the first four
- Reflects state as `data-v-fit-state="fits" | "overflowing"` for CSS-only styling
- Composes with `v-show` and `<Transition>`: hiding never touches `style.display`
- Runs before paint — no `requestAnimationFrame`, so there is no frame where the previous state shows clipped
- Written in TypeScript — ships with full type declarations

## Install

```bash
npm install @ozjsey/v-fit-children
```

Vue 3 is a peer dependency — it won't be bundled.

## Register the directive

**Local (per-component) — recommended:**

Import the directive in any `<script setup>` component. Vue auto-registers it because the variable name starts with `v`:

```vue
<script setup lang="ts">
import { vFitChildren } from "@ozjsey/v-fit-children";
</script>
```

**Global (app-wide):**

Register once in your entry file so every component can use `v-fit-children` without importing:

```ts
import { createApp } from "vue";
import { vFitChildren } from "@ozjsey/v-fit-children";
import App from "./App.vue";

const app = createApp(App);
app.directive("fit-children", vFitChildren);
app.mount("#app");
```

## Quick start

> [Chips with a +N more badge](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/basic) is this snippet with a width slider on it.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren } from "@ozjsey/v-fit-children";

const containerRef = ref<HTMLElement>();
const hiddenCount = ref(0);
const tags = ref(["Vue", "TypeScript", "Vite", "Vitest", "Nuxt", "Pinia"]);

function onUpdate(e: CustomEvent) {
  hiddenCount.value = e.detail.hiddenChildrenCount;
}
</script>

<template>
  <div ref="containerRef">
    <div
      v-fit-children="{ 
        widthRestrictingContainer: containerRef, // Optional: defaults to this element
        offsetNeededInPx: 50, // Optional: defaults to 50
      }"
      @fit-children-updated="onUpdate"
    >
      <span v-for="tag in tags" :key="tag">{{ tag }}</span>
    </div>
    <span v-if="hiddenCount">+{{ hiddenCount }} more</span>
  </div>
</template>
```

The directive element and the width-restricting container can be the same element or different elements. When they differ, the available width is `min(host content width, container content width)` — nothing is subtracted from either, and both are content widths, so each one's own border, padding and scrollbar is already out of it.

Naming an ancestor therefore only changes the answer when the **host** can measure wider than the space it is really given — a `white-space: nowrap` inline-block, say. A host that is a flex item, `width: 100%` or block-level is already bounded by its parent, and there the option is a declaration of intent rather than the thing doing the work.

## Options

All options are passed as the directive value:

```vue
<div v-fit-children="{ widthRestrictingContainer: containerRef, offsetNeededInPx: 80 }">…</div>
```

| Option | Type | Default | Description |
|---|---|---|---|
| `widthRestrictingContainer` | `HTMLElement` | Directive Element | The element whose width constrains the children. Defaults to the element the directive is on. |
| `offsetNeededInPx` | `number` | `50` | Reserved space in px (e.g. for a "+N more" badge). Set to `0` if you don't need reserved space. |
| `gap` | `number` | Computed `gap` | Manually specify the gap between items in pixels. Useful if `gap` CSS is not used (e.g. inline-block margins). |
| `data` | `unknown[]` | — | The same array used in `v-for`. When provided, the event includes `hiddenData` with the corresponding data objects for hidden children. |
| `keepVisibleEl` | `HTMLElement` | — | An element (or descendant of a child) that should never be hidden. Useful for inputs or interactive elements. |

Options are reactive — changing them via the directive value triggers a recalculation.

## TypeScript

The package ships with full type declarations. Exported types:

```ts
import { vFitChildren } from "@ozjsey/v-fit-children";
import type { FitChildrenOptions, FitChildrenEventDetail } from "@ozjsey/v-fit-children";
```

### `FitChildrenOptions`

```ts
interface FitChildrenOptions<T = unknown> {
  data?: T[];
  gap?: number;
  keepVisibleEl?: HTMLElement;
  offsetNeededInPx?: number;
  widthRestrictingContainer?: HTMLElement;
}
```

### `FitChildrenEventDetail`

```ts
type FitChildrenEventDetail<T = unknown> = {
  hiddenChildren: HTMLElement[];
  hiddenChildrenCount: number;
  hiddenData?: T[];
  hiddenIndices: number[];
  isOverflowing: boolean;
};
```

### Typing the event handler

Vue's `@fit-children-updated` handler receives a `CustomEvent`. You can type it like this:

```ts
interface Tag {
  id: number;
  label: string;
}

function onUpdate(e: CustomEvent<FitChildrenEventDetail<Tag>>) {
  console.log(e.detail.hiddenChildrenCount);
  console.log(e.detail.hiddenChildren);   // HTMLElement[]
  console.log(e.detail.hiddenIndices);    // number[]
  console.log(e.detail.hiddenData);       // Tag[] | undefined
  console.log(e.detail.isOverflowing);    // boolean
}
```

## Event

> [The event reports what is true now](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/event-contract) — starting at a width where nothing fits, so the first pass has to dispatch too — and [isOverflowing on a row that cannot hide anything](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/pinned-overflow).

The directive dispatches a `fit-children-updated` custom event on the directive's element whenever visibility is recalculated.

```vue
<div
  v-fit-children="{ widthRestrictingContainer: containerRef }"
  @fit-children-updated="onUpdate"
>…</div>
```

The event's `detail` contains:

| Property | Type | Description |
|---|---|---|
| `hiddenChildrenCount` | `number` | Number of children that were hidden |
| `hiddenChildren` | `HTMLElement[]` | Direct references to the hidden DOM elements |
| `hiddenIndices` | `number[]` | DOM indices of the hidden children |
| `hiddenData` | `unknown[]` | Data objects for hidden children (only present when `data` option is provided) |
| `isOverflowing` | `boolean` | `true` when the content is wider than the space available — whether or not anything could be *done* about it. A row of entirely pinned children that is visibly clipped reports `true` with `hiddenChildrenCount: 0` |

`isOverflowing` is `false` exactly when the whole row fits in the available width **without** the offset. That is the "smart fit" branch: a badge you do not need should not cost you width, so when everything fits, `offsetNeededInPx` is not reserved at all. Only once the row genuinely overflows does the budget become `available − offsetNeededInPx`.

Do not derive "is anything hidden" from it — read `hiddenChildrenCount`. `v-if="isOverflowing"` on a "+N more" badge renders `+0 more` on a clipped, fully-pinned row.

**The event fires whenever the payload changes, and only then.** Every field is compared against the
one last dispatched, so an in-place `items.push()` / `pop()` that changes only the *hidden* set is
reported, a first pass is always reported — including the pass that hides every child — and a
recalculation that changes nothing a listener could see stays silent. That last part is not
optional: hiding a child is itself a resize, so a listener rendering a badge from the payload would
otherwise loop forever.

## Keeping elements visible

> [Pinned children](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/keep-visible) — `keepVisibleEl` and `data-v-fit-keep` surviving the cull, and [v-show children are left alone](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/v-show) for the child you hid yourself.

You can prevent specific children from being hidden. This is useful for inputs, buttons, or any interactive element that should always remain accessible.

**Option A — via directive value (`keepVisibleEl`):**

Pass a ref to the element (or a descendant of a child) that should stay visible:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren } from "@ozjsey/v-fit-children";

const containerRef = ref<HTMLElement>();
const inputRef = ref<HTMLElement>();
const tags = ref(["Vue", "TypeScript", "Vite", "Vitest"]);
</script>

<template>
  <div ref="containerRef">
    <div v-fit-children="{ widthRestrictingContainer: containerRef, keepVisibleEl: inputRef }">
      <span v-for="tag in tags" :key="tag">{{ tag }}</span>
      <div class="input-wrapper">
        <input ref="inputRef" />
      </div>
    </div>
  </div>
</template>
```

The directive walks up from `keepVisibleEl` to find the matching immediate child. So if `inputRef` points to a nested `<input>`, the parent child that contains it stays visible.

**Option B — via data attribute (`data-v-fit-keep`):**

Add the `data-v-fit-keep` attribute directly on the child element — no ref needed:

```vue
<div v-fit-children="{ widthRestrictingContainer: containerRef }">
  <span v-for="tag in tags" :key="tag">{{ tag }}</span>
  <div data-v-fit-keep>
    <input />
  </div>
</div>
```

Both methods can be used together, and they are interchangeable: pinning a child by either mechanism produces exactly the same `hiddenData`. If a kept element is wider than the available space, it stays visible anyway — better to overflow than to hide an input the user is typing in.

**Pinning is about visibility; `data` membership is about your array.** They are unrelated. A pinned child is still one of your `data` items unless you also mark it `data-v-fit-decorative` — so a pinned *control* (a token input, a "clear" button) that is not one of your items needs both attributes, or the mapping skews for every item after it. The directive warns once in the console when `data.length` and the number of mapped children disagree.

## Data mapping

> [data → hiddenData + hiddenIndices](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/data-mapping), and [decorative separators outside the mapping](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/decorative) for the children that must not consume a data index.

Pass your `v-for` array via the `data` option to receive the corresponding data objects for hidden children in the event:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren, type FitChildrenEventDetail } from "@ozjsey/v-fit-children";

interface Tag {
  id: number;
  label: string;
  color: string;
}

const tags = ref<Tag[]>([
  { id: 1, label: "Vue", color: "green" },
  { id: 2, label: "React", color: "blue" },
  { id: 3, label: "Angular", color: "red" },
  { id: 4, label: "Svelte", color: "orange" },
]);
const hiddenTags = ref<Tag[]>([]);

function onUpdate(e: CustomEvent<FitChildrenEventDetail<Tag>>) {
  hiddenTags.value = e.detail.hiddenData ?? [];
}
</script>

<template>
  <div
    v-fit-children="{ data: tags, offsetNeededInPx: 50 }"
    @fit-children-updated="onUpdate"
  >
    <span v-for="tag in tags" :key="tag.id">{{ tag.label }}</span>
  </div>
  <select v-if="hiddenTags.length">
    <option v-for="tag in hiddenTags" :key="tag.id">{{ tag.label }}</option>
  </select>
</template>
```

The `data` array must map 1:1 with the directive's immediate children that are not marked `data-v-fit-decorative`.

`hiddenIndices` is always provided regardless of the `data` option, but it holds **DOM child positions** — it counts decorative children and `v-show`-hidden children, which `hiddenData` skips. The two index spaces coincide only in a row that is a straight `v-for` with nothing else in it. `myArray[hiddenIndices[0]]` names the wrong item the moment you add a separator; use `hiddenData` for that, and `hiddenIndices` for reaching back into the DOM.

## Inline "+N" badge

> [Inline badge with offsetNeededInPx: 0](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/inline-badge).

To keep the badge inline with the chips (instead of below), wrap both in a flex container and give the directive element `flex: 1`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren, type FitChildrenEventDetail } from "@ozjsey/v-fit-children";

const containerRef = ref<HTMLElement>();
const hiddenCount = ref(0);
const tags = ref(["bug", "help wanted", "good first issue", "documentation"]);

function onUpdate(e: CustomEvent<FitChildrenEventDetail>) {
  hiddenCount.value = e.detail.hiddenChildrenCount;
}
</script>

<template>
  <div ref="containerRef" style="display: flex; align-items: center; gap: 8px;">
    <div
      style="flex: 1; overflow: hidden;"
      v-fit-children="{ widthRestrictingContainer: containerRef, offsetNeededInPx: 0 }"
      @fit-children-updated="onUpdate"
    >
      <span v-for="tag in tags" :key="tag">{{ tag }}</span>
    </div>
    <span v-if="hiddenCount">+{{ hiddenCount }}</span>
  </div>
</template>
```

Set `offsetNeededInPx: 0` since the badge lives outside the directive element.

## How it works

Three steps per pass — measure, decide, apply — with the measurement and the write kept strictly apart so a second, disagreeing measurement cannot creep in.

1. **Measure.** Every child the directive hid is shown again first: a `display: none` child measures zero, and re-measuring it in place is the whole reason no ghost element is needed. One `getBoundingClientRect` loop then records each child's width, the space in front of it, and its trailing margin. Spacing is *measured* rather than computed, so CSS `gap`, margins and inline whitespace all arrive as one number that is true by construction.
2. **Decide.** Pure arithmetic, no DOM. If the total fits, everything stays and no offset is reserved — a badge you do not need should not cost you width. Otherwise the budget is `available − offsetNeededInPx`, pinned children are reserved up front, and the remaining children are admitted in DOM order until one does not fit.
3. **Apply.** Hidden children get `data-v-fit-hidden`, the host gets `data-v-fit-state`, and `fit-children-updated` fires — but only when the outcome actually changed, since hiding a child is itself a resize.

Available width is `min(host, container)`. The host's own width is safe to read because nothing here ever writes it.

**What triggers a pass:** one `ResizeObserver` covering the container, the host, its parent, every child and every sibling; Vue's own `updated` hook for children it rendered; and a `MutationObserver` for DOM injected outside Vue. There is no `requestAnimationFrame` — observer callbacks and `updated` both already run after layout and before paint, which is what removes the frame of clipped content.

**Every pass measures.** 2.2.0 had a cached "shrinking is free, no DOM is read at all" path; 2.3.0 removed it. It was not an optimisation — a cached pass was only ever allowed to *confirm* the run it was given, so the only shrink it saved a read on was a shrink that changed nothing, while every shrink that dropped a chip ran the decision twice. Keeping it also meant a second source of widths (`ResizeObserver` content rects, taken with children hidden) feeding the same decision as `getBoundingClientRect`, which is the defect class `ARCHITECTURE.md`'s first invariant exists to forbid.

## Hiding, and why it is not `display: none`

Children are hidden with the `data-v-fit-hidden` attribute plus a single rule the package injects once per document (or shadow root):

```css
[data-v-fit-hidden] { display: none !important; }
```

`v-show`, Vue's style-prop patcher and `<Transition>` all read and write `el.style.display` between them. A fourth writer means the last one wins — a `v-show` child flipping to `true` would silently un-hide a child that does not fit. Staying off that property lets the two compose, and makes "the consumer hid this" an exact test rather than a guess about who set the inline style.

> **Strict CSP.** A `style-src` without `'unsafe-inline'` blocks the injected sheet, and hiding then stops working **silently** — no error, children simply overflow. Ship the rule above in your own CSS and the injection becomes a harmless no-op.

## Attributes

> [CSS-only styling via data-v-fit-state](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/state-attribute) — style the overflow state without an event handler.

| Attribute | On | Meaning |
|---|---|---|
| `data-v-fit-state` | the host | `"fits"` or `"overflowing"` — style overflow with CSS alone, no event handler |
| `data-v-fit-hidden` | a child | Set by the directive on children it hid. Do not set it yourself |
| `data-v-fit-keep` | a child | Never hide this child, wherever it sits |
| `data-v-fit-decorative` | a child | Hide it like any other, but consume no `data` index — for separators |

## Known limitations

- **Single row.** The directive assumes one non-wrapping row. A `flex-wrap: wrap` host is not supported.
- **The host must not be sized by the children it is measuring.** `flex: 1`, `width: 100%` or block-level all work, and so does shrink-to-fit. What cannot work is a *container* whose own width depends on the host's.
- **A consumer-hidden child is detected by inline `display: none`** (what `v-show` sets). Hiding a child with a CSS class instead is not detected.
- **`keepVisibleEl` accepts a single element.** Use `data-v-fit-keep` for multiple. Pinned children are never hidden, so if they alone exceed the width they overflow rather than vanish — the honest failure for something the user is interacting with.
- **SSR.** No markup is added, so hydration cannot mismatch, but the server sends every child visible and the first client paint shows them all until `mounted` runs.
- **A "+N" badge whose *width* depends on what is hidden** makes the directive's output its own input. That is handled — runs which do not survive being chosen are remembered and not re-entered — but such a layout can settle below the theoretical maximum. Reserving constant space for the badge (`offsetNeededInPx`, or padding on the host) avoids the loop entirely. The memory is retracted the moment the world moves the row: any genuine change to the width-restricting container, the host's parent or a sibling clears it, and so does the host reporting more room than the last measurement gave it with nothing else resizing beside it — a sidebar closing or a splitter dragged back is not the loop, and 2.3.0 froze the row because the host path made no such distinction.

## Browser support

Requires browsers that support `ResizeObserver`, `MutationObserver`, and `getBoundingClientRect`. All modern browsers (Chrome, Firefox, Safari, Edge) are supported.

## Changelog

Full history, with the evidence behind each entry, is in [`CHANGELOG.md`](./CHANGELOG.md).

### 2.3.0 — 2026-09-14

**The row it computes was never the problem; what it *told* you about the row was.** An independent
audit drove the published 2.2.0 through 2,193 measurements and found zero half-clipped children.
Everything below is a defect in the reporting around that engine, and three of them are reasons a
"+N more" badge showed the wrong number — or no number at all.

**Fixed — the event:**

- **No event fired when the first pass hid *every* child.** The visible set starts empty; an empty
  first fit looked like "no change", so the dispatch was skipped. `data-v-fit-state` was correct the
  whole time, which is why CSS-only styling kept working and **every event-driven consumer silently
  did not**: an over-full row rendered with no badge at exactly the widths where the badge is the
  only thing the user can act on — a phone. Driven at mount, after a `v-if` remount, and after a
  resize that keeps the run empty.
- **The dispatch gate watched the visible set plus the `data` array's reference identity, while
  every field of the payload is about the *hidden* set.** `items.push()` / `pop()` / `splice()` —
  the dominant Vue idiom — moves neither term, so the badge and the dropdown behind it went on
  naming rows the user had already deleted. Measured: six chips in 300px, three hidden ones popped
  off; reality 0 hidden, last event still `hiddenChildrenCount: 3` with three detached elements in
  `hiddenChildren`, while `data-v-fit-state` on the same host correctly read `fits`. The gate now
  compares the payload itself against the one last dispatched.
- **`isOverflowing` went stale on the resize path.** The attribute write sat above the early return
  and the dispatch below it, so on a row where the visible set cannot move — every child pinned —
  the attribute flipped `fits` ↔ `overflowing` correctly at every width and the event reported
  `false` forever. 2.2.0 listed this as fixed and had a test for it; the test only covered the
  *mount* pass, where the dispatch happens whatever the gate says.

**Fixed — the payload:**

- **The two documented ways to pin a child disagreed about `data`.** `data-v-fit-keep` consumed a
  data index and `keepVisibleEl` did not, so the same row produced different `hiddenData` depending
  on how you pinned it — and the shorter array was silently truncated rather than erroring.
  Membership is now declared by `data-v-fit-decorative` alone; pinning never affects it. **If you
  used `keepVisibleEl` on a child that is one of your `data` items, `hiddenData` changes** — it was
  skewed by one before.
- **`data` not mapping 1:1 with the children now warns once**, instead of quietly handing back a
  short array.
- **A decorative separator could be left dangling at the end of the row** (`Ada · Grace · Alan ·`),
  including in the canonical demo for the feature.

**Fixed — measurement:**

- **A flex child that can shrink was measured at the width the row had already given it.** With the
  default `flex-shrink: 1` and any `overflow` other than `visible` — `text-overflow: ellipsis`, the
  most common chip CSS there is — a flex item's automatic minimum size is zero, so its box is our
  own answer echoed back and `total <= available` is true by construction. The directive concluded
  "fits" while every chip sat ellipsised to a few pixels. Such a child is now measured by its
  `scrollWidth`.
- **A classic scrollbar was counted as available width**, making the budget ~15px too generous on
  Windows and Linux and admitting one child too many, which then rendered clipped. Zero on macOS
  overlay scrollbars, which is why it shipped.
- **The measuring cursor advanced by a spilling child's content extent rather than its box**, which
  clamped the gap in front of the next child to zero and billed an n-child row for fewer than n−1
  gaps.

**Internal:**

- **The cached "shrinking is free, no DOM is read at all" pass is gone.** It was advertised in four
  places and was never an optimisation: a cached pass was only allowed to *confirm* the current run,
  so the only shrink it saved a read on was one that changed nothing. It also required
  `ResizeObserver` content rects — a second width lineage, taken with children hidden — to feed the
  same decision as `getBoundingClientRect`. Observers are now signals only.
- **`architecture.test.ts`** fails the suite if a layout API appears outside `measure.ts`, if
  anything writes `style.display`, or if the module graph grows a cycle. Every invariant
  `ARCHITECTURE.md` claims was previously enforced by prose alone.
- Two playground cards for the event contract, and the tab's first browser spec
  (`playground/scripts/interactions/v-fit-children.mjs`).

### 2.2.0

**First release under the `@ozjsey` scope.** Install `@ozjsey/v-fit-children`; the directive, the
exports and the attributes are unchanged. The unscoped `v-fit-children` package stops here.

> **Not a drop-in upgrade from `v-fit-children@2.1.0`.** The version line is continuous, but the
> hide mechanism changed and the package now injects a stylesheet. Read the two bullets below before
> upgrading.

**Breaking in practice (though the API is unchanged):**

- **Hiding moved from inline `display: none !important` to `data-v-fit-hidden` + an injected rule.**
  Any CSS or transition keyed on the inline style needs updating, and a strict `style-src` CSP now
  disables hiding silently — see "Hiding, and why it is not `display: none`".
- **`gap` is a floor over measured spacing, not a replacement.** Spacing is measured from the real
  layout, so margins are already counted; the option can now only reserve *more* room, never less.

**Fixed:**

- Children that were hidden could no longer be measured, so the running total collapsed and the
  "everything fits" branch handed the row its full width — admitting more children than fit.
- The directive fought `v-show`: it cleared any inline `display: none` it found, including one it
  had not set.
- A sibling resizing was invisible. A "+N" badge growing beside a shrink-to-fit host changes neither
  the host's box nor the parent's, so nothing fired and the row kept a stale answer.
- A shrink-to-fit host could collapse to zero children, its post-hide width feeding back as the next
  budget.
- A badge labelled from the hidden set could cycle forever between runs, showing clipped content on
  alternate frames.
- `gap` charged a leading gap to the first child, billing an n-child row for n gaps instead of n−1.
- `isOverflowing` reported `fits` for a row of entirely pinned children that was visibly clipped.
- Swapping the `data` array with an unchanged fit left `hiddenData` stale.
- A negative available width produced an invalid declaration that disabled hiding entirely.

**Added:**

- `data-v-fit-state="fits" | "overflowing"` on the host, for CSS-only styling.
- Per-child and per-sibling `ResizeObserver` coverage.
- `FitChildrenFitState` exported type.

**Internal:** the ghost element, its clones, the `IntersectionObserver` and the
`requestAnimationFrame` batching are all gone; the source is split into single-purpose modules under
`src/` (see `ARCHITECTURE.md`).

### 2.0.0

**Breaking changes:**

- Removed `sortBySize` option — children are now hidden purely by overflow in DOM order
- Removed `rowCount` option — the directive operates on a single row

**New features:**

- Added `data` option to pass your `v-for` array and receive typed `hiddenData` in the event
- Added `hiddenIndices` to the event detail — always contains DOM indices of hidden children
- `FitChildrenOptions` and `FitChildrenEventDetail` are now generic (`<T = unknown>`)

**Internal:**

- Rewrote overflow detection to use a ghost DOM + `IntersectionObserver` instead of manual width calculation
- Accounts for content overflow (`overflow: visible`) via `scrollWidth`
- Fixed post-unmount ghost DOM leak when a `requestAnimationFrame` callback was pending
- Fixed `gap` option being ignored (now correctly applied to the ghost element)

### 1.0.1

- Shortened README subtitle
- Added directive registration guide (local and global)
- Fixed incomplete sentence in known limitations

### 1.0.0

- Initial release with core features: auto-hide, smart fit, gap support, `keepVisibleEl`, `data-v-fit-keep`, ResizeObserver/MutationObserver, and RAF batching

## License

MIT
