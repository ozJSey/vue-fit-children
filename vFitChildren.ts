import { type Directive, type DirectiveBinding } from "vue";

/**
 * A Vue directive that manages visibility of child elements within a container.
 *
 * Useful for chips, badges, tags, or any list of inline elements in a tight space.
 * Children that don't fit within the container's width are automatically hidden,
 * and a custom event is emitted with details about hidden children
 * (enabling "+N more" indicators).
 *
 * Features:
 * - Monitors the container's width via ResizeObserver
 * - Monitors individual child sizes via ResizeObserver
 * - Detects child additions/removals and content changes via MutationObserver
 * - Uses queueMicrotask for same-frame, batched recalculation
 * - Measures actual gap from rendered DOM positions (works with web components)
 * - Accounts for content overflow (overflow: visible) via scrollWidth
 * - Supports multi-row layout via `rowCount`
 * - Supports priority pinning via `keepVisibleEl` / `data-v-fit-keep`
 * - Supports hiding largest items first via `sortBySize`
 *
 * Usage:
 * <div v-fit-children="{ widthRestrictingContainer: containerRef, offsetNeededInPx: 50 }">
 *   <chip v-for="item in items" />
 * </div>
 *
 * The directive emits a 'fit-children-updated' event with details about
 * hidden children count and overflow status.
 */

interface FitChildrenState {
  childResizeObserver?: ResizeObserver;
  gapFromOption?: number;
  keepVisibleEl?: HTMLElement;
  mutationObserver?: MutationObserver;
  offsetNeededInPx: number;
  originalFlexWrap?: string;
  parentContainer?: HTMLElement;
  pendingCalc: boolean;
  resizeObserver?: ResizeObserver;
  rowCount: number;
  sortBySize: boolean;
  targetElement?: HTMLElement;
}

export type FitChildrenEventDetail = {
  hiddenChildren: HTMLElement[];
  hiddenChildrenCount: number;
  isOverflowing: boolean;
};

export interface FitChildrenOptions {
  gap?: number;
  keepVisibleEl?: HTMLElement;
  offsetNeededInPx?: number;
  rowCount?: number;
  sortBySize?: boolean;
  widthRestrictingContainer?: HTMLElement;
}

const DEFAULT_OFFSET_PX = 50;
const HIDDEN_ATTR = "data-v-fit-hidden";
const KEEP_ATTR = "data-v-fit-keep";
const EVENT_NAME = "fit-children-updated";

const stateMap = new WeakMap<HTMLElement, FitChildrenState>();

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse a CSS pixel value, returning 0 for invalid/missing values. */
const parsePx = (value: string): number => parseFloat(value) || 0;

/** Total horizontal overhead of an element (margin + border + padding). */
const getHorizontalOverhead = (style: CSSStyleDeclaration): number =>
  parsePx(style.marginLeft) +
  parsePx(style.marginRight) +
  parsePx(style.borderLeftWidth) +
  parsePx(style.borderRightWidth) +
  parsePx(style.paddingLeft) +
  parsePx(style.paddingRight);

/** Content width of an element (inner width, excluding border and padding). */
const getContentWidth = (
  el: HTMLElement,
  style: CSSStyleDeclaration = window.getComputedStyle(el),
): number =>
  el.getBoundingClientRect().width -
  parsePx(style.borderLeftWidth) -
  parsePx(style.borderRightWidth) -
  parsePx(style.paddingLeft) -
  parsePx(style.paddingRight);

/**
 * Outer width of an element including content overflow.
 * Uses Math.max(borderBoxWidth, scrollWidth + borders) so elements with
 * overflow: visible report their actual needed width, not just their box.
 */
const getOuterWidth = (el: HTMLElement): number => {
  const style = window.getComputedStyle(el);
  const borderBoxWidth = el.getBoundingClientRect().width;
  const borders =
    parsePx(style.borderLeftWidth) + parsePx(style.borderRightWidth);
  const neededWidth = el.scrollWidth + borders;
  return (
    Math.max(borderBoxWidth, neededWidth) +
    parsePx(style.marginLeft) +
    parsePx(style.marginRight)
  );
};

