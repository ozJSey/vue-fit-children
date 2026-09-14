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

const sameItems = (a: unknown[] | undefined, b: unknown[] | undefined): boolean =>
  a === b ||
  (!!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index])))

/**
 * Would a listener see anything different?
 *
 * This is the whole dispatch gate, and it compares the PAYLOAD — every field
 * the event carries — against the payload last dispatched. The gate it replaces
 * compared the *visible* set plus the `data` array's reference identity, which
 * is a proxy for the payload and not a faithful one: neither term moves when
 * hidden children are added or removed, nor when the array is mutated in place
 * with `push` / `pop` / `splice`, which is how Vue code mutates arrays. A "+3
 * more" badge then went on naming rows the user had already deleted, while
 * `data-v-fit-state` on the same host correctly read `fits`.
 *
 * `undefined` means nothing has been dispatched yet, so the first pass always
 * reports — including the pass that hides EVERY child, which used to look like
 * "no change" because the visible set started empty and stayed empty (FIT-1 F1).
 */
const sameDetail = (
  previous: FitChildrenEventDetail | undefined,
  next: FitChildrenEventDetail,
): boolean =>
  !!previous &&
  previous.isOverflowing === next.isOverflowing &&
  previous.hiddenChildren.length === next.hiddenChildren.length &&
  previous.hiddenChildren.every((child, index) => child === next.hiddenChildren[index]) &&
  previous.hiddenIndices.every((position, index) => position === next.hiddenIndices[index]) &&
  sameItems(previous.hiddenData, next.hiddenData)

/**
 * The `data` array is documented to map 1:1 with the children that are not
 * marked `data-v-fit-decorative`. When it does not, `hiddenData` cannot be
 * right for anyone — so say so, rather than quietly handing back a short array.
 * Once per distinct mismatch, because a resize drag would otherwise report the
 * same thing sixty times a second.
 */
const warnOnMismatch = (state: FitChildrenState, dataChildren: number): void => {
  if (!state.data || dataChildren === state.data.length) {
    state.dataMismatch = undefined
    return
  }
  const signature = `${dataChildren}:${state.data.length}`
  if (state.dataMismatch === signature) {
    return
  }
  state.dataMismatch = signature
  console.warn(
    `[v-fit-children] \`data\` has ${state.data.length} item(s) but the host has ` +
      `${dataChildren} child(ren) mapped to it, so \`hiddenData\` cannot line up. ` +
      'Mark every child that is not one of your items — separators, a pinned ' +
      'input, a trailing badge — with `data-v-fit-decorative`.',
  )
}

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
      if (isDataChild(child)) {
        dataIndex++
      }
      return
    }

    const countsAsData = isDataChild(child)
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

  warnOnMismatch(state, dataIndex)

  const hiddenData = state.data
    ? hiddenDataIndices
        // Only reachable when the 1:1 contract is broken, which `warnOnMismatch`
        // has just said out loud. Keeping the array typed `T[]` rather than
        // handing back holes is the honest half of that answer.
        .filter((index) => index < state.data!.length)
        .map((index) => state.data![index])
    : undefined

  const detail: FitChildrenEventDetail = {
    hiddenChildren,
    hiddenChildrenCount: hiddenChildren.length,
    hiddenData,
    hiddenIndices,
    isOverflowing: fit.isOverflowing,
  }

  state.visible = fit.visible

  // Hiding a child is itself a resize, so an unconditional dispatch lets a
  // listener that renders from the payload loop forever. Reporting only what
  // actually changed is what makes that impossible without also making the
  // event unreliable.
  if (sameDetail(state.lastDispatched, detail)) {
    return
  }
  state.lastDispatched = detail

  host.dispatchEvent(new CustomEvent<FitChildrenEventDetail>(EVENT_NAME, { detail }))
}
