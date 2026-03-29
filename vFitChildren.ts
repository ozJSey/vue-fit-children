import { type Directive } from 'vue';

export type FitChildrenOptions<T = unknown> = {
  data?: T[]
  gap?: number
  keepVisibleEl?: HTMLElement
  offsetNeededInPx?: number
  widthRestrictingContainer?: HTMLElement
}

export type FitChildrenEventDetail<T = unknown> = {
  hiddenChildren: HTMLElement[]
  hiddenChildrenCount: number
  hiddenData?: T[]
  hiddenIndices: number[]
  isOverflowing: boolean
}

type FitChildrenState<T = unknown> = {
  data: T[] | undefined
  gapFromOption: number | undefined
  ghostElement: HTMLElement | undefined
  ghostObservableChildren: HTMLElement[]
  intersectionObserver: IntersectionObserver | undefined
  keepVisibleEl: HTMLElement | undefined
  keepVisibleResizeObserver: ResizeObserver | undefined
  mutationObserver: MutationObserver | undefined
  offsetNeededInPx: number
  pendingCalc: boolean
  realIndexToGhostChild: Map<number, HTMLElement>
  resizeObserver: ResizeObserver | undefined
  targetElement: HTMLElement | undefined
  visibilityMap: WeakMap<Element, boolean>
  widthRestrictingContainer: HTMLElement | undefined
}

const DEFAULT_OFFSET_PX = 50
const HIDDEN_ATTR = 'data-v-fit-hidden'
const KEEP_ATTR = 'data-v-fit-keep'
const EVENT_NAME = 'fit-children-updated'
const stateMap = new WeakMap<HTMLElement, FitChildrenState>()

// ── Helpers ──────────────────────────────────────────────────────────

const parsePx = (value: string): number => parseFloat(value) || 0

const getContentWidth = (
  element: HTMLElement,
  style = window.getComputedStyle(element),
): number =>
  element.getBoundingClientRect().width -
  parsePx(style.borderLeftWidth) -
  parsePx(style.borderRightWidth) -
  parsePx(style.paddingLeft) -
  parsePx(style.paddingRight)

const isKeptChild = (
  child: HTMLElement,
  keepVisibleEl: HTMLElement | undefined,
): boolean =>
  child.hasAttribute(KEEP_ATTR) ||
  (!!keepVisibleEl &&
    (child === keepVisibleEl || child.contains(keepVisibleEl)))

// ── Visibility ───────────────────────────────────────────────────────

const dispatchUpdate = <T>(
  element: HTMLElement,
  detail: FitChildrenEventDetail<T>,
): void => {
  element.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }))
}

const showChild = (child: HTMLElement): void => {
  if (child.style.display === 'none' || child.hasAttribute(HIDDEN_ATTR)) {
    child.style.removeProperty('display')
    child.removeAttribute(HIDDEN_ATTR)
  }
}

const hideChild = (child: HTMLElement): void => {
  if (child.style.display !== 'none') {
    child.style.setProperty('display', 'none', 'important')
    child.setAttribute(HIDDEN_ATTR, 'true')
  }
}

// ── Ghost DOM ────────────────────────────────────────────────────────

const _renderGhost = (state: FitChildrenState): void => {
  if (!state.targetElement) {
    return
  }

  if (!state.ghostElement) {
    const ghost = document.createElement('div')
    Object.assign(ghost.style, {
      display: 'flex',
      flexWrap: 'nowrap',
      left: '0px',
      overflow: 'hidden',
      pointerEvents: 'none',
      position: 'fixed',
      top: '-9999px',
      visibility: 'hidden',
      zIndex: '-9999',
    })
    document.body.appendChild(ghost)
    state.ghostElement = ghost
  }

  const targetStyle = window.getComputedStyle(state.targetElement)
  state.ghostElement.style.gap =
    state.gapFromOption !== undefined
      ? `${state.gapFromOption}px`
      : targetStyle.gap
  state.ghostElement.style.alignItems = targetStyle.alignItems

  state.realIndexToGhostChild = new Map()
  state.ghostObservableChildren = []

  const realChildren = Array.from(state.targetElement.children) as HTMLElement[]
  const fragment = document.createDocumentFragment()
  const keptClones: HTMLElement[] = []

  // Single pass: kept children go first in the ghost (reserve natural space), IO observes the rest
  realChildren.forEach((child, realIndex) => {
    const clone = child.cloneNode(true) as HTMLElement
    clone.style.removeProperty('display')
    clone.removeAttribute(HIDDEN_ATTR)

    // Stamp measured width so environments without layout (e.g. jsdom) can
    // still determine overflow via a mock IntersectionObserver.
    const rect = child.getBoundingClientRect()
    const measured = Math.max(rect.width, child.scrollWidth)
    clone.dataset.vFitW = String(Math.round(measured))

    if (isKeptChild(child, state.keepVisibleEl)) {
      clone.style.flexShrink = '0'
      keptClones.push(clone)
    } else {
      state.realIndexToGhostChild.set(realIndex, clone)
      state.ghostObservableChildren.push(clone)
    }
  })

  keptClones.forEach((clone) => fragment.appendChild(clone))
  state.ghostObservableChildren.forEach((clone) => fragment.appendChild(clone))
  state.ghostElement.replaceChildren(fragment)
}

