/**
 * When a pass runs. Every trigger in `observers.ts` and every directive hook
 * funnels through `recalculate`.
 */
import { EPSILON } from './constants'
import { ensureHideRule } from './dom'
import { computeFit } from './fit'
import { measure } from './measure'
import { applyFit, sameRun } from './visibility'
import type { FitChildrenState } from './types'

// ── Recalculation ────────────────────────────────────────────────────

/**
 * No `requestAnimationFrame`. Every caller already runs before the browser
 * paints — a ResizeObserver callback fires between layout and paint, and the
 * directive's `updated` hook is a post-render effect inside the same task.
 * Deferring to the next frame is what made the previous state visible, clipped,
 * in between.
 *
 * And no cached pass. 2.2.0 kept the last measurement and, when the row only
 * narrowed, decided from arithmetic alone — advertised in four places as
 * "shrinking is free, no DOM is read at all". It was not an optimisation. A
 * cached pass was allowed to CONFIRM the current run and nothing else, so the
 * only shrink it saved a measurement on was a shrink that changed nothing;
 * every shrink that dropped a chip ran the decision twice. What it did buy was
 * a second source of widths — `observers.ts` storing `ResizeObserver` content
 * rects, taken with children hidden and excluding a scrollbar `measure.ts`
 * included — feeding the same `min(host, container)` the fit decision uses.
 * That is the defect class ARCHITECTURE.md's first invariant exists to forbid,
 * and it also created the feedback problem the code below then guards against:
 * a host that sizes to its own children reports a narrower box the instant we
 * hide something, and a cached pass had no way to know that number was its own
 * last decision echoing back. Measuring every pass — with every child shown
 * first — reads the real budget instead of the consequence, and the whole
 * `remeasure` apparatus goes with it.
 */
const runPass = (state: FitChildrenState): void => {
  measure(state)

  const available = Math.min(state.hostWidth, state.containerWidth)
  const fit = computeFit(
    state.metrics,
    available,
    state.offsetNeededInPx,
    state.gapFromOption,
  )

  // Feedback through the consumer's own render.
  //
  // A "+N" badge whose LABEL comes from the hidden set makes our output an
  // input: the available width is read while the badge still carries the width
  // the PREVIOUS decision gave it. Vue re-renders the badge after our event, so
  // the loop closes a frame later and cannot be settled inside one pass —
  // measured, such a trigger cycles 5 -> 6 -> 7 -> 5 forever at ~60 rounds a
  // second, and the 7 state hangs 80px past the host's edge.
  //
  // A fresh measurement says whether the run we are currently showing was too
  // big: if fewer children fit now than we have visible, the applied run did
  // not survive its own consequences. Remember exactly those runs and refuse to
  // grow back into one. That is narrower than freezing — a badge that shrinks
  // for an unrelated reason still lets the row expand, because the run it
  // expands to was never one that overflowed.
  // Record against the width the run was CHOSEN at, not the width we noticed it
  // was too big at. The second number is the consequence — the badge has
  // already widened by then — so keying on it would let the cycle straight back
  // in. "Run R did not survive being chosen at width A" is the durable fact.
  if (state.visible.size > fit.visible.size && state.visible.size > 0) {
    if (!state.oversizedRuns.some((entry) => sameRun(entry.run, state.visible))) {
      state.oversizedRuns = [
        ...state.oversizedRuns,
        { run: state.visible, available: state.appliedAvailable },
      ].slice(-4)
    }
  }

  const provenTooBig = state.oversizedRuns.some(
    (entry) =>
      sameRun(entry.run, fit.visible) && available <= entry.available + EPSILON,
  )
  if (fit.visible.size > state.visible.size && provenTooBig) {
    state.lastApplyMoved = false
    applyFit(state, {
      visible: state.visible,
      isOverflowing: fit.isOverflowing,
    })
    return
  }

  // Whether this pass actually moved the run is what later separates a
  // sibling resizing because the CONSUMER changed it from one resizing because
  // WE did — see the sibling branch in observers.ts.
  state.lastApplyMoved = !sameRun(fit.visible, state.visible)
  state.appliedAvailable = available
  applyFit(state, fit)
}

export const recalculate = (state: FitChildrenState): void => {
  if (!state.targetElement || state.pass) {
    return
  }

  // Per pass, not once at mount. Hiding is an attribute plus one injected rule,
  // so if that rule ever leaves the document — a hot reload, a framework that
  // rewrites <head>, a consumer clearing styles — every hidden child keeps its
  // attribute and silently renders at full size. One `querySelector` against
  // the root is nothing next to the layout read this pass is about to do.
  ensureHideRule(state.targetElement)

  state.pass = true
  try {
    runPass(state)
  } finally {
    state.pass = false
  }
}