/**
 * Measure the actual rendered gap between the first two children.
 * This reads real DOM positions instead of trusting CSS `gap`,
 * which is unreliable with web components, margins, and Shadow DOM.
 * Falls back to CSS gap if children aren't on the same row.
 */
const measureGap = (
  children: HTMLElement[],
  elStyle: CSSStyleDeclaration,
  gapFromOption?: number,
): number => {
  if (gapFromOption !== undefined) return gapFromOption;
  if (children.length < 2) return 0;

  const rect0 = children[0].getBoundingClientRect();
  const rect1 = children[1].getBoundingClientRect();

  // Only trust DOM measurement if both children are on the same row
  const sameRow = Math.abs(rect0.top - rect1.top) < rect0.height * 0.5;
  if (sameRow && rect1.left > rect0.right) {
    const style0 = window.getComputedStyle(children[0]);
    const style1 = window.getComputedStyle(children[1]);
    // Gap = space between margin boxes
    const marginBoxRight0 = rect0.right + parsePx(style0.marginRight);
    const marginBoxLeft1 = rect1.left - parsePx(style1.marginLeft);
    return Math.max(0, marginBoxLeft1 - marginBoxRight0);
  }

  // Fallback: CSS gap value
  return parsePx(elStyle.columnGap || elStyle.gap || "0");
};

/** Whether a child should be kept visible (pinned via attribute or option). */
const isKeptChild = (
  child: HTMLElement,
  keepVisibleEl?: HTMLElement,
): boolean =>
  child.hasAttribute(KEEP_ATTR) ||
  (!!keepVisibleEl &&
    (child === keepVisibleEl || child.contains(keepVisibleEl)));

// ── Visibility ───────────────────────────────────────────────────────

const dispatchUpdate = (el: HTMLElement, detail: FitChildrenEventDetail) => {
  el.dispatchEvent(
    new CustomEvent<FitChildrenEventDetail>(EVENT_NAME, { detail }),
  );
};

const showChild = (child: HTMLElement) => {
  if (child.style.display === "none" || child.hasAttribute(HIDDEN_ATTR)) {
    child.style.removeProperty("display");
    child.removeAttribute(HIDDEN_ATTR);
  }
};

const hideChild = (child: HTMLElement) => {
  if (child.style.display !== "none") {
    child.style.setProperty("display", "none", "important");
    child.setAttribute(HIDDEN_ATTR, "true");
  }
};

// ── Overflow calculation ─────────────────────────────────────────────

