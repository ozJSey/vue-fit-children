/**
 * The fit decision: numbers in, numbers out. No DOM, so it is the one part
 * that can be reasoned about — and tested — on its own.
 */
import { EPSILON } from './constants'
import type { ChildMetric } from './types'

// ── The fit decision — pure arithmetic, no DOM ───────────────────────

/**
 * Children are hidden by overflow in DOM order: the visible set is the leading
 * run that fits, plus every pinned child wherever it sits.
 */
export const computeFit = (
  metrics: ChildMetric[],
  available: number,
  offsetNeededInPx: number,
  gapOverride: number | undefined,
): { visible: Set<HTMLElement>; isOverflowing: boolean } => {
  const everything = new Set(metrics.map((metric) => metric.element))
  if (metrics.length === 0) {
    return { visible: everything, isOverflowing: false }
  }

  // What each child costs the row: its own width plus the space in front of it.
  //
  // Spacing is measured, so margins are already in it, and the `gap` option is
  // a floor rather than a replacement — overriding downward would under-count
  // real spacing and let a child through that does not fit. The floor applies
  // only from the SECOND child on: `spacingBefore` for the first is its
  // distance from the host's content edge, not a gap between siblings, so
  // flooring it bills an n-child row for n gaps instead of n-1 and drops a chip
  // that fits.
  const cost = metrics.map((metric, index) =>
    index === 0 || gapOverride === undefined
      ? metric.width + metric.spacingBefore
      : metric.width + Math.max(metric.spacingBefore, gapOverride),
  )

  const full =
    cost.reduce((sum, value) => sum + value, 0) +
    metrics[metrics.length - 1].marginAfter

  // Smart fit: when everything fits without the reserved offset, no badge is
  // needed, so none of the width is held back for one.
  if (full <= available + EPSILON) {
    return { visible: everything, isOverflowing: false }
  }

  const budget = Math.max(available - offsetNeededInPx, 0)

  // Pinned children are never hidden wherever they sit, so their cost is
  // reserved up front rather than discovered part-way through the walk.
  let running = 0
  const visible = new Set<HTMLElement>()
  metrics.forEach((metric, index) => {
    if (metric.isKept) {
      running += cost[index]
      visible.add(metric.element)
    }
  })

  for (let index = 0; index < metrics.length; index++) {
    const metric = metrics[index]
    if (metric.isKept) {
      continue
    }
    if (running + cost[index] + metric.marginAfter > budget + EPSILON) {
      break
    }
    running += cost[index]
    visible.add(metric.element)
  }

  // Reaching here means the content does not fit the available width, which is
  // true whether or not anything could be hidden about it. Deriving this from
  // "did we hide something" reports `fits` for a row of entirely pinned
  // children that is visibly clipped.
  return { visible, isOverflowing: true }
}
