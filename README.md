# v-fit-children

A Vue 3 directive that automatically hides child elements that don't fit within a container's width. Ideal for chips, badges, tags, or any inline elements in a tight space.

## Features

- Hides children that overflow the container width
- Emits an event with hidden children count (for "+N more" indicators)
- Responds to container resizes via `ResizeObserver`
- Detects child additions/removals via `MutationObserver`
- Batches recalculations with `requestAnimationFrame` for performance
- Always keeps the first child visible

## Install

```bash
npm install v-fit-children
```

Vue 3 is a peer dependency — it won't be bundled.

## Usage

Use the directive in your component:

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
      v-fit-children="{ widthRestrictingContainer: containerRef, offsetNeededInPx: 100 }"
      @fit-children-updated="onUpdate"
    >
      <span v-for="tag in tags" :key="tag">{{ tag }}</span>
    </div>
    <span v-if="hiddenCount">+{{ hiddenCount }} more</span>
  </div>
</template>
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `widthRestrictingContainer` | `HTMLElement` | — | The parent element whose width constrains the children |
| `offsetNeededInPx` | `number` | `50` | Reserved space in pixels (e.g. for a "+N more" indicator). Minimum `50` |

## Event

The directive emits a `fit-children-updated` custom event on the directive's element with the following detail:

```ts
type FitChildrenEventDetail = {
  hiddenChildrenCount: number;
  hiddenChildren: HTMLElement[];
  isOverflowing: boolean;
};
```

## How it works

1. On mount, the directive observes the container for resize and the element for child list mutations.
2. When triggered, it iterates through children left-to-right, accumulating widths.
3. Once the accumulated width plus `offsetNeededInPx` exceeds the container width, all remaining children are hidden via inline `display: none`.
4. A `fit-children-updated` event is dispatched so you can render a "+N more" indicator or similar UI.

## Known limitations

- `clientWidth` is used for measurement, which does not include margins. If your children have horizontal margins, account for that in `offsetNeededInPx`.

## License

MIT