const calculateOverflow = (targetElement: HTMLElement | undefined) => {
  if (!targetElement) return;

  const state = stateMap.get(targetElement);
  if (!state) return;

  const {
    parentContainer,
    targetElement: el,
    offsetNeededInPx,
    sortBySize,
    rowCount,
    keepVisibleEl,
    gapFromOption,
  } = state;

  if (!el || !parentContainer) return;

  let availableSpaceForChildren = getContentWidth(parentContainer);

  if (parentContainer !== el) {
    availableSpaceForChildren -= getHorizontalOverhead(
      window.getComputedStyle(el),
    );
  }

  const immediateChildren = Array.from(el.children) as HTMLElement[];

  // Temporarily reveal hidden children so measurements are accurate
  const previouslyHidden = el.querySelectorAll(`[${HIDDEN_ATTR}]`);
  previouslyHidden.forEach((node) => {
    const child = node as HTMLElement;
    child.style.display = "";
    child.removeAttribute(HIDDEN_ATTR);
  });

  // Measure gap from actual DOM positions, not CSS
  const elStyle = window.getComputedStyle(el);
  const gapPx = measureGap(immediateChildren, elStyle, gapFromOption);

  // Measure all children (accounts for overflow: visible via scrollWidth)
  const childWidths = immediateChildren.map(getOuterWidth);

  const totalChildWidth = childWidths.reduce(
    (sum: number, w: number, i: number) => {
      return sum + w + (i > 0 ? gapPx : 0);
    },
    0,
  );

  // If all children fit without offset, show everything (no "+N" badge needed)
  if (totalChildWidth <= availableSpaceForChildren) {
    immediateChildren.forEach(showChild);
    dispatchUpdate(el, {
      hiddenChildren: [],
      hiddenChildrenCount: 0,
      isOverflowing: false,
    });
    return;
  }

  // Build candidate indices sorted by priority: kept first, then by size/DOM order
  const candidates = Array.from(immediateChildren.keys()).sort((a, b) => {
    const aKeep = isKeptChild(immediateChildren[a], keepVisibleEl);
    const bKeep = isKeptChild(immediateChildren[b], keepVisibleEl);

    if (aKeep && !bKeep) return -1;
    if (!aKeep && bKeep) return 1;

    if (sortBySize) {
      return childWidths[a] - childWidths[b];
    }
    return a - b;
  });

  // Pack children row-by-row; offset is only reserved on the last row
  const hiddenChildren: HTMLElement[] = [];
  const visibleIndices = new Set<number>();
  const strictWidthLastRow = availableSpaceForChildren - offsetNeededInPx;
  let usedWidth = 0;
  let currentLine = 1;

  for (const index of candidates) {
    const itemWidth = childWidths[index];
    const child = immediateChildren[index];

    let gap = usedWidth === 0 ? 0 : gapPx;
    let limit =
      currentLine === rowCount
        ? strictWidthLastRow
        : availableSpaceForChildren;

    // If it doesn't fit current line, try advancing to the next line
    if (usedWidth + gap + itemWidth > limit && currentLine < rowCount) {
      currentLine++;
      usedWidth = 0;
      gap = 0;
      limit =
        currentLine === rowCount
          ? strictWidthLastRow
          : availableSpaceForChildren;
    }

    if (usedWidth + gap + itemWidth <= limit) {
      usedWidth += gap + itemWidth;
      visibleIndices.add(index);
    } else {
      // Does not fit on any available line
      if (isKeptChild(child, keepVisibleEl)) {
        usedWidth += gap + itemWidth;
        visibleIndices.add(index);
      } else if (!sortBySize) {
        break;
      }
    }
  }

  immediateChildren.forEach((child, i) => {
    if (visibleIndices.has(i)) {
      showChild(child);
    } else {
      hideChild(child);
      hiddenChildren.push(child);
    }
  });

  const isOverflowing = hiddenChildren.length > 0;

  dispatchUpdate(el, {
    hiddenChildren,
    hiddenChildrenCount: hiddenChildren.length,
    isOverflowing,
  });
};

// ── Scheduling ───────────────────────────────────────────────────────

const scheduleOverflowCalculation = (state: FitChildrenState) => {
  if (state.pendingCalc || !state.targetElement) return;

  state.pendingCalc = true;
  queueMicrotask(() => {
    state.pendingCalc = false;
    calculateOverflow(state.targetElement);
  });
};

// ── Directive lifecycle ──────────────────────────────────────────────

