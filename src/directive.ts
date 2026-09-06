/**
 * The directive itself: option resolution and the four renderer hooks. The
 * hooks ARE the scheduler integration — `mounted` because measurement is no
 * longer deferred to a frame, `updated` because the renderer queues it after
 * the patch and before paint.
 */
import { type Directive } from 'vue'
import { DEFAULT_OFFSET_PX, HIDDEN_ATTR, STATE_ATTR } from './constants'
import { ensureHideRule, showChild } from './dom'
import { childrenChanged, observe, siblingsChanged } from './observers'
import { recalculate } from './schedule'
import type { FitChildrenOptions, FitChildrenState } from './types'

const stateMap = new WeakMap<HTMLElement, FitChildrenState>()

// ── Directive lifecycle ──────────────────────────────────────────────

const readOptions = (
  state: FitChildrenState,
  value: FitChildrenOptions | undefined,
): boolean => {
  let changed = false

  if (value?.data !== state.data) {
    state.data = value?.data
    changed = true
  }
  if (value?.gap !== state.gapFromOption) {
    state.gapFromOption = value?.gap
    changed = true
  }
  const offset = Math.max(value?.offsetNeededInPx ?? DEFAULT_OFFSET_PX, 0)
  if (offset !== state.offsetNeededInPx) {
    state.offsetNeededInPx = offset
    changed = true
  }
  if (value?.keepVisibleEl !== state.keepVisibleEl) {
    state.keepVisibleEl = value?.keepVisibleEl
    changed = true
  }

  const container = value?.widthRestrictingContainer ?? state.targetElement
  if (container !== state.widthRestrictingContainer) {
    state.widthRestrictingContainer = container
    changed = true
  }

  return changed
}

export const vFitChildren: Directive<
  HTMLElement,
  FitChildrenOptions | undefined
> = {
  mounted(element, binding) {
    const state: FitChildrenState = {
      containerWidth: Number.POSITIVE_INFINITY,
      data: undefined,
      gapFromOption: undefined,
      hostWidth: 0,
      keepVisibleEl: undefined,
      lastAvailable: 0,
      metrics: [],
      mutationObserver: undefined,
      observedChildren: [],
      observedSiblings: [],
      parentWidth: 0,
      offsetNeededInPx: DEFAULT_OFFSET_PX,
      pass: false,
      appliedAvailable: 0,
      lastApplyMoved: false,
      lastDispatchedData: undefined,
      oversizedRuns: [],
      resizeObserver: undefined,
      targetElement: element,
      visible: new Set<HTMLElement>(),
      widthRestrictingContainer: element,
      // `data` is set through readOptions below, like every other option.
    }
    stateMap.set(element, state)

    ensureHideRule(element)
    readOptions(state, binding.value)

    // Children arriving from outside Vue — a third-party widget, a direct
    // appendChild. Vue-rendered ones come through `updated` instead.
    const mutationObserver = new MutationObserver(() => {
      if (!childrenChanged(state) && !siblingsChanged(state)) {
        return
      }
      observe(state)
      recalculate(state, true)
    })
    mutationObserver.observe(element, { childList: true })
    state.mutationObserver = mutationObserver

    observe(state)
    recalculate(state, true)
  },

  updated(element, binding) {
    const state = stateMap.get(element)
    if (!state) {
      return
    }

    const optionsChanged = readOptions(state, binding.value)
    const setChanged = childrenChanged(state) || siblingsChanged(state)

    // Re-observe on an option change too: `widthRestrictingContainer` is often a
    // template ref that is still undefined on the first render, so the element
    // we need to watch only arrives here.
    if (optionsChanged || setChanged) {
      state.oversizedRuns = []
      observe(state)
      recalculate(state, true)
    }
  },

  beforeUnmount(element) {
    const state = stateMap.get(element)
    if (!state) {
      return
    }

    state.targetElement = undefined
    state.resizeObserver?.disconnect()
    state.mutationObserver?.disconnect()

    element
      .querySelectorAll(`[${HIDDEN_ATTR}]`)
      .forEach((node) => showChild(node as HTMLElement))
    element.removeAttribute(STATE_ATTR)

    stateMap.delete(element)
  },
}

// No plugin export, and no registration name constant. Registering a directive
// is the application's decision, not this package's: `<script setup>` picks up
// `vFitChildren` by naming convention with no registration at all, and anyone
// who wants it global writes one `app.directive()` call under whatever name
// suits them. Owning that choice here only adds a surface to document.
export default vFitChildren
