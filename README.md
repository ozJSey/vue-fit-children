# @ozjsey/v-fit-children

A Vue 3 directive that hides the children which do not fit a container's width and emits the ones it
hid — for chips, badges, tags, or any inline row in a tight space.

[![npm](https://img.shields.io/npm/v/@ozjsey/v-fit-children.svg)](https://www.npmjs.com/package/@ozjsey/v-fit-children)
![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![dependencies 0](https://img.shields.io/badge/dependencies-0-blue.svg)

## The problem

A row of chips that has to fit is a measurement problem wearing a layout problem's clothes. You need
a `ResizeObserver` on the container — and on the host, its parent, every child *and every sibling*,
because a "+N" badge growing beside a shrink-to-fit row changes none of the first three. You need
what each child *wants*, not the width the row squeezed it into: a flex item with `flex-shrink: 1`
and `overflow: hidden` has an automatic minimum size of zero, so its box is your own answer echoed
back. And you need the count before the browser paints, or the user watches the row sit clipped.

## The solution

Put `v-fit-children` on the row. Children that do not fit get `data-v-fit-hidden`, the host gets
`data-v-fit-state="fits" | "overflowing"` for CSS-only styling, and a `fit-children-updated` event
carries what you lost: the count, the elements, their DOM indices, and — when you pass your `v-for`
array as `data` — the matching data objects, typed.

```vue
<div v-fit-children @fit-children-updated="onUpdate">
  <span v-for="tag in tags" :key="tag">{{ tag }}</span>
</div>
```

The real children are measured in place, so there are no clones and spacing is whatever the browser
actually laid out. Hiding is an attribute plus one injected rule, never `style.display`, so `v-show`
and `<Transition>` compose with it.

Two things to know on day one. **It assumes a single non-wrapping row**; a `flex-wrap: wrap` host is
not supported. And because hiding rides on an injected stylesheet, **a `style-src` CSP without
`'unsafe-inline'` blocks it silently** — no error, children simply overflow. Ship
`[data-v-fit-hidden] { display: none !important }` in your own CSS and the injection is a no-op.

## Install

```bash
npm install @ozjsey/v-fit-children
```

Requires **Vue 3.0 or newer**: the package imports one type (`Directive`) from Vue and nothing at
runtime, so its floor is the first version that had directives at all.

Register it per component — `import { vFitChildren } from '@ozjsey/v-fit-children'` in `<script setup>`, which Vue picks up because the name starts with `v` — or app-wide with `app.directive('fit-children', vFitChildren)`.

## Usage

### A row, and a "+N more" badge

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { vFitChildren, type FitChildrenEventDetail } from '@ozjsey/v-fit-children'

const tags = ref(['Vue', 'TypeScript', 'Vite', 'Vitest', 'Nuxt', 'Pinia'])
const hiddenCount = ref(0)

function onUpdate(e: CustomEvent<FitChildrenEventDetail>) {
  hiddenCount.value = e.detail.hiddenChildrenCount
}
</script>

<template>
  <div v-fit-children @fit-children-updated="onUpdate">
    <span v-for="tag in tags" :key="tag">{{ tag }}</span>
  </div>
  <span v-if="hiddenCount">+{{ hiddenCount }} more</span>
</template>
```

`offsetNeededInPx` reserves room for that badge and defaults to `50`, but only once the row genuinely
overflows — a badge you do not need never costs you width. Set it to `0` when the badge lives outside
the host. Read `hiddenChildrenCount`, not `isOverflowing`: a fully pinned row can be visibly clipped
with nothing hidden, where `v-if="isOverflowing"` renders `+0 more`.

### Map the hidden children back to your data

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { vFitChildren, type FitChildrenEventDetail } from '@ozjsey/v-fit-children'

interface Tag { id: number; label: string }

const tags = ref<Tag[]>([{ id: 1, label: 'Vue' }, { id: 2, label: 'React' }, { id: 3, label: 'Svelte' }])
const hiddenTags = ref<Tag[]>([])

function onUpdate(e: CustomEvent<FitChildrenEventDetail<Tag>>) {
  hiddenTags.value = e.detail.hiddenData ?? []
}
</script>

<template>
  <div v-fit-children="{ data: tags }" @fit-children-updated="onUpdate">
    <span v-for="tag in tags" :key="tag.id">{{ tag.label }}</span>
  </div>
  <select v-if="hiddenTags.length">
    <option v-for="tag in hiddenTags" :key="tag.id">{{ tag.label }}</option>
  </select>
</template>
```

`data` must map 1:1 with the host's immediate children — mark anything that is not one of your items
`data-v-fit-decorative`, and the directive warns once when the two disagree. Use `hiddenData` for your
items; `hiddenIndices` holds **DOM positions**, a different index space as soon as the row contains a
separator or a `v-show` child.

### Pin the children that must never disappear

```vue
<template>
  <div v-fit-children="{ data: tags }">
    <span v-for="tag in tags" :key="tag.id">{{ tag.label }}</span>
    <div data-v-fit-keep data-v-fit-decorative>
      <input placeholder="add a tag" />
    </div>
  </div>
</template>
```

`data-v-fit-keep` survives the cull; `data-v-fit-decorative` keeps that wrapper out of the `data`
mapping, and a pinned *control* needs both or the mapping skews for every item after it. If the
pinned children alone exceed the width they overflow rather than vanish — the honest failure for
something the user is typing in.

## Everything else

Every option, attribute and event field — `widthRestrictingContainer`, `gap`, `keepVisibleEl`,
`isOverflowing`, the dispatch contract, what happens to `v-show` children — is driven with a live
width slider on the **[v-fit-children playground tab](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children)**,
one card per feature, every card editable in place:
[chips with a +N badge](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/basic) ·
[data mapping](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/data-mapping) ·
[pinned children](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/keep-visible) ·
[inline badge](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/inline-badge) ·
[the state attribute](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/state-attribute) ·
[decorative children](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/decorative) ·
[the event contract](https://ozjsey.github.io/npm-portfolio-playground/#v-fit-children/event-contract)

[CHANGELOG.md](./CHANGELOG.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

## License

MIT
