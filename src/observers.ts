/**
 * Everything that can tell us the row needs recalculating: the container box,
 * the host box, the parent box, each child's box, and DOM injected outside Vue.
 * All of it only ever calls `recalculate`.
 *
 * This module never supplies a width to the decision. A `ResizeObserver` entry
 * is a SIGNAL that a box moved, read here only to answer "did the geometry
 * change since we last measured"; the number the fit is computed from comes
 * from `measure.ts` and from nowhere else. Storing content rects here is how
 * 2.2.0 ended up with two definitions of the host's width — one that counted a
 * scrollbar and one that did not, taken in different DOM states, feeding the
 * same `min(host, container)`.
 */
import { EPSILON, HIDDEN_ATTR } from './constants'
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
    let relevant = false
    /**
     * The host reporting MORE room than the last measurement gave it. Our own
     * output cannot produce that number: every pass measures with every child
     * SHOWN, so a host that sizes to its own children is already read at its
     * widest, and hiding can only take width off it from there. Growth past
     * that reading is the world — a sidebar closing, a splitter dragged back, a
     * class coming off.
     */
    let hostGrew = false
    /** Whether any OTHER observed box moved in the same delivery. */
    let elsewhereMoved = false

    for (const entry of entries) {
      const target = entry.target as HTMLElement
      const width = entry.contentRect.width

      if (target === host) {
        hostGrew = width > state.hostWidth + EPSILON
        relevant = true
      } else if (target === state.widthRestrictingContainer) {
        if (Math.abs(width - state.containerWidth) > EPSILON) {
          // The geometry genuinely changed, so a run frozen out of a feedback
          // cycle deserves another chance.
          state.oversizedRuns = []
        }
        elsewhereMoved = true
        relevant = true
      } else if (target === host.parentElement) {
        // A host that sizes to its own children stops tracking the row the
        // moment its content is narrower than the space on offer: widen the row
        // and the host does not move, so no entry for it ever arrives and the
        // run stays collapsed at whatever the narrowest moment produced. The
        // parent is the only box that still reports the growth. Its width is a
        // signal, never a budget — it includes any sibling badge, so acting on
        // the number would over-admit; a fresh measurement is what it buys.
        if (Math.abs(width - state.parentWidth) > EPSILON) {
          state.oversizedRuns = []
        }
        elsewhereMoved = true
        relevant = true
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
        elsewhereMoved = true
        relevant = true
      }
    }

    // The host is the one box with no branch of its own above, because by
    // itself it cannot say WHY it moved: a shrink-to-fit host narrows because
    // we hid a child, and a host in a flex row narrows because a "+N" badge
    // beside it widened — both of those are our own output coming back, and
    // clearing the record on either reopens the cycle `schedule.ts` guards.
    // Through 2.3.0 it therefore cleared nothing at all, which froze the row:
    // a host narrowed by the WORLD filed the run it was showing as "proven too
    // big", and nothing on the host path ever retracted it, so returning to the
    // width those children had always fitted at re-applied the collapsed run
    // forever — with `data-v-fit-state` reading `fits` over it.
    //
    // Two facts make the honest half of that recoverable. Our feedback can only
    // ever take width OFF the host relative to the measurement (which is taken
    // with every child shown), so growth past it is never ours. And feedback
    // always arrives WITH the box that carried it — the badge that relabelled,
    // the container that narrowed — in the same delivery, because one layout
    // produces one callback. A host that grew alone is the world, and the
    // record describes a layout that no longer exists.
    if (hostGrew && !elsewhereMoved) {
      state.oversizedRuns = []
    }

    if (relevant) {
      recalculate(state)
    }
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

/**
 * Vue invokes `updated` on every patch of the host, not only when the child set
 * changes, so an unrelated re-render would otherwise cost a full measure pass.
 * Comparing the live children against the ones we observed is exact and needs
 * no vnode work: a child whose *content* changed keeps its identity, and the
 * per-child ResizeObserver is what reports that.
 */
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
