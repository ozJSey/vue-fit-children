/**
 * The one DOM write. Everything the directive shows, hides, stamps or
 * dispatches happens here and nowhere else.
 */
import { EVENT_NAME, STATE_ATTR } from './constants'
import { hideChild, isConsumerHidden, isDataChild, showChild } from './dom'
import type { FitChildrenEventDetail, FitChildrenFitState, FitChildrenState } from './types'

// ── Applying the decision ────────────────────────────────────────────

export const sameRun = (a: Set<HTMLElement>, b: Set<HTMLElement>): boolean =>
  a.size === b.size && [...a].every((element) => b.has(element))

export const applyFit = (
  state: FitChildrenState,
  fit: { visible: Set<HTMLElement>; isOverflowing: boolean },
): void => {
  const host = state.targetElement
  if (!host) {
    return
  }

  const hiddenChildren: HTMLElement[] = []
  const hiddenIndices: number[] = []
  const hiddenDataIndices: number[] = []
  let dataIndex = 0

  const children = Array.from(host.children) as HTMLElement[]

  children.forEach((child, index) => {
    if (isConsumerHidden(child)) {
      // Not measured, not counted, and not force-shown — but it still consumes
      // its data index, or the mapping skews for everything after it.
      if (isDataChild(child, state.keepVisibleEl)) {
        dataIndex++
      }
      return
    }

    const countsAsData = isDataChild(child, state.keepVisibleEl)
    const currentDataIndex = countsAsData ? dataIndex : -1
    if (countsAsData) {
      dataIndex++
    }

    if (fit.visible.has(child)) {
      showChild(child)
      return
    }

    hideChild(child)
    hiddenChildren.push(child)
    hiddenIndices.push(index)
    if (currentDataIndex >= 0) {
      hiddenDataIndices.push(currentDataIndex)
    }
  })

  const fitState: FitChildrenFitState = fit.isOverflowing
    ? 'overflowing'
    : 'fits'
  if (host.getAttribute(STATE_ATTR) !== fitState) {
    host.setAttribute(STATE_ATTR, fitState)
  }

  // Hiding a child is itself a resize, so an unconditional dispatch lets a
  // listener that renders from the payload loop forever. The signature covers
  // the visible set AND the data reference, because an unchanged fit over new
  // data still changes `hiddenData`.
  const unchanged =
    sameRun(fit.visible, state.visible) && state.data === state.lastDispatchedData
  state.visible = fit.visible
  state.lastDispatchedData = state.data
  if (unchanged) {
    return
  }

  const hiddenData = state.data
    ? hiddenDataIndices
        .filter((index) => index < state.data!.length)
        .map((index) => state.data![index])
    : undefined

  host.dispatchEvent(
    new CustomEvent<FitChildrenEventDetail>(EVENT_NAME, {
      detail: {
        hiddenChildren,
        hiddenChildrenCount: hiddenChildren.length,
        hiddenData,
        hiddenIndices,
        isOverflowing: fit.isOverflowing,
      },
    }),
  )
}
