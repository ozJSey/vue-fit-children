/**
 * Everything that can tell us the row needs recalculating: the container box,
 * the host box, the parent box, each child's box, and DOM injected outside Vue.
 * All of it only ever calls `recalculate`.
 */
import { EPSILON, HIDDEN_ATTR } from './constants'
import { getContentWidth } from './dom'
import { recalculate } from './schedule'
import type { FitChildrenState } from './types'

// ── Observation ──────────────────────────────────────────────────────

export const observe = (state: FitChildrenState): void => {
  state.resizeObserver?.disconnect()

  const host = state.targetElement
  if (!host) {
    return
  }

  const resizeObserver = new ResizeObserver((entries) => {
    let remeasure = false
    let sawBox = false

    for (const entry of entries) {
      const target = entry.target as HTMLElement
      const width = entry.contentRect.width

      if (target === host) {
        state.hostWidth = width
        sawBox = true
      } else if (target === state.widthRestrictingContainer) {
        if (Math.abs(width - state.containerWidth) > EPSILON) {
          state.oversizedRuns = []
        }
        state.containerWidth = width
        sawBox = true
      } else if (target === host.parentElement) {
        // A host that sizes to its own children stops tracking the row the
        // moment its content is narrower than the space on offer: widen the row
        // and the host does not move, so no entry for it ever arrives and the
        // run stays collapsed at whatever the narrowest moment produced. The
        // parent is the only box that still reports the growth. Its width is a
        // signal, never a budget — it includes any sibling badge, so acting on
        // the number would over-admit; a fresh measurement is what it buys.
        if (Math.abs(width - state.parentWidth) > EPSILON) {
          // The geometry genuinely changed, so a run frozen out of a feedback
          // cycle deserves another chance.
          state.oversizedRuns = []
          remeasure = width > state.parentWidth + EPSILON
        }
        state.parentWidth = width
        sawBox = true
      } else if (!target.hasAttribute(HIDDEN_ATTR)) {
        // A child, or a sibling, changed size on its own. One we hid reports
        // 0×0 once and then goes quiet, which is our own churn rather than news.
        //
        // A sibling resizing is ambiguous: a "+N" badge widens both because the
        // consumer relabelled it AND because our own last decision changed what
        // it reports. Identity comparison cannot tell those apart — the button
        // is the same element either way, which is why the `updated` hook sees
        // nothing and returns early. What separates them is whether OUR last
        // pass moved anything. If it did not, this resize came from outside, so
        // the record of runs that once proved too big describes a layout that no
        // longer exists and has to go.
        if (!state.lastApplyMoved) {
          state.oversizedRuns = []
        }
        remeasure = true
      }
    }

    if (!remeasure && !sawBox) {
      return
    }

    // Growing needs fresh widths, because the record's entry for a hidden child
    // is the last one taken while it was visible and its content may have moved
    // on since. Shrinking only ever consults children that are visible right
    // now, so the record is live and the pass costs no DOM reads at all.
    const available = Math.min(state.hostWidth, state.containerWidth)
    recalculate(state, remeasure || available > state.lastAvailable + EPSILON)
  })

  resizeObserver.observe(host)
  if (state.widthRestrictingContainer && state.widthRestrictingContainer !== host) {
    resizeObserver.observe(state.widthRestrictingContainer)
  }
  const parent = host.parentElement
  if (parent && parent !== state.widthRestrictingContainer) {
    resizeObserver.observe(parent)
  }

  // Siblings. The host's share of the row is the parent's content minus what
  // everything beside it takes, and a "+N" badge growing next to a shrink-to-fit
  // host changes NEITHER the host's box nor the parent's — both stay exactly as
  // they were, so without watching the badge itself nothing ever fires and the
  // row silently keeps a stale answer. Measured: sweeping such a badge from 80px
  // to 380px moved the visible count not at all.
  const siblings = parent
    ? (Array.from(parent.children) as HTMLElement[]).filter((el) => el !== host)
    : []
  siblings.forEach((sibling) => resizeObserver.observe(sibling))
  state.observedSiblings = siblings

  const children = Array.from(host.children) as HTMLElement[]
  children.forEach((child) => resizeObserver.observe(child))

  state.observedChildren = children
  state.resizeObserver = resizeObserver
}

/**
 * Vue invokes `updated` on every patch of the host, not only when the child set
 * changes, so an unrelated re-render would otherwise cost a full measure pass.
 * Comparing the live children against the ones we observed is exact and needs
 * no vnode work: a child whose *content* changed keeps its identity, and the
 * per-child ResizeObserver is what reports that.
 */
/**
 * Whether the host's siblings changed identity — a "+N" badge appearing or
 * leaving via `v-if`. That badge's arrival is usually caused by our own event,
 * and its width comes straight out of the row, so it has to be picked up and
 * observed rather than waited on.
 */
export const siblingsChanged = (state: FitChildrenState): boolean => {
  const parent = state.targetElement?.parentElement
  if (!parent) {
    return false
  }
  const current = (Array.from(parent.children) as HTMLElement[]).filter(
    (el) => el !== state.targetElement,
  )
  if (current.length !== state.observedSiblings.length) {
    return true
  }
  return current.some((el, index) => el !== state.observedSiblings[index])
}

export const childrenChanged = (state: FitChildrenState): boolean => {
  const host = state.targetElement
  if (!host) {
    return false
  }
  const current = host.children
  if (current.length !== state.observedChildren.length) {
    return true
  }
  for (let index = 0; index < current.length; index++) {
    if (current[index] !== state.observedChildren[index]) {
      return true
    }
  }
  return false
}
