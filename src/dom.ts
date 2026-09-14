/**
 * The hiding mechanism and the three questions asked about a child: did the
 * consumer hide it, is it pinned, is it one of the consumer's `data` items.
 *
 * No layout is read here. Every measurement in the package lives in
 * `measure.ts` — see ARCHITECTURE.md, and `architecture.test.ts`, which fails
 * if a layout API appears in any other module.
 */
import { DECORATIVE_ATTR, HIDDEN_ATTR, KEEP_ATTR, STYLE_ATTR } from './constants'

// ── Hiding ───────────────────────────────────────────────────────────
//
// Hiding is an ATTRIBUTE plus one injected rule, never an inline style.
// `v-show`, Vue's style-prop patcher and <Transition> all read and write
// `el.style.display`; writing it here means the last writer wins, so a
// `v-show` child flipping to true silently un-hides a child that does not fit,
// and our own un-hide destroys a `v-show="false"`. Staying off that property
// lets the two compose, and makes "the consumer hid this" an exact test rather
// than a guess about who set the inline style.

export const ensureHideRule = (host: HTMLElement): void => {
  // A host inside a shadow root gets nothing from a document-level sheet.
  const root = host.getRootNode() as Document | ShadowRoot
  const parent: ParentNode = (root as Document).head ?? root

  // Asking the DOM rather than remembering which roots we have seen: it is the
  // same cost, it is exact, and — because `recalculate` calls this every pass —
  // it genuinely puts the rule back if anything removed it.
  if (parent.querySelector(`style[${STYLE_ATTR}]`)) {
    return
  }

  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTR, '')
  style.textContent = `[${HIDDEN_ATTR}]{display:none !important}`
  parent.appendChild(style)
}

export const hideChild = (child: HTMLElement): void => {
  child.setAttribute(HIDDEN_ATTR, '')
}

export const showChild = (child: HTMLElement): void => {
  child.removeAttribute(HIDDEN_ATTR)
}

/**
 * The consumer hid this one themselves (`v-show`). Exact, because the directive
 * no longer writes `display` at all. Class-based hiding stays undetectable —
 * a documented limitation, not an oversight.
 */
export const isConsumerHidden = (child: HTMLElement): boolean =>
  child.style.display === 'none'

// ── The two independent questions ────────────────────────────────────

/** Never hide this one, wherever it sits. */
export const isKeptChild = (
  child: HTMLElement,
  keepVisibleEl: HTMLElement | undefined,
): boolean =>
  child.hasAttribute(KEEP_ATTR) ||
  (!!keepVisibleEl &&
    (child === keepVisibleEl || child.contains(keepVisibleEl)))

/**
 * This one is a `data` item, so it consumes a `data` index.
 *
 * Membership is DECLARED — one attribute, `data-v-fit-decorative` — and is not
 * inferred from anything else. Pinning used to remove a child from the index
 * when it was pinned by `keepVisibleEl` and not when it was pinned by
 * `data-v-fit-keep`, so the two documented ways to pin the same child produced
 * different `hiddenData` for the same row (FIT-1 F3). Pinning is about
 * visibility; membership is about your array. They are unrelated, and a child
 * that is pinned *and* not one of your items says both.
 */
export const isDataChild = (child: HTMLElement): boolean =>
  !child.hasAttribute(DECORATIVE_ATTR)