function handleFitChildren(
  wrapperEl: HTMLElement,
  binding: DirectiveBinding<FitChildrenOptions>,
) {
  let state = stateMap.get(wrapperEl);

  if (!state) {
    state = {
      childResizeObserver: undefined,
      gapFromOption: binding.value?.gap,
      keepVisibleEl: binding.value?.keepVisibleEl,
      mutationObserver: undefined,
      offsetNeededInPx: Math.max(
        binding.value?.offsetNeededInPx ?? DEFAULT_OFFSET_PX,
        0,
      ),
      parentContainer: undefined,
      pendingCalc: false,
      resizeObserver: undefined,
      rowCount: binding.value?.rowCount ?? 1,
      sortBySize: binding.value?.sortBySize ?? false,
      targetElement: undefined,
    };
    stateMap.set(wrapperEl, state);
  } else {
    let needsUpdate = false;
    if (binding.value?.gap !== state.gapFromOption) {
      state.gapFromOption = binding.value?.gap;
      needsUpdate = true;
    }
    if (
      binding.value?.offsetNeededInPx !== undefined &&
      binding.value.offsetNeededInPx !== state.offsetNeededInPx
    ) {
      state.offsetNeededInPx = Math.max(binding.value.offsetNeededInPx, 0);
      needsUpdate = true;
    }
    if (
      binding.value?.sortBySize !== undefined &&
      binding.value.sortBySize !== state.sortBySize
    ) {
      state.sortBySize = binding.value.sortBySize;
      needsUpdate = true;
    }
    if (
      binding.value?.rowCount !== undefined &&
      binding.value.rowCount !== state.rowCount
    ) {
      state.rowCount = Math.max(binding.value.rowCount, 1);
      needsUpdate = true;
    }
    if (binding.value?.keepVisibleEl !== state.keepVisibleEl) {
      state.keepVisibleEl = binding.value?.keepVisibleEl;
      needsUpdate = true;
    }

    if (needsUpdate) {
      scheduleOverflowCalculation(state);
    }
  }

  if (!state.targetElement && wrapperEl) {
    state.targetElement = wrapperEl;

    if (!state.childResizeObserver) {
      const s = state;
      const childResizeObserver = new ResizeObserver(() =>
        scheduleOverflowCalculation(s),
      );

      Array.from(state.targetElement.children).forEach((child) =>
        childResizeObserver.observe(child),
      );
      state.childResizeObserver = childResizeObserver;
    }

    if (!state.mutationObserver) {
      const s = state;
      const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          m.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              s.childResizeObserver?.observe(node);
            }
          });

          m.removedNodes.forEach((node) => {
            if (node instanceof Element) {
              s.childResizeObserver?.unobserve(node);
            }
          });
        });
        scheduleOverflowCalculation(s);
      });
      mutationObserver.observe(state.targetElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      state.mutationObserver = mutationObserver;
    }
  }

  // Use provided container or fallback to the directive's element
  const container = binding.value?.widthRestrictingContainer || wrapperEl;
  if (!state.parentContainer || state.parentContainer !== container) {
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver = undefined;
    }

    state.parentContainer = container;

    if (!state.resizeObserver) {
      const s = state;
      const resizeObserver = new ResizeObserver(() =>
        scheduleOverflowCalculation(s),
      );
      resizeObserver.observe(container);
      state.resizeObserver = resizeObserver;
    }
  }

  // Ensure flex-wrap is enabled if multiple rows are allowed
  if (state.rowCount > 1 && wrapperEl.style.flexWrap !== "wrap") {
    state.originalFlexWrap = wrapperEl.style.flexWrap;
    wrapperEl.style.setProperty("flex-wrap", "wrap");
  }
}

export const vFitChildren: Directive = {
  beforeMount: handleFitChildren,
  beforeUnmount(el: HTMLElement) {
    const state = stateMap.get(el);
    if (!state) return;

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
    }

    if (state.childResizeObserver) {
      state.childResizeObserver.disconnect();
    }

    // Restore hidden children so they're not stuck with display:none
    const hiddenChildren = el.querySelectorAll(`[${HIDDEN_ATTR}]`);
    hiddenChildren.forEach((node) => showChild(node as HTMLElement));

    // Restore original flex-wrap if we set it
    if (state.originalFlexWrap !== undefined) {
      if (state.originalFlexWrap) {
        el.style.setProperty("flex-wrap", state.originalFlexWrap);
      } else {
        el.style.removeProperty("flex-wrap");
      }
    }

    stateMap.delete(el);
  },
  updated: handleFitChildren,
};
