// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// --- Mock queueMicrotask ---

let microtaskCallbacks: (() => void)[] = [];

function mockQueueMicrotask(cb: () => void) {
  microtaskCallbacks.push(cb);
}

function flushMicrotasks() {
  while (microtaskCallbacks.length > 0) {
    const cbs = [...microtaskCallbacks];
    microtaskCallbacks = [];
    cbs.forEach((cb) => cb());
  }
}

// --- Helpers ---

function setClientWidth(el: HTMLElement, width: number) {
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
  el.getBoundingClientRect = () => ({
    bottom: 20,
    height: 20,
    left: 0,
    right: width,
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

function updateDirective(wrapper: HTMLElement, binding: any) {
  (vFitChildren as any).updated(wrapper, binding);
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
  flushMicrotasks();
}

// --- Tests ---

describe("vFitChildren", () => {
  beforeEach(() => {
    MockResizeObserver.reset();
    MockMutationObserver.reset();
    microtaskCallbacks = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    vi.stubGlobal("queueMicrotask", mockQueueMicrotask);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Basic overflow ─────────────────────────────────────────────────

  it("hides children that overflow the container", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

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
    const container = createContainer(10);
    const wrapper = createWrapper([100, 50, 50]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(3);
  });

  it("hides a single child if it overflows (strict fit)", async () => {
    const container = createContainer(50);
    const wrapper = createWrapper([200]);
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
    const wrapper = document.createElement("div");
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].hiddenChildren).toHaveLength(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  // ── Smart fit ──────────────────────────────────────────────────────

  it("does not hide items if they fit but offset would overflow (smart fit)", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(0);
  });

  it("allows offset of zero", async () => {
    const container = createContainer(200);
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

  // ── Responsive ─────────────────────────────────────────────────────

  it("shows previously hidden children when container grows", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(2);

    setClientWidth(container, 500);
    await triggerResize();

    expect(events[1].hiddenChildrenCount).toBe(0);
    expect(events[1].isOverflowing).toBe(false);

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).not.toBe("none");
  });

  it("re-measures all children on every recalculation", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    let measureCount = 0;
    const children = Array.from(wrapper.children) as HTMLElement[];
    children.forEach((child) => {
      const original = child.getBoundingClientRect.bind(child);
      vi.spyOn(child, "getBoundingClientRect").mockImplementation(() => {
        measureCount++;
        return original();
      });
    });

    setClientWidth(container, 300);
    await triggerResize();

    expect(measureCount).toBeGreaterThan(0);
  });

  it("recalculates when a child's size changes via ResizeObserver", async () => {
    const container = createContainer(300);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);

    // Child grows (e.g. dropdown selection changes text)
    const children = Array.from(wrapper.children) as HTMLElement[];
    setClientWidth(children[1], 200);

    // Child ResizeObserver fires
    await triggerResize();

    expect(events[1].isOverflowing).toBe(true);
    expect(events[1].hiddenChildrenCount).toBeGreaterThan(0);
  });

  // ── Batching & performance ─────────────────────────────────────────

  it("batches multiple triggers into one calculation", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });

    MockResizeObserver.instances.forEach((obs) => obs.trigger());
    MockResizeObserver.instances.forEach((obs) => obs.trigger());
    MockResizeObserver.instances.forEach((obs) => obs.trigger());

    flushMicrotasks();

    expect(events).toHaveLength(1);
  });

  // ── Attributes ─────────────────────────────────────────────────────

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

  // ── Cleanup ────────────────────────────────────────────────────────

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

  it("pending microtask after unmount does not crash", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, { widthRestrictingContainer: container });

    // Trigger without flushing — microtask is pending
    MockResizeObserver.instances.forEach((obs) => obs.trigger());

    unmountDirective(wrapper);

    // Flushing after unmount should not throw
    expect(() => flushMicrotasks()).not.toThrow();
  });

  it("restores hidden children on unmount", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).toBe("none");

    unmountDirective(wrapper);

    // Children should be visible again after unmount
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).not.toBe("none");
    expect(children[1].hasAttribute("data-v-fit-hidden")).toBe(false);
    expect(children[2].hasAttribute("data-v-fit-hidden")).toBe(false);
  });

  it("restores flex-wrap on unmount when rowCount > 1", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, {
      rowCount: 2,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(wrapper.style.flexWrap).toBe("wrap");

    unmountDirective(wrapper);

    expect(wrapper.style.flexWrap).toBe("");
  });

  // ── Event details ──────────────────────────────────────────────────

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

  // ── sortBySize ─────────────────────────────────────────────────────

  it("maximizes visible items when sortBySize is true", async () => {
    const container = createContainer(200);
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
    expect(children[1].style.display).toBe("none"); // 100 (hidden — largest)
    expect(children[2].style.display).not.toBe("none"); // 30
    expect(children[3].style.display).not.toBe("none"); // 30

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].hiddenChildren[0]).toBe(children[1]);
  });

  // ── Gap ────────────────────────────────────────────────────────────

  it("measures gap from actual DOM positions between children", async () => {
    const container = createContainer(165);
    const wrapper = document.createElement("div");

    // Child 0: 80px wide at position left=0
    const child0 = document.createElement("span");
    child0.getBoundingClientRect = () => ({
      bottom: 20, height: 20, left: 0, right: 80,
      toJSON: () => {}, top: 0, width: 80, x: 0, y: 0,
    });
    Object.defineProperty(child0, "scrollWidth", {
      configurable: true, value: 80,
    });

    // Child 1: 80px wide at position left=90 (10px gap from DOM)
    const child1 = document.createElement("span");
    child1.getBoundingClientRect = () => ({
      bottom: 20, height: 20, left: 90, right: 170,
      toJSON: () => {}, top: 0, width: 80, x: 90, y: 0,
    });
    Object.defineProperty(child1, "scrollWidth", {
      configurable: true, value: 80,
    });

    wrapper.appendChild(child0);
    wrapper.appendChild(child1);

    const events = captureEvents(wrapper);

    // With 10px DOM gap: 80 + 10 + 80 = 170 > 165 → overflow
    // Without gap: 80 + 80 = 160 ≤ 165 → smart fit (all visible)
    // This test proves DOM-based gap measurement works
    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].isOverflowing).toBe(true);
  });

  it("falls back to CSS gap when children are not on the same row", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

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

    spy.mockRestore();
  });

  it("uses gap option over DOM measurement and CSS gap", async () => {
    const container = createContainer(200);
    // Items: 80, 80. Manual gap=0. Total=160 ≤ 200 → all visible
    const wrapper = createWrapper([80, 80]);

    // Even if CSS gap is huge, the option should override
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      columnGap: "500px",
      gap: "500px",
    } as any);

    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      gap: 0,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);

    spy.mockRestore();
  });

  // ── Overflow: visible (scrollWidth) ────────────────────────────────

  it("accounts for scrollWidth when child content overflows its box", async () => {
    const container = createContainer(170);
    const wrapper = document.createElement("div");

    // Child 0: box width 60px, but scrollWidth 120px (overflow: visible)
    const child0 = document.createElement("span");
    setClientWidth(child0, 60);
    Object.defineProperty(child0, "scrollWidth", {
      configurable: true, value: 120,
    });

    // Child 1: normal 60px box
    const child1 = document.createElement("span");
    setClientWidth(child1, 60);

    wrapper.appendChild(child0);
    wrapper.appendChild(child1);

    const events = captureEvents(wrapper);

    // Without scrollWidth: 60 + 60 = 120 ≤ 170 → smart fit, all visible
    // With scrollWidth: getOuterWidth(child0) = max(60, 120) = 120
    // Total: 120 + 60 = 180 > 170 → overflow
    // Available: 170 - 50 = 120. child0 fits (120 ≤ 120). child1: 120+60=180 > 120 → hidden.
    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].isOverflowing).toBe(true);
  });

  // ── keepVisibleEl ──────────────────────────────────────────────────

  it("prioritizes elements with data-v-fit-keep", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([100, 100, 100]);
    wrapper.children[2].setAttribute("data-v-fit-keep", "true");

    mountDirective(wrapper, {
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[2].style.display).not.toBe("none"); // Priority kept
    expect(children[0].style.display).not.toBe("none"); // Normal fit
    expect(children[1].style.display).toBe("none"); // Hidden
  });

  it("keeps a direct child visible via keepVisibleEl option", async () => {
    const container = createContainer(200);
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
    expect(children[2].style.display).not.toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].hiddenChildren[0]).toBe(children[1]);
  });

  it("keeps a parent child visible when keepVisibleEl is a nested descendant", async () => {
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

    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: input,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(1);
  });

  it("force-keeps keepVisibleEl even when it exceeds available space", async () => {
    const container = createContainer(100);
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
    expect(children[0].style.display).toBe("none");
    expect(children[1].style.display).not.toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(1);
  });

  // ── Multi-row layout ──────────────────────────────────────────────

  it("fills multiple rows before hiding with rowCount=2", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      rowCount: 2,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none"); // Row 1
    expect(children[1].style.display).not.toBe("none"); // Row 1
    expect(children[2].style.display).not.toBe("none"); // Row 2
    expect(children[3].style.display).toBe("none"); // Overflow

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].isOverflowing).toBe(true);
  });

  it("reserves offset only on the last row", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([180, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      rowCount: 2,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none"); // Row 1 (180 fits full 200)
    expect(children[1].style.display).not.toBe("none"); // Row 2 (80+50=130≤200)

    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  it("sets flex-wrap: wrap when rowCount > 1", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, {
      rowCount: 2,
      widthRestrictingContainer: container,
    });

    expect(wrapper.style.flexWrap).toBe("wrap");
  });

  it("does not set flex-wrap when rowCount is 1", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, {
      rowCount: 1,
      widthRestrictingContainer: container,
    });

    expect(wrapper.style.flexWrap).not.toBe("wrap");
  });

  it("correctly places items on new row when they overflow current row", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([150, 150, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      rowCount: 2,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none"); // Row 1
    expect(children[1].style.display).not.toBe("none"); // Row 2 (re-checked on new row)
    expect(children[2].style.display).toBe("none"); // Overflow

    expect(events[0].hiddenChildrenCount).toBe(1);
  });

  it("reports isOverflowing=false when all items fit across multiple rows", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([150, 150]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      rowCount: 2,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).not.toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  // ── Updated hook (reactive options) ───────────────────────────────

  it("recalculates when rowCount changes via updated hook", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const events = captureEvents(wrapper);

    const binding = mountDirective(wrapper, {
      offsetNeededInPx: 50,
      rowCount: 1,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(3); // Only first child fits

    // Change rowCount to 2
    binding.value = { ...binding.value, rowCount: 2 };
    updateDirective(wrapper, binding);
    flushMicrotasks();

    expect(events[1].hiddenChildrenCount).toBeLessThan(
      events[0].hiddenChildrenCount,
    );
  });

  it("recalculates when offsetNeededInPx changes via updated hook", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    const binding = mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    // Smart fit: 160 ≤ 200, all visible
    expect(events[0].hiddenChildrenCount).toBe(0);

    // Now increase offset to something that actually forces overflow
    setClientWidth(container, 170);
    await triggerResize();

    // 160 ≤ 170, still smart fit
    expect(events[1].hiddenChildrenCount).toBe(0);

    // Change offset to 0 and shrink container to force overflow
    setClientWidth(container, 150);
    binding.value = { ...binding.value, offsetNeededInPx: 0 };
    updateDirective(wrapper, binding);
    flushMicrotasks();

    // 160 > 150, enters overflow. offset=0, so 80≤150 fits, 80+80=160>150 hidden
    expect(events[2].hiddenChildrenCount).toBe(1);
  });

  it("recalculates when widthRestrictingContainer changes", async () => {
    const container1 = createContainer(100);
    const container2 = createContainer(500);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    const binding = mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container1,
    });
    await triggerResize();

    expect(events[0].hiddenChildrenCount).toBeGreaterThan(0);

    // Switch to larger container
    binding.value = {
      ...binding.value,
      widthRestrictingContainer: container2,
    };
    updateDirective(wrapper, binding);
    // Need to trigger the new container's resize observer
    MockResizeObserver.instances.forEach((i) => i.trigger());
    flushMicrotasks();

    expect(events[events.length - 1].hiddenChildrenCount).toBe(0);
  });

  // ── Combined features ─────────────────────────────────────────────

  it("sortBySize + keepVisibleEl together", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([120, 30, 30, 30]);
    const keepEl = wrapper.children[0] as HTMLElement;
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: keepEl,
      offsetNeededInPx: 50,
      sortBySize: true,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none"); // kept
    expect(children[1].style.display).not.toBe("none"); // small, fits
    expect(events[0].hiddenChildrenCount).toBe(2);
  });

  it("sortBySize + rowCount together", async () => {
    const container = createContainer(200);
    const wrapper = createWrapper([150, 30, 30, 30]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      rowCount: 2,
      sortBySize: true,
      widthRestrictingContainer: container,
    });
    await triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).not.toBe("none");
    expect(children[3].style.display).not.toBe("none");

    expect(events[0].isOverflowing).toBe(false);
  });
});
