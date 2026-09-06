/**
 * Every type the package uses. Leaf module — imports nothing.
 */

// Based on https://www.npmjs.com/package/v-fit-children
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

/** Value of the `data-v-fit-state` attribute the directive stamps on its host. */
export type FitChildrenFitState = 'fits' | 'overflowing'

/**
 * One child's contribution to the row, measured while every child was visible.
 * Kept between passes so a shrinking container costs no DOM reads at all.
 */

export type ChildMetric = {
  /**
   * The element IS the identity. Comparing runs by position breaks the moment
   * a child is added, removed or reordered, because index n then names a
   * different element than it did last pass — the outcome looks unchanged when
   * it is not, and the event that should have fired never does. DOM position is
   * still what `hiddenIndices` reports, but it is read fresh each pass rather
   * than remembered.
   */
  element: HTMLElement
  width: number
  /**
   * Space between this child and the previous one. Measured from the laid-out
   * positions rather than computed, so CSS `gap` and sibling margins arrive as
   * one number whatever their source.
   */
  spacingBefore: number
  /**
   * Trailing margin. Spacing between children is shared, but the last visible
   * child's trailing margin belongs to nobody — leave it out and the row is
   * judged short by exactly that much.
   */
  marginAfter: number
  isKept: boolean
}

export type FitChildrenState<T = unknown> = {
  containerWidth: number
  data: T[] | undefined
  gapFromOption: number | undefined
  hostWidth: number
  keepVisibleEl: HTMLElement | undefined
  lastAvailable: number
  metrics: ChildMetric[]
  mutationObserver: MutationObserver | undefined
  observedChildren: HTMLElement[]
  observedSiblings: HTMLElement[]
  parentWidth: number
  offsetNeededInPx: number
  pass: boolean
  appliedAvailable: number
  lastApplyMoved: boolean
  lastDispatchedData: unknown[] | undefined
  oversizedRuns: { run: Set<HTMLElement>; available: number }[]
  resizeObserver: ResizeObserver | undefined
  targetElement: HTMLElement | undefined
  visible: Set<HTMLElement>
  widthRestrictingContainer: HTMLElement | undefined
}
