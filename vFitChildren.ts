import { type Directive, type DirectiveBinding, nextTick } from "vue";

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
 * - Detects child additions/removals via MutationObserver
 * - Uses requestAnimationFrame for batched, performant recalculation
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
  cachedWidths: number[];
  cacheValid: boolean;
  childResizeObserver?: ResizeObserver;
  gapFromOption?: number;
  gapPx: number;
  keepVisibleEl?: HTMLElement;
  mutationObserver?: MutationObserver;
  offsetNeededInPx: number;
  parentContainer?: HTMLElement;
  rafId: number | null;
  resizeObserver?: ResizeObserver;
  rowCount: number;
  sortBySize: boolean;
  targetElement?: HTMLElement;
  totalChildWidth: number;
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

/** Outer width of an element (bounding rect width + horizontal margins). */
const getOuterWidth = (el: HTMLElement): number => {
  const style = window.getComputedStyle(el);
  return (
    el.getBoundingClientRect().width +
    parsePx(style.marginLeft) +
    parsePx(style.marginRight)
  );
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
  // If explicitly hidden by us, or currently display:none, reveal it.
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

// ── Measurement ──────────────────────────────────────────────────────

const updateMeasurements = (state: FitChildrenState) => {
  const { targetElement: el } = state;
  if (!el) return;

  const children = Array.from(el.children) as HTMLElement[];

  // Temporarily reveal hidden children so measurements are accurate
  const previouslyHidden = el.querySelectorAll(`[${HIDDEN_ATTR}]`);
  previouslyHidden.forEach((node) => {
    const child = node as HTMLElement;
    child.style.display = "";
    child.removeAttribute(HIDDEN_ATTR);
  });

  const style = window.getComputedStyle(el);
  const computedGap = parsePx(style.columnGap || style.gap || "0");
  state.gapPx =
    state.gapFromOption !== undefined ? state.gapFromOption : computedGap;

  state.cachedWidths = children.map(getOuterWidth);

  state.totalChildWidth = state.cachedWidths.reduce((sum, w, i) => {
    return sum + w + (i > 0 ? state.gapPx : 0);
  }, 0);

  state.cacheValid = true;
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
  } = state;

  if (!el || !parentContainer) {
    state.rafId = null;
    return;
  }

  let availableSpaceForChildren = getContentWidth(parentContainer);

  if (parentContainer !== el) {
    availableSpaceForChildren -= getHorizontalOverhead(
      window.getComputedStyle(el),
    );
  }

  const immediateChildren = Array.from(el.children) as HTMLElement[];

  if (
    !state.cacheValid ||
    state.cachedWidths.length !== immediateChildren.length
  ) {
    updateMeasurements(state);
  }

  // If all children fit without offset, show everything (no "+N" badge needed)
  if (state.totalChildWidth <= availableSpaceForChildren) {
    immediateChildren.forEach(showChild);
    dispatchUpdate(el, {
      hiddenChildren: [],
      hiddenChildrenCount: 0,
      isOverflowing: false,
    });
    state.rafId = null;
    return;
  }

  // Build candidate indices sorted by priority: kept first, then by size/DOM order
  const candidates = Array.from(immediateChildren.keys()).sort((a, b) => {
    const aKeep = isKeptChild(immediateChildren[a], keepVisibleEl);
    const bKeep = isKeptChild(immediateChildren[b], keepVisibleEl);

    if (aKeep && !bKeep) return -1;
    if (!aKeep && bKeep) return 1;

    if (sortBySize) {
      return state.cachedWidths[a] - state.cachedWidths[b];
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
    const itemWidth = state.cachedWidths[index];
    const child = immediateChildren[index];

    let gap = usedWidth === 0 ? 0 : state.gapPx;
    let limit =
      currentLine === rowCount
        ? strictWidthLastRow
        : availableSpaceForChildren;

    // If it doesn't fit current line, try next line
    if (usedWidth + gap + itemWidth > limit) {
      if (currentLine < rowCount) {
        currentLine++;
        usedWidth = 0;
        gap = 0;
        limit =
          currentLine === rowCount
            ? strictWidthLastRow
            : availableSpaceForChildren;
      }
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

  dispatchUpdate(el, {
    hiddenChildren,
    hiddenChildrenCount: hiddenChildren.length,
    isOverflowing: true,
  });
  state.rafId = null;
};

// ── Scheduling ───────────────────────────────────────────────────────

const scheduleOverflowCalculation = (
  state: FitChildrenState,
  invalidateCache = false,
) => {
  if (invalidateCache) state.cacheValid = false;

  if (state.rafId || !state.targetElement) return;

  state.rafId = requestAnimationFrame(() => {
    nextTick(() => {
      calculateOverflow(state.targetElement);
    });
  });
};

const handleChildResize = (
  entries: ResizeObserverEntry[],
  state: FitChildrenState,
) => {
  if (!state.cacheValid || !state.targetElement) return;

  const children = Array.from(state.targetElement.children);

  const needsRecalc = entries.some((entry) => {
    const index = children.indexOf(entry.target);
    if (index === -1) return false;
    const currentOuterWidth = getOuterWidth(entry.target as HTMLElement);
    return Math.abs(currentOuterWidth - (state.cachedWidths[index] || 0)) > 1;
  });

  if (needsRecalc) {
    scheduleOverflowCalculation(state, true);
  }
};

// ── Directive lifecycle ──────────────────────────────────────────────

function handleFitChildren(
  wrapperEl: HTMLElement,
  binding: DirectiveBinding<FitChildrenOptions>,
) {
  let state = stateMap.get(wrapperEl);

  if (!state) {
    state = {
      cachedWidths: [],
      cacheValid: false,
      childResizeObserver: undefined,
      gapFromOption: binding.value?.gap,
      gapPx: 0,
      keepVisibleEl: binding.value?.keepVisibleEl,
      mutationObserver: undefined,
      offsetNeededInPx: Math.max(
        binding.value?.offsetNeededInPx ?? DEFAULT_OFFSET_PX,
        0,
      ),
      parentContainer: undefined,
      rafId: null,
      resizeObserver: undefined,
      rowCount: binding.value?.rowCount ?? 1,
      sortBySize: binding.value?.sortBySize ?? false,
      targetElement: undefined,
      totalChildWidth: 0,
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
      scheduleOverflowCalculation(state, false);
    }
  }

  if (!state.targetElement && wrapperEl) {
    state.targetElement = wrapperEl;

    if (!state.childResizeObserver) {
      const childResizeObserver = new ResizeObserver((entries) =>
        handleChildResize(entries, state!), // Safe because we just set stateMap
      );

      Array.from(state.targetElement.children).forEach((child) =>
        childResizeObserver.observe(child),
      );
      state.childResizeObserver = childResizeObserver;
    }

    if (!state.mutationObserver) {
      const mutationObserver = new MutationObserver((mutations) => {
        if (!state) return;
        mutations.forEach((m) => {
          m.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              state.childResizeObserver?.observe(node);
            }
          });

          m.removedNodes.forEach((node) => {
            if (node instanceof Element) {
              state.childResizeObserver?.unobserve(node);
            }
          });
        });
        scheduleOverflowCalculation(state, true);
      });
      mutationObserver.observe(state.targetElement, { childList: true });
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
      const resizeObserver = new ResizeObserver(() =>
        scheduleOverflowCalculation(state!),
      );
      resizeObserver.observe(container);
      state.resizeObserver = resizeObserver;
    }
  }

  // Ensure flex-wrap is enabled if multiple rows are allowed
  if (state.rowCount > 1 && wrapperEl.style.flexWrap !== "wrap") {
    wrapperEl.style.setProperty("flex-wrap", "wrap");
  }
}

export const vFitChildren: Directive = {
  beforeMount: handleFitChildren,
  beforeUnmount(el: HTMLElement) {
    const state = stateMap.get(el);
    if (!state) return;

    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
    }

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
    }

    if (state.childResizeObserver) {
      state.childResizeObserver.disconnect();
    }

    stateMap.delete(el);
  },
  updated: handleFitChildren,
};
