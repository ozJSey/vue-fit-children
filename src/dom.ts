/**
 * Every DOM read and every DOM write that is not the fit decision itself:
 * how a child is hidden, how "the consumer hid it" is answered, and how a
 * content width is measured.
 */
import {
  DECORATIVE_ATTR,
  HIDDEN_ATTR,
  KEEP_ATTR,
  STYLE_ATTR,
} from './constants'

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

// ── Helpers ──────────────────────────────────────────────────────────

export const parsePx = (value: string): number => parseFloat(value) || 0

export const getContentWidth = (
  element: HTMLElement,
  style = window.getComputedStyle(element),
): number =>
  element.getBoundingClientRect().width -
  parsePx(style.borderLeftWidth) -
  parsePx(style.borderRightWidth) -
  parsePx(style.paddingLeft) -
  parsePx(style.paddingRight)

export const isKeptChild = (
  child: HTMLElement,
  keepVisibleEl: HTMLElement | undefined,
): boolean =>
  child.hasAttribute(KEEP_ATTR) ||
  (!!keepVisibleEl &&
    (child === keepVisibleEl || child.contains(keepVisibleEl)))

export const isDataChild = (
  child: HTMLElement,
  keepVisibleEl: HTMLElement | undefined,
): boolean =>
  !child.hasAttribute(DECORATIVE_ATTR) &&
  !(keepVisibleEl && (child === keepVisibleEl || child.contains(keepVisibleEl)))
