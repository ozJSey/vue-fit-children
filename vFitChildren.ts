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
 * - Detects child additions/removals via MutationObserver
 * - Uses requestAnimationFrame for batched, performant recalculation
 * - Always keeps the first child visible
 *
 * Usage:
 * <div v-fit-children="{ widthRestrictingContainer: containerRef, offsetNeededInPx: 100 }">
 *   <chip v-for="item in items" />
 * </div>
 *
 * The directive emits a 'fit-children-updated' event with details about
 * hidden children count and overflow status.
 */

interface FitChildrenState {
  mutationObserver?: MutationObserver;
  resizeObserver?: ResizeObserver;
  parentContainer?: HTMLElement;
  rafId: number | null;
  targetElement?: HTMLElement;
  offsetNeededInPx: number;
}

export type FitChildrenEventDetail = {
  hiddenChildrenCount: number;
  hiddenChildren: HTMLElement[];
  isOverflowing: boolean;
};

export interface FitChildrenOptions {
  widthRestrictingContainer?: HTMLElement;
  offsetNeededInPx?: number;
}

const MIN_OFFSET_PX = 50;
const HIDDEN_ATTR = "data-hidden-by-directive";
const EVENT_NAME = "fit-children-updated";

const stateMap = new WeakMap<HTMLElement, FitChildrenState>();

const dispatchUpdate = (
  el: HTMLElement,
  detail: FitChildrenEventDetail,
) => {
  el.dispatchEvent(new CustomEvent<FitChildrenEventDetail>(EVENT_NAME, { detail }));
};

const resetChildrenVisibility = (wrapperEl: HTMLElement) => {
  Array.from(wrapperEl.querySelectorAll(`[${HIDDEN_ATTR}]`)).forEach(
    (child) => {
      (child as HTMLElement).style.removeProperty("display");
      child.removeAttribute(HIDDEN_ATTR);
    },
  );
};

const calculateOverflow = (targetElement: HTMLElement | undefined) => {
  if (!targetElement) return;

  const state = stateMap.get(targetElement);
  if (!state) return;

  const { parentContainer, targetElement: el, offsetNeededInPx } = state;
  if (!el || !parentContainer) return;

  const { clientWidth: parentClientWidth } = parentContainer;
  const immediateChildren = Array.from(el.children) as HTMLElement[];
  let hiddenCount = 0;

  if (!immediateChildren.length) {
    dispatchUpdate(el, { hiddenChildrenCount: 0, hiddenChildren: [], isOverflowing: false });
    state.rafId = null;
    return;
  }

  if (immediateChildren.length === 1) {
    const [onlyChild] = immediateChildren;
    onlyChild.style.removeProperty("display");
    onlyChild.removeAttribute(HIDDEN_ATTR);

    dispatchUpdate(el, { hiddenChildrenCount: 0, hiddenChildren: [], isOverflowing: false });
    state.rafId = null;
    return;
  }

  resetChildrenVisibility(el);

  let isOverflowedOnce = false;
  let accumulatedTotalWidth = 0;

  const [firstChild, ...restOfChildren] = immediateChildren;
  accumulatedTotalWidth += firstChild.clientWidth;

  restOfChildren.forEach((child) => {
    const { clientWidth: childWidth } = child;
    accumulatedTotalWidth += childWidth;

    if (isOverflowedOnce) {
      child.style.display = "none";
      child.setAttribute(HIDDEN_ATTR, "true");
      hiddenCount++;
    } else if (accumulatedTotalWidth + offsetNeededInPx > parentClientWidth) {
      child.style.display = "none";
      child.setAttribute(HIDDEN_ATTR, "true");
      isOverflowedOnce = true;
      hiddenCount++;
    }
  });

  dispatchUpdate(el, {
    hiddenChildrenCount: hiddenCount,
    hiddenChildren: immediateChildren.filter((child) =>
      child.hasAttribute(HIDDEN_ATTR),
    ),
    isOverflowing: isOverflowedOnce,
  });
  state.rafId = null;
};

const scheduleOverflowCalculation = (state: FitChildrenState) => {
  if (state.rafId || !state.targetElement) return;

  state.rafId = requestAnimationFrame(() => {
    nextTick(() => {
      calculateOverflow(state.targetElement);
    });
  });
};

function handleFitChildren(
  wrapperEl: HTMLElement,
  binding: DirectiveBinding<FitChildrenOptions>,
) {
  let state = stateMap.get(wrapperEl);

  if (!state) {
    state = {
      targetElement: undefined,
      parentContainer: undefined,
      mutationObserver: undefined,
      resizeObserver: undefined,
      rafId: null,
      offsetNeededInPx: Math.max(binding.value?.offsetNeededInPx ?? MIN_OFFSET_PX, MIN_OFFSET_PX),
    };
    stateMap.set(wrapperEl, state);
  } else if (binding.value?.offsetNeededInPx !== undefined) {
    state.offsetNeededInPx = Math.max(binding.value.offsetNeededInPx, MIN_OFFSET_PX);
  }

  if (!state.targetElement && wrapperEl) {
    state.targetElement = wrapperEl;

    if (!state.mutationObserver) {
      const mutationObserver = new MutationObserver(() =>
        scheduleOverflowCalculation(state),
      );
      mutationObserver.observe(state.targetElement, { childList: true });
      state.mutationObserver = mutationObserver;
    }
  }

  if (!state.parentContainer && binding.value?.widthRestrictingContainer) {
    const container = binding.value.widthRestrictingContainer;
    state.parentContainer = container;

    if (!state.resizeObserver) {
      const resizeObserver = new ResizeObserver(() =>
        scheduleOverflowCalculation(state),
      );
      resizeObserver.observe(container);
      state.resizeObserver = resizeObserver;
    }
  }
}

export const vFitChildren: Directive = {
  beforeMount: handleFitChildren,
  updated: handleFitChildren,
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

    stateMap.delete(el);
  },
};