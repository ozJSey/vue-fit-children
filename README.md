# v-fit-children

## Auto-hide overflowing children, emit the hidden ones for "+N more" badges

> **Note:** Watch the [usage example video](https://github.com/ozJSey/v-fit-children-resources/blob/main/Screen%20Recording%202026-02-08%20at%2019.09.25.mov) to see the directive in action (temporary link).

A Vue 3 directive that automatically hides child elements that don't fit within a container's width. Ideal for chips, badges, tags, or any inline elements in a tight space.

## Features

- Hides children that overflow the container width
- Emits a custom event with hidden children count and references (for "+N more" indicators)
- Supports `gap` / `column-gap` in parent container
- Accounts for margins, padding, and borders on both container and children
- Option to hide largest items first (`sortBySize`) to maximize visible count
- Pin specific children so they are never hidden (`keepVisibleEl` or `data-v-fit-keep`)
- Multi-row support via `rowCount`
- Responds to container resizes via `ResizeObserver`
- Monitors individual child size changes via `ResizeObserver`
- Detects child additions/removals via `MutationObserver`
- Caches child widths — only re-measures when children change
- Batches recalculations with `requestAnimationFrame` for performance
- Written in TypeScript — ships with full type declarations

## Install

```bash
npm install v-fit-children
```

Vue 3 is a peer dependency — it won't be bundled.

## Register the directive

**Local (per-component) — recommended:**

Import the directive in any `<script setup>` component. Vue auto-registers it because the variable name starts with `v`:

```vue
<script setup lang="ts">
import { vFitChildren } from "v-fit-children";
</script>
```

**Global (app-wide):**

Register once in your entry file so every component can use `v-fit-children` without importing:

```ts
import { createApp } from "vue";
import { vFitChildren } from "v-fit-children";
import App from "./App.vue";

const app = createApp(App);
app.directive("fit-children", vFitChildren);
app.mount("#app");
```

## Quick start

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren } from "v-fit-children";

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
| `sortBySize` | `boolean` | `false` | If `true`, hides larger items first to maximize the number of visible items. If `false`, hides items from the end. |
| `keepVisibleEl` | `HTMLElement` | — | An element (or descendant of a child) that should never be hidden. Useful for inputs or interactive elements. |
| `rowCount` | `number` | `1` | Number of rows to fill before hiding. Offset is only reserved on the last row. If >1, sets `flex-wrap: wrap`. |

Options are reactive — changing them via the directive value triggers a recalculation.

## TypeScript

The package ships with full type declarations. Exported types:

```ts
import { vFitChildren } from "v-fit-children";
import type { FitChildrenOptions, FitChildrenEventDetail } from "v-fit-children";
```

### `FitChildrenOptions`

```ts
interface FitChildrenOptions {
  gap?: number;
  keepVisibleEl?: HTMLElement;
  offsetNeededInPx?: number;
  rowCount?: number;
  sortBySize?: boolean;
  widthRestrictingContainer?: HTMLElement;
}
```

### `FitChildrenEventDetail`

```ts
type FitChildrenEventDetail = {
  hiddenChildren: HTMLElement[];
  hiddenChildrenCount: number;
  isOverflowing: boolean;
};
```

### Typing the event handler

Vue's `@fit-children-updated` handler receives a `CustomEvent`. You can type it like this:

```ts
function onUpdate(e: CustomEvent<FitChildrenEventDetail>) {
  console.log(e.detail.hiddenChildrenCount);
  console.log(e.detail.hiddenChildren);   // HTMLElement[]
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
| `isOverflowing` | `boolean` | `true` if any children were hidden, `false` if all fit |

When all children fit (including the offset), `isOverflowing` is `false` and no offset space is reserved — the "+N" badge is unnecessary.

## Keeping elements visible

You can prevent specific children from being hidden. This is useful for inputs, buttons, or any interactive element that should always remain accessible.

**Option A — via directive value (`keepVisibleEl`):**

Pass a ref to the element (or a descendant of a child) that should stay visible:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { vFitChildren } from "v-fit-children";

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

## Sorting by size

By default, children are hidden from the end (last child first). Enable `sortBySize` to hide the largest children first, maximizing the number of visible items:

```vue
<div v-fit-children="{ widthRestrictingContainer: containerRef, sortBySize: true }">
  <span style="width: 200px">Wide tag</span>
  <span style="width: 60px">Small</span>
  <span style="width: 60px">Small</span>
</div>
```

With `sortBySize: true`, the "Wide tag" is hidden first, leaving both small tags visible.

## Multi-row layout

Use `rowCount` to allow children to fill multiple rows before hiding:

```vue
<div
  v-fit-children="{ widthRestrictingContainer: containerRef, rowCount: 2 }"
  style="flex-wrap: wrap; gap: 8px;"
>
  <span v-for="tag in manyTags" :key="tag">{{ tag }}</span>
</div>
```

The offset (`offsetNeededInPx`) is only reserved on the **last** row. All preceding rows use the full container width.

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

1. On mount, the directive observes the `widthRestrictingContainer` for resize and the directive element for child list mutations.
2. Individual children are also observed for size changes (e.g. an input growing as the user types).
3. When triggered, it measures child widths via `getBoundingClientRect` (accounting for margins and `gap`). Measurements are cached and only re-computed when children are added, removed, or resized.
4. If all children fit without needing the offset, everything stays visible — no "+N" badge is needed.
5. Otherwise, candidates are sorted by priority (`keepVisibleEl` / `data-v-fit-keep` first), then by size (if `sortBySize`), then by DOM order.
6. Children are placed row by row (up to `rowCount`). Offset is only reserved on the last row.
7. A `fit-children-updated` event is dispatched so you can render a "+N more" indicator.
8. Recalculations are batched via `requestAnimationFrame` + Vue's `nextTick` to avoid layout thrashing.

## Known limitations

- The directive hides children using `display: none !important`. If a child has critical `display` styles set inline, they will be overridden while hidden.
- `keepVisibleEl` accepts a single element. To pin multiple children, use `data-v-fit-keep` on each. Kept elements are never hidden, so if multiple pinned children exceed the container width, they will overflow.

## Browser support

Requires browsers that support `ResizeObserver`, `MutationObserver`, and `getBoundingClientRect`. All modern browsers (Chrome, Firefox, Safari, Edge) are supported.

## Changelog

### 1.0.1

- Shortened README subtitle
- Added directive registration guide (local and global)
- Fixed incomplete sentence in known limitations

### 1.0.0

- Initial release with all core features: auto-hide, smart fit, gap support, `sortBySize`, `keepVisibleEl`, `data-v-fit-keep`, multi-row (`rowCount`), ResizeObserver/MutationObserver, width caching, and RAF batching

## License

MIT
