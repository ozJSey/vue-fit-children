/**
 * The only module in the package that reads layout.
 *
 * `getBoundingClientRect`, `getComputedStyle`, `scrollWidth`, `offsetWidth` and
 * `clientWidth` appear here and nowhere else — `architecture.test.ts` fails the
 * build if they turn up in another module. A second, disagreeing measurement is
 * the defect class that produced partially-visible children for the whole of
 * 2.x, and it came back in 2.2.0 through `observers.ts`, which stored
 * `ResizeObserver` content rects — taken with children hidden, and excluding a
 * scrollbar this file's own arithmetic included — into the same decision.
 */
import { DECORATIVE_ATTR } from './constants'
import { isConsumerHidden, isKeptChild, showChild } from './dom'
import type { ChildMetric, FitChildrenState } from './types'

// ── Reading a box ────────────────────────────────────────────────────

export const parsePx = (value: string): number => parseFloat(value) || 0

/**
 * The width children actually have to live in: the border box, less border,
 * padding, and any classic scrollbar.
 *
 * The scrollbar matters. It sits inside the border box that
 * `getBoundingClientRect` reports and outside `clientWidth`, so leaving it in
 * makes the budget ~15px too generous on Windows and Linux and admits one child
 * too many, which then renders clipped at the host's edge. On macOS overlay
 * scrollbars the correction is 0, which is why it is easy to ship without.
 *
 * This is also, deliberately, the same quantity a `ResizeObserver` reports in
 * `entry.contentRect.width`, so the two can be compared without one lineage
 * silently disagreeing with the other.
 */
export const getContentWidth = (element: HTMLElement): number => {
  const style = window.getComputedStyle(element)
  const borderLeft = parsePx(style.borderLeftWidth)
  const borderRight = parsePx(style.borderRightWidth)
  const scrollbar = Math.max(
    element.offsetWidth - element.clientWidth - borderLeft - borderRight,
    0,
  )
  return (
    element.getBoundingClientRect().width -
    borderLeft -
    borderRight -
    parsePx(style.paddingLeft) -
    parsePx(style.paddingRight) -
    scrollbar
  )
}

// ── Measurement ──────────────────────────────────────────────────────

/**
 * The layout read for one pass. Every child the directive hid is shown first,
 * because a `display: none` child measures zero and would poison the record —
 * that is the defect the ghost existed to route around, and un-hiding in place
 * is the whole of the alternative.
 *
 * Available width is `min(host, container)`. Reading the host is safe because
 * nothing here ever writes the host's width, and because every child is shown
 * when it is read: a host that sizes to its own children would otherwise report
 * the previous decision back as the next budget.
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
  const hostIsFlex =
    hostStyle.display === 'flex' || hostStyle.display === 'inline-flex'
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
    const overflowX = childStyle.overflowX
    const clipsOwnContent = overflowX !== '' && overflowX !== 'visible'

    // A flex item whose `overflow` is not `visible` has an automatic minimum
    // size of ZERO (CSS Flexbox §4.5), so the browser squashes it to whatever
    // the host had left — which is our own answer echoed back. Measure that and
    // the total always equals the available width, `full <= available` is true
    // by construction, and the directive concludes "fits" while every chip sits
    // ellipsised to a few pixels. `scrollWidth` is what the child actually
    // wants, and for a clipping element it is exactly the content extent.
    //
    // The playground never revealed this because its chips are `white-space:
    // nowrap`, which raises the automatic minimum back to the full text width.
    const squashable = hostIsFlex && parseFloat(childStyle.flexShrink) > 0

    const width =
      clipsOwnContent && !squashable
        ? rect.width
        : Math.max(rect.width, child.scrollWidth)

    metrics.push({
      element: child,
      width,
      spacingBefore: Math.max(rect.left - previousRight, 0),
      marginAfter: Math.max(parsePx(childStyle.marginRight), 0),
      isKept: isKeptChild(child, state.keepVisibleEl),
      isDecorative: child.hasAttribute(DECORATIVE_ATTR),
    })

    // The cursor advances by the BOX, never by the spill. The next child's
    // `rect.left` is laid out against the previous child's box, so advancing by
    // a larger `width` clamps the gap in front of it to zero and the row is
    // billed for n−k gaps instead of n−1 — one chip too many, rendered clipped.
    previousRight = rect.right
  })

  state.metrics = metrics
}
