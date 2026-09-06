/**
 * When a pass runs and whether it is allowed to re-measure. Every trigger in
 * `observers.ts` and every directive hook funnels through `recalculate`.
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
 */
const runPass = (state: FitChildrenState, remeasure: boolean): void => {
  if (remeasure) {
    measure(state)
  }

  const available = Math.min(state.hostWidth, state.containerWidth)
  const fit = computeFit(
    state.metrics,
    available,
    state.offsetNeededInPx,
    state.gapFromOption,
  )

  // A host that sizes to its own children reports a NEW width the instant we
  // hide one, and that width is our own last decision echoing back. Subtract
  // the offset from it and the next pass hides another, then another: measured
  // at 3 visible -> 0 in five rounds. So a cached pass may only CONFIRM the
  // current run; anything that would change it re-measures with every child
  // shown, which reads the real budget instead of the consequence.
  if (!remeasure && !sameRun(fit.visible, state.visible)) {
    runPass(state, true)
    return
  }

  state.lastAvailable = available

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

export const recalculate = (state: FitChildrenState, remeasure: boolean): void => {
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
    runPass(state, remeasure)
  } finally {
    state.pass = false
  }
}