const _updateGhostWidth = (state: FitChildrenState): void => {
  if (!state.ghostElement || !state.widthRestrictingContainer) {
    return
  }

  const containerWidth = getContentWidth(state.widthRestrictingContainer)

  // Smart fit: if all children fit without offset, no "+N" badge is needed
  const allClones = Array.from(state.ghostElement.children) as HTMLElement[]
  const gapStr = state.ghostElement.style.gap || '0'
  const gapParts = gapStr.trim().split(/\s+/)
  const gapPx = parseFloat(gapParts.length > 1 ? gapParts[1] : gapParts[0]) || 0
  let totalWidth = 0
  allClones.forEach((clone, i) => {
    totalWidth += parseFloat(clone.dataset.vFitW || '0') + (i > 0 ? gapPx : 0)
  })

  const width =
    totalWidth <= containerWidth
      ? containerWidth
      : containerWidth - state.offsetNeededInPx

  state.ghostElement.style.width = `${width}px`
}

// ── IntersectionObserver-based visibility ─────────────────────────────
const applyVisibility = (state: FitChildrenState): void => {
  const { targetElement, ghostElement, data, keepVisibleEl } = state
  if (!targetElement || !ghostElement) {
    return
  }

  const realChildren = Array.from(targetElement.children) as HTMLElement[]

  const hiddenChildren: HTMLElement[] = []
  const hiddenIndices: number[] = []

  realChildren.forEach((child, realIndex) => {
    if (isKeptChild(child, keepVisibleEl)) {
      showChild(child)
      return
    }

    const ghostChild = state.realIndexToGhostChild.get(realIndex)
    if (!ghostChild) {
      showChild(child)
      return
    }

    const isVisible = state.visibilityMap.get(ghostChild)

    if (isVisible === false) {
      hideChild(child)
      hiddenChildren.push(child)
      hiddenIndices.push(realIndex)
    } else {
      showChild(child)
    }
  })

  const hiddenData = data
    ? hiddenIndices
        .filter((index) => index < data.length)
        .map((index) => data[index])
    : undefined

  dispatchUpdate(targetElement, {
    hiddenChildren,
    hiddenChildrenCount: hiddenChildren.length,
    hiddenData,
    hiddenIndices,
    isOverflowing: hiddenChildren.length > 0,
  })
}

const _observeGhostChildren = (state: FitChildrenState): void => {
  if (!state.ghostElement || !state.targetElement) {
    return
  }

  state.intersectionObserver?.disconnect()
  state.visibilityMap = new WeakMap()

  if (state.ghostObservableChildren.length === 0) {
    applyVisibility(state)
    return
  }

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        state.visibilityMap.set(entry.target, entry.intersectionRatio >= 1.0)
      })
      applyVisibility(state)
    },
    {
      root: state.ghostElement,
      rootMargin: '0px',
      threshold: 1.0,
    },
  )

  state.ghostObservableChildren.forEach((child) =>
    intersectionObserver.observe(child),
  )
  state.intersectionObserver = intersectionObserver
}

// ── Scheduling ───────────────────────────────────────────────────────

const scheduleRecalculation = (state: FitChildrenState): void => {
  if (state.pendingCalc || !state.targetElement) {
    return
  }
  state.pendingCalc = true
  requestAnimationFrame(() => {
    _renderGhost(state)
    _updateGhostWidth(state)
    _observeGhostChildren(state)
    state.pendingCalc = false
  })
}

// ── Keep-visible observation ─────────────────────────────────────────

