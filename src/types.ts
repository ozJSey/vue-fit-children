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
  /**
   * Carries `data-v-fit-decorative`: a separator, a pinned control, anything
   * that is not one of the consumer's `data` items. Two consequences, and only
   * these two — it consumes no `data` index, and it is never left trailing a
   * visible run with nothing after it to introduce.
   */
  isDecorative: boolean
}

export type FitChildrenState<T = unknown> = {
  containerWidth: number
  data: T[] | undefined
  /**
   * Signature of the last `data`-to-children mismatch warned about, so a resize
   * drag reports a broken 1:1 mapping once rather than sixty times a second.
   */
  dataMismatch: string | undefined
  gapFromOption: number | undefined
  hostWidth: number
  keepVisibleEl: HTMLElement | undefined
  /**
   * The last event payload, or `undefined` before the first dispatch. The
   * dispatch gate compares against THIS rather than against a proxy for it:
   * anything a listener can observe changing is a reason to dispatch, and
   * nothing else is. See `visibility.ts`.
   */
  lastDispatched: FitChildrenEventDetail | undefined
  metrics: ChildMetric[]
  mutationObserver: MutationObserver | undefined
  observedChildren: HTMLElement[]
  observedSiblings: HTMLElement[]
  parentWidth: number
  offsetNeededInPx: number
  pass: boolean
  appliedAvailable: number
  lastApplyMoved: boolean
  oversizedRuns: { run: Set<HTMLElement>; available: number }[]
  resizeObserver: ResizeObserver | undefined
  targetElement: HTMLElement | undefined
  visible: Set<HTMLElement>
  widthRestrictingContainer: HTMLElement | undefined
}
