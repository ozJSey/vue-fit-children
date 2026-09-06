# v-fit-children

## Auto-hide overflowing children, emit the hidden ones for "+N more" badges

> **Note:** Watch the [usage example video](https://github.com/ozJSey/v-fit-children-resources/blob/main/Screen%20Recording%202026-02-08%20at%2019.09.25.mov) to see the directive in action (temporary link).

A Vue 3 directive that automatically hides child elements that don't fit within a container's width. Ideal for chips, badges, tags, or any inline elements in a tight space.

## Features

- Hides children that overflow the container width
- Emits a custom event with hidden children count, references, and optional data mapping (for "+N more" indicators)
- Supports `gap` / `column-gap` in parent container
- Accounts for margins, padding, and borders on both container and children
- Accounts for content overflow (`overflow: visible`) via `scrollWidth`
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

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren } from "@ozjsey/v-fit-children";

const containerRef = ref<HTMLElement>();
const hiddenCount = ref(0);

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

The directive element and the width-restricting container can be the same element or different elements. When they differ, the directive element's own margin, border, and padding are subtracted from the available space.

## Options

All options are passed as the directive value:

```vue
<div v-fit-children="{ widthRestrictingContainer: containerRef, offsetNeededInPx: 80 }">
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

The directive dispatches a `fit-children-updated` custom event on the directive's element whenever visibility is recalculated.

```vue
<div
  v-fit-children="{ widthRestrictingContainer: containerRef }"
  @fit-children-updated="onUpdate"
>
```

The event's `detail` contains:

| Property | Type | Description |
|---|---|---|
| `hiddenChildrenCount` | `number` | Number of children that were hidden |
| `hiddenChildren` | `HTMLElement[]` | Direct references to the hidden DOM elements |
| `hiddenIndices` | `number[]` | DOM indices of the hidden children |
| `hiddenData` | `unknown[]` | Data objects for hidden children (only present when `data` option is provided) |
| `isOverflowing` | `boolean` | `true` if any children were hidden, `false` if all fit |

When all children fit (including the offset), `isOverflowing` is `false` and no offset space is reserved — the "+N" badge is unnecessary.

## Keeping elements visible

You can prevent specific children from being hidden. This is useful for inputs, buttons, or any interactive element that should always remain accessible.

**Option A — via directive value (`keepVisibleEl`):**

Pass a ref to the element (or a descendant of a child) that should stay visible:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren } from "@ozjsey/v-fit-children";

const containerRef = ref<HTMLElement>();
const inputRef = ref<HTMLElement>();
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

Both methods can be used together. If a kept element is wider than the available space, it stays visible anyway — better to overflow than to hide an input the user is typing in.

## Data mapping

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

The `data` array must map 1:1 with the directive's immediate children. `hiddenIndices` is always provided regardless of the `data` option, so you can also map manually if needed.

## Inline "+N" badge

To keep the badge inline with the chips (instead of below), wrap both in a flex container and give the directive element `flex: 1`:

```vue
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

**Shrinking is free.** Every child consulted when the row narrows is currently visible, so its recorded width is live and no DOM is read at all. Growing re-measures, because a hidden child's recorded width is the last one taken while it was visible.

## Hiding, and why it is not `display: none`

Children are hidden with the `data-v-fit-hidden` attribute plus a single rule the package injects once per document (or shadow root):

```css
[data-v-fit-hidden] { display: none !important; }
```

`v-show`, Vue's style-prop patcher and `<Transition>` all read and write `el.style.display` between them. A fourth writer means the last one wins — a `v-show` child flipping to `true` would silently un-hide a child that does not fit. Staying off that property lets the two compose, and makes "the consumer hid this" an exact test rather than a guess about who set the inline style.

> **Strict CSP.** A `style-src` without `'unsafe-inline'` blocks the injected sheet, and hiding then stops working **silently** — no error, children simply overflow. Ship the rule above in your own CSS and the injection becomes a harmless no-op.

## Attributes

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
- **A "+N" badge whose *width* depends on what is hidden** makes the directive's output its own input. That is handled — runs which do not survive being chosen are remembered and not re-entered — but such a layout can settle below the theoretical maximum. Reserving constant space for the badge (`offsetNeededInPx`, or padding on the host) avoids the loop entirely.

## Browser support

Requires browsers that support `ResizeObserver`, `MutationObserver`, and `getBoundingClientRect`. All modern browsers (Chrome, Firefox, Safari, Edge) are supported.

## Changelog

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