const observeKeepVisible = (state: FitChildrenState): void => {
  state.keepVisibleResizeObserver?.disconnect()

  if (!state.keepVisibleEl) {
    return
  }

  const resizeObserver = new ResizeObserver(() => scheduleRecalculation(state))
  resizeObserver.observe(state.keepVisibleEl)
  state.keepVisibleResizeObserver = resizeObserver
}

// ── Container observation ────────────────────────────────────────────

const onContainerResize = (state: FitChildrenState): void => {
  scheduleRecalculation(state)
}

const observeContainer = (state: FitChildrenState): void => {
  state.resizeObserver?.disconnect()

  if (!state.widthRestrictingContainer) {
    return
  }

  const resizeObserver = new ResizeObserver(() => onContainerResize(state))

  const parents: HTMLElement[] = []
  const collectParents = (element: HTMLElement | null): void => {
    if (!element || element === state.widthRestrictingContainer) {
      return
    }
    parents.push(element)
    collectParents(element.parentElement)
  }
  collectParents(state.targetElement ?? null)

  resizeObserver.observe(state.widthRestrictingContainer)
  parents.forEach((parent) => resizeObserver.observe(parent))

  state.resizeObserver = resizeObserver
}

// ── Directive lifecycle ──────────────────────────────────────────────

const handleFitChildren = (
  wrapperElement: HTMLElement,
  binding: { value?: FitChildrenOptions },
): void => {
  let state = stateMap.get(wrapperElement)

  if (!state) {
    state = {
      data: binding.value?.data,
      gapFromOption: binding.value?.gap,
      ghostElement: undefined,
      ghostObservableChildren: [],
      intersectionObserver: undefined,
      keepVisibleEl: binding.value?.keepVisibleEl,
      keepVisibleResizeObserver: undefined,
      mutationObserver: undefined,
      offsetNeededInPx: Math.max(
        binding.value?.offsetNeededInPx ?? DEFAULT_OFFSET_PX,
        0,
      ),
      pendingCalc: false,
      realIndexToGhostChild: new Map(),
      resizeObserver: undefined,
      targetElement: undefined,
      visibilityMap: new WeakMap(),
      widthRestrictingContainer: undefined,
    }
    stateMap.set(wrapperElement, state)
  } else {
    let needsUpdate = false

    if (binding.value?.data !== state.data) {
      state.data = binding.value?.data
      needsUpdate = true
    }
    if (binding.value?.gap !== state.gapFromOption) {
      state.gapFromOption = binding.value?.gap
      needsUpdate = true
    }
    if (
      binding.value?.offsetNeededInPx !== undefined &&
      binding.value.offsetNeededInPx !== state.offsetNeededInPx
    ) {
      state.offsetNeededInPx = Math.max(binding.value.offsetNeededInPx, 0)
      needsUpdate = true
    }
    if (binding.value?.keepVisibleEl !== state.keepVisibleEl) {
      state.keepVisibleEl = binding.value?.keepVisibleEl
      observeKeepVisible(state)
      needsUpdate = true
    }

    if (needsUpdate) {
      scheduleRecalculation(state)
    }
  }

  if (!state.targetElement && wrapperElement) {
    state.targetElement = wrapperElement
  }

  if (!state.mutationObserver && state.targetElement) {
    const mutationObserver = new MutationObserver(() =>
      scheduleRecalculation(state!),
    )
    mutationObserver.observe(state.targetElement, { childList: true })
    state.mutationObserver = mutationObserver
  }

  if (!state.ghostElement) {
    _renderGhost(state)
  }

  const container =
    (binding.value?.widthRestrictingContainer as HTMLElement | undefined) ??
    wrapperElement

  if (
    !state.widthRestrictingContainer ||
    state.widthRestrictingContainer !== container
  ) {
    state.widthRestrictingContainer = container
    observeContainer(state)
    observeKeepVisible(state)
    scheduleRecalculation(state)
  }
}

export const vFitChildren: Directive<
  HTMLElement,
  FitChildrenOptions | undefined
> = {
  beforeMount: handleFitChildren,
  beforeUnmount(element: HTMLElement) {
    const state = stateMap.get(element)
    if (!state) {
      return
    }

    state.targetElement = undefined

    state.resizeObserver?.disconnect()
    state.intersectionObserver?.disconnect()
    state.keepVisibleResizeObserver?.disconnect()
    state.mutationObserver?.disconnect()

    state.ghostElement?.remove()

    element
      .querySelectorAll(`[${HIDDEN_ATTR}]`)
      .forEach((node) => showChild(node as HTMLElement))

    stateMap.delete(element)
  },
  updated: handleFitChildren,
}