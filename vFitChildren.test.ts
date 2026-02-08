// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { type FitChildrenEventDetail, vFitChildren } from "./vFitChildren";

// --- Mock ResizeObserver ---

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    MockResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger() {
    this.callback([] as any, this as any);
  }

  static reset() {
    this.instances = [];
  }
}

// --- Mock MutationObserver ---

class MockMutationObserver {
  static instances: MockMutationObserver[] = [];
  callback: MutationCallback;

  constructor(cb: MutationCallback) {
    this.callback = cb;
    MockMutationObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }

  trigger() {
    this.callback([] as any, this as any);
  }

  static reset() {
    this.instances = [];
  }
}

// --- Mock requestAnimationFrame ---

let rafCallbacks: Map<number, FrameRequestCallback> = new Map();
let nextRafId = 1;

function mockRaf(cb: FrameRequestCallback): number {
  const id = nextRafId++;
  rafCallbacks.set(id, cb);
  return id;
}

function mockCancelRaf(id: number) {
  rafCallbacks.delete(id);
}

function flushRaf() {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  cbs.forEach((cb) => cb(16));
}

async function flush() {
  flushRaf();
  await nextTick();
}

// --- Helpers ---

function setClientWidth(el: HTMLElement, width: number) {
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
  // Also mock getBoundingClientRect as the directive uses it now
  el.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => {},
    top: 0,
    width,
    x: 0,
    y: 0,
  });
}

function createContainer(width: number): HTMLElement {
  const el = document.createElement("div");
  setClientWidth(el, width);
  return el;
}

function createWrapper(childWidths: number[]): HTMLElement {
  const wrapper = document.createElement("div");
  childWidths.forEach((width) => {
    const child = document.createElement("span");
    setClientWidth(child, width);
    wrapper.appendChild(child);
  });
  return wrapper;
}

function mountDirective(wrapper: HTMLElement, options: any) {
  const binding = {
    arg: undefined,
    dir: vFitChildren,
    instance: null,
    modifiers: {},
    oldValue: undefined,
    value: options,
  };
  (vFitChildren as any).beforeMount(wrapper, binding);
  return binding;
}

function unmountDirective(wrapper: HTMLElement) {
  (vFitChildren as any).beforeUnmount(wrapper);
}

function captureEvents(wrapper: HTMLElement): FitChildrenEventDetail[] {
  const events: FitChildrenEventDetail[] = [];
  wrapper.addEventListener("fit-children-updated", ((
    e: CustomEvent<FitChildrenEventDetail>,
  ) => {
    events.push(e.detail);
  }) as EventListener);
  return events;
}

async function triggerResize() {
  MockResizeObserver.instances.forEach((i) => i.trigger());
  await flush();
}

async function triggerMutation() {
  MockMutationObserver.instances.forEach((i) => i.trigger());
  await flush();
}

// --- Tests ---

describe("vFitChildren", () => {
  beforeEach(() => {
    MockResizeObserver.reset();
    MockMutationObserver.reset();
    rafCallbacks.clear();
    nextRafId = 1;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    vi.stubGlobal("requestAnimationFrame", mockRaf);
    vi.stubGlobal("cancelAnimationFrame", mockCancelRaf);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides children that overflow the container", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    // child 0: 80 (always visible)
    // child 1: 80+80=160, 160+50=210 > 200 -> hidden
    // children 2,3: already overflowed -> hidden
    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).toBe("none");
    expect(children[3].style.display).toBe("none");

    expect(events).toHaveLength(1);
    expect(events[0].hiddenChildrenCount).toBe(3);
    expect(events[0].isOverflowing).toBe(true);
    expect(events[0].hiddenChildren).toHaveLength(3);
  });

  it("hides the first child if it does not fit (strict fit)", async () => {
    const container = createContainer(10); // very small
    const wrapper = createWrapper([100, 50, 50]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 0, // Even with 0 offset, 100 > 10
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    // Strict fit: First child (100) > Container (10) -> Hidden.
    expect(children[0].style.display).toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(3);
  });

  it("hides a single child if it overflows (strict fit)", async () => {
    const container = createContainer(50);
    const wrapper = createWrapper([200]); // wider than container
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].isOverflowing).toBe(true);
  });

  it("dispatches event with zero counts for no children", async () => {
    const container = createContainer(200);
    const wrapper = document.createElement("div"); // empty
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].hiddenChildren).toHaveLength(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  it("does not hide items if they fit but offset would overflow (smart fit)", async () => {
    const container = createContainer(200);
    // items: 80, 80 = 160 total.
    // 160 + 50 (offset) = 210 > 200.
    // OLD behavior: Hidden because we naively reserved 50px.
    // NEW behavior: 160 <= 200, so we show everything (no badge needed).
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {widthRestrictingContainer: container});
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    // Smart fit -> all visible
    expect(children[1].style.display).not.toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(0);
  });

  it("allows offset of zero", async () => {
    const container = createContainer(200);
    // child 0=80, child 1: 80+80=160, 160+0=160 < 200 -> visible
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(0);
  });

  it("shows previously hidden children when container grows", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    // Initially: child0=80, child1=160, 160+50=210>200 -> 2 hidden
    expect(events[0].hiddenChildrenCount).toBe(2);

    // Grow container
    setClientWidth(container, 500);
    await triggerResize();

    // Now all fit: child1=160+50=210<500, child2=240+50=290<500
    expect(events[1].hiddenChildrenCount).toBe(0);
    expect(events[1].isOverflowing).toBe(false);

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).not.toBe("none");
  });

  it("does not re-measure widths on resize (uses cache)", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    // Replace getBoundingClientRect with tracked getters because directive uses getOuterWidth
    let measureCount = 0;
    const children = Array.from(wrapper.children) as HTMLElement[];
    children.forEach((child) => {
      const original = child.getBoundingClientRect.bind(child);
      vi.spyOn(child, "getBoundingClientRect").mockImplementation(() => {
        measureCount++;
        return original();
      });
    });

    // Trigger resize — should use cache, not re-measure
    setClientWidth(container, 300);
    await triggerResize();

    expect(measureCount).toBe(0);
  });

  it("re-measures widths on mutation (cache invalidated)", async () => {
    const container = createContainer(300);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize(); // initial

    // Add a new child
    const newChild = document.createElement("span");
    setClientWidth(newChild, 80);
    wrapper.appendChild(newChild);

    // Track measurements on all children
    let measureCount = 0;
    Array.from(wrapper.children).forEach((child) => {
      const original = child.getBoundingClientRect;
      child.getBoundingClientRect = () => {
        measureCount++;
        return original.call(child);
      };
    });

    // Trigger mutation — should invalidate cache and re-measure
    await triggerMutation();

    expect(measureCount).toBeGreaterThan(0);
  });

  it("batches multiple triggers into one calculation", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });

    // Trigger all resize observers (container + children)
    // The previous test code assumed instances[0] was container, but now it might be child observer
    MockResizeObserver.instances.forEach(obs => obs.trigger());
    MockResizeObserver.instances.forEach(obs => obs.trigger());
    MockResizeObserver.instances.forEach(obs => obs.trigger());

    await flush();

    // rAF dedup: should only calculate once
    expect(events).toHaveLength(1);
  });

  it("marks hidden children with data-v-fit-hidden attribute", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].hasAttribute("data-v-fit-hidden")).toBe(false);
    expect(children[1].getAttribute("data-v-fit-hidden")).toBe("true");
    expect(children[2].getAttribute("data-v-fit-hidden")).toBe("true");
  });

  it("cleans up observers on unmount", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    await triggerResize();

    const resizeObs = MockResizeObserver.instances[0];
    const mutationObs = MockMutationObserver.instances[0];
    const resizeDisconnect = vi.spyOn(resizeObs, "disconnect");
    const mutationDisconnect = vi.spyOn(mutationObs, "disconnect");

    unmountDirective(wrapper);

    expect(resizeDisconnect).toHaveBeenCalled();
    expect(mutationDisconnect).toHaveBeenCalled();
  });

  it("cancels pending rAF on unmount", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, { widthRestrictingContainer: container });

    // Trigger all observers
    MockResizeObserver.instances.forEach(obs => obs.trigger());

    const cancelSpy = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);

    unmountDirective(wrapper);

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("event hiddenChildren references the actual hidden DOM elements", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(events[0].hiddenChildren).toContain(children[1]);
    expect(events[0].hiddenChildren).toContain(children[2]);
    expect(events[0].hiddenChildren).not.toContain(children[0]);
  });

  it("keeps all children visible when they fit", async () => {
    const container = createContainer(500);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    children.forEach((child) => {
      expect(child.style.display).not.toBe("none");
    });
    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  it("maximizes visible items when sortBySize is true", async () => {
    const container = createContainer(200);
    // Items: 80 (always visible), 100 (large), 30 (small), 30 (small)
    // Sequential: 80 + 100 + 30 + 30.
    // 80 + 100 (gap 0) = 180. Offset 50 -> 230 > 200. Hides 100.
    // Continuing sequential... actually if 100 is hidden, standard sequential stops or hides rest?
    // Current logic: it iterates index 1..N. If overflowedOnce, hide.
    // So 100 hides. Then 30 hides. Then 30 hides.
    // Result sequential: Only 80 visible.

    // Sorted: 80 (fixed). Candidates: [100, 30, 30] -> Sorted width: [30, 30, 100]
    // 80 + 30 = 110. Fits. 
    // 110 + 30 = 140. Fits.
    // 140 + 100 + 50(offset) = 290 > 200. Fail.
    // Result sorted: 80, 30, 30 visible.
    
    const wrapper = createWrapper([80, 100, 30, 30]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      sortBySize: true,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none"); // 80
    expect(children[1].style.display).toBe("none");     // 100 (hidden)
    expect(children[2].style.display).not.toBe("none"); // 30
    expect(children[3].style.display).not.toBe("none"); // 30

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].hiddenChildren).toHaveLength(1);
    expect(events[0].hiddenChildren[0]).toBe(children[1]);
  });

  it("accounts for gap in calculation", async () => {
    const container = createContainer(200);
    // Items: 80, 80. Gap 50. Total 80 + 50 + 80 = 210 > 200.
    // Must hide 2nd item due to gap pushing it over.
    
    const wrapper = createWrapper([80, 80]);
    
    // Mock getComputedStyle for gap
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      columnGap: "50px",
      gap: "50px",
    } as any);

    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).toBe("none"); 

    expect(events[0].hiddenChildrenCount).toBe(1);
    
    spy.mockRestore(); // Restore so next tests don't have gap!
  });

  it("prioritizes elements with data-v-fit-keep", async () => {
    const container = createContainer(200);
    // [100, 100, 100]. Container 200.
    // Normal sequential: 100 fits. 100+100=200 fits. 3rd 100 fails.
    // Result: [Show, Show, Hide].
    //
    // Setup: [Item 1(100), Item 2(100), Item 3(100) + KEEP]
    // Candidates sorted: [2, 0, 1].
    // 1. Index 2 (100). Fits. Used=100.
    // 2. Index 0 (100). Fits. Used=200.
    // 3. Index 1 (100). Fails.
    // Result: [Show, Hide, Show].
    const wrapper = createWrapper([100, 100, 100]);
    wrapper.children[2].setAttribute("data-v-fit-keep", "true");
    
    mountDirective(wrapper, { offsetNeededInPx: 0, widthRestrictingContainer: container });
    // Trigger multiple times to ensure robust calc
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    // console.log("Child 0 display:", children[0].style.display);
    // console.log("Child 1 display:", children[1].style.display);
    // console.log("Child 2 display:", children[2].style.display);
    
    expect(children[2].style.display).not.toBe("none"); // Priority kept
    expect(children[0].style.display).not.toBe("none"); // Normal fit
    expect(children[1].style.display).toBe("none");     // Hidden
  });

  it("keeps a direct child visible via keepVisibleEl option", async () => {
    const container = createContainer(200);
    // [100, 100, 100]. Container 200, offset 0.
    // Normal: child0(100) fits, child1(100) fits (200<=200), child2 doesn't.
    // With keepVisibleEl=child2: child2 is prioritized first.
    // Sorted candidates: [2, 0, 1].
    // i=2 (100): fits. used=100.
    // i=0 (100): 100+100=200 <= 200. fits. used=200.
    // i=1 (100): 200+100=300 > 200. Break.
    // Result: child0 visible, child1 hidden, child2 visible.
    const wrapper = createWrapper([100, 100, 100]);
    const inputChild = wrapper.children[2] as HTMLElement;
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: inputChild,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).not.toBe("none"); // kept via option

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].hiddenChildren[0]).toBe(children[1]);
  });

  it("keeps a parent child visible when keepVisibleEl is a nested descendant", async () => {
    // Simulates: <div v-fit-children><span>Tag</span><div class="wrapper"><input /></div></div>
    // keepVisibleEl points to the nested <input>, but the directive child is the wrapper <div>.
    const container = createContainer(200);
    const wrapper = document.createElement("div");

    const tag = document.createElement("span");
    setClientWidth(tag, 100);
    wrapper.appendChild(tag);

    const inputWrapper = document.createElement("div");
    const input = document.createElement("input");
    inputWrapper.appendChild(input);
    setClientWidth(inputWrapper, 100);
    setClientWidth(input, 80);
    wrapper.appendChild(inputWrapper);

    const tag2 = document.createElement("span");
    setClientWidth(tag2, 100);
    wrapper.appendChild(tag2);

    // [tag(100), inputWrapper(100), tag2(100)]. Container 200, offset 0.
    // keepVisibleEl=input (nested inside inputWrapper).
    // inputWrapper.contains(input) === true -> inputWrapper is kept.
    // Sorted candidates: [1(keep), 0, 2].
    // i=1 (100): fits. used=100.
    // i=0 (100): 100+100=200 <= 200. fits. used=200.
    // i=2 (100): 200+100=300 > 200. Break.
    // Result: tag visible, inputWrapper visible, tag2 hidden.
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: input,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none"); // tag fits
    expect(children[1].style.display).not.toBe("none"); // inputWrapper kept (contains input)
    expect(children[2].style.display).toBe("none");     // tag2 hidden

    expect(events[0].hiddenChildrenCount).toBe(1);
  });

  it("force-keeps keepVisibleEl even when it exceeds available space", async () => {
    const container = createContainer(100);
    // [80, 150]. Container 100, offset 0.
    // keepVisibleEl=child1 (150px, wider than container).
    // Sorted candidates: [1(keep), 0].
    // i=1 (150): 150 > 100. Doesn't fit, but isKeep -> force-add. used=150.
    // i=0 (80): 150+80=230 > 100. Break.
    // Result: child0 hidden, child1 visible (even though it overflows).
    const wrapper = createWrapper([80, 150]);
    const keepEl = wrapper.children[1] as HTMLElement;
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: keepEl,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).toBe("none");     // hidden, no room
    expect(children[1].style.display).not.toBe("none"); // force-kept

    expect(events[0].hiddenChildrenCount).toBe(1);
  });
});
