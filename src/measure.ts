/**
 * The one layout read per pass. Nothing else in the package calls
 * `getBoundingClientRect`, which is what keeps a second, disagreeing
 * measurement from existing.
 */
import { getContentWidth, isConsumerHidden, isKeptChild, parsePx, showChild } from './dom'
import type { ChildMetric, FitChildrenState } from './types'

// ── Measurement ──────────────────────────────────────────────────────

/**
 * The one layout read. Every child the directive hid is shown first, because a
 * `display: none` child measures zero and would poison the record — that is the
 * defect the ghost existed to route around, and un-hiding in place is the whole
 * of the alternative.
 *
 * Available width is `min(host, container)`. Reading the host is safe because
 * nothing here ever writes the host's width; a host that sizes to its own
 * children reports its full width while they are all shown, so the container
 * bound is what catches it.
 */
export const measure = (state: FitChildrenState): void => {
  const host = state.targetElement
  if (!host) {
    return
  }

  const children = Array.from(host.children) as HTMLElement[]
  children.forEach((child) => showChild(child))

  state.hostWidth = getContentWidth(host)
  state.parentWidth = host.parentElement
    ? getContentWidth(host.parentElement)
    : 0
  state.containerWidth =
    state.widthRestrictingContainer && state.widthRestrictingContainer !== host
      ? getContentWidth(state.widthRestrictingContainer)
      : Number.POSITIVE_INFINITY

  const hostStyle = window.getComputedStyle(host)
  const hostRect = host.getBoundingClientRect()
  let previousRight =
    hostRect.left +
    parsePx(hostStyle.borderLeftWidth) +
    parsePx(hostStyle.paddingLeft)

  const metrics: ChildMetric[] = []

  children.forEach((child) => {
    if (isConsumerHidden(child)) {
      return
    }

    const rect = child.getBoundingClientRect()
    const childStyle = window.getComputedStyle(child)
    // A child that clips its own content occupies its box; one that lets
    // content spill (overflow: visible) occupies the spill. The `||` fallback
    // is load-bearing: the gap tests mock getComputedStyle down to two keys.
    const overflowX = childStyle.overflowX || child.style.overflowX
    const width =
      overflowX && overflowX !== 'visible'
        ? rect.width
        : Math.max(rect.width, child.scrollWidth)

    metrics.push({
      element: child,
      width,
      spacingBefore: Math.max(rect.left - previousRight, 0),
      marginAfter: Math.max(parsePx(childStyle.marginRight), 0),
      isKept: isKeptChild(child, state.keepVisibleEl),
    })
    previousRight = rect.left + width
  })

  state.metrics = metrics
}
