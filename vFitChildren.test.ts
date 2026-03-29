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

// --- Mock IntersectionObserver ---

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private cb: IntersectionObserverCallback;
  private root: Element | null;
  private observedSet: Set<Element> = new Set();
  private _disconnected = false;

  constructor(
    cb: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.cb = cb;
    this.root = (options?.root as Element) ?? null;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observedSet.add(el);
  }

  unobserve(el: Element) {
    this.observedSet.delete(el);
  }

  disconnect() {
    this._disconnected = true;
    this.observedSet.clear();
  }

  /**
   * Simulate IntersectionObserver by computing visibility from data-v-fit-w
   * attributes stamped on ghost clones. Walks all children of the root in
   * order, accumulating widths. A child "fits" if its trailing edge is within
   * the root's style.width.
   */
  trigger() {
    if (this._disconnected || !this.root) return;

    const rootEl = this.root as HTMLElement;
    const pw = parseFloat(rootEl.style.width);
    const availableWidth = Number.isNaN(pw) ? 9999 : pw;
    const gapStr = rootEl.style.gap || "0";
    const gap = parseFloat(gapStr.split(" ").pop()!) || 0;

    const allChildren = Array.from(rootEl.children) as HTMLElement[];
    let position = 0;
    const entries: Partial<IntersectionObserverEntry>[] = [];

    allChildren.forEach((child, i) => {
      const childWidth = parseFloat(child.dataset.vFitW || "0");
      const gapBefore = i > 0 ? gap : 0;
      const childEnd = position + gapBefore + childWidth;
      const fits = childEnd <= availableWidth;

      if (this.observedSet.has(child)) {
        entries.push({
          target: child,
          intersectionRatio: fits ? 1.0 : 0.0,
          isIntersecting: fits,
        });
      }

      position = childEnd;
    });

    this.cb(entries as IntersectionObserverEntry[], this as any);
  }

  static reset() {
    this.instances = [];
  }

  static triggerAll() {
    this.instances.forEach((i) => i.trigger());
  }
}

// --- Helpers ---

function setClientWidth(el: HTMLElement, width: number) {
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
  Object.defineProperty(el, "scrollWidth", {
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

function triggerResize() {
  MockResizeObserver.instances.forEach((i) => i.trigger());
  flushRaf();
  MockIntersectionObserver.triggerAll();
}

// --- Tests ---

describe("vFitChildren", () => {
  beforeEach(() => {
    MockResizeObserver.reset();
    MockMutationObserver.reset();
    MockIntersectionObserver.reset();
    rafCallbacks.clear();
    nextRafId = 1;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("requestAnimationFrame", mockRaf);
    vi.stubGlobal("cancelAnimationFrame", mockCancelRaf);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Basic overflow ─────────────────────────────────────────────────

  it("hides children that overflow the container", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

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

  it("hides the first child if it does not fit (strict fit)", () => {
    const container = createContainer(10);
    const wrapper = createWrapper([100, 50, 50]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(3);
  });

  it("hides a single child if it overflows (strict fit)", () => {
    const container = createContainer(50);
    const wrapper = createWrapper([200]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].isOverflowing).toBe(true);
  });

  it("dispatches event with zero counts for no children", () => {
    const container = createContainer(200);
    const wrapper = document.createElement("div");
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].hiddenChildren).toHaveLength(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  // ── Smart fit ──────────────────────────────────────────────────────

  it("does not hide items if they fit but offset would overflow (smart fit)", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(0);
  });

  it("allows offset of zero", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(0);
  });

  // ── Responsive ─────────────────────────────────────────────────────

  it("shows previously hidden children when container grows", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(2);

    setClientWidth(container, 500);
    triggerResize();

    expect(events[1].hiddenChildrenCount).toBe(0);
    expect(events[1].isOverflowing).toBe(false);

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).not.toBe("none");
  });

  it("rebuilds ghost on every recalculation", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    // Ghost is recreated each recalculation — verify by checking that
    // a second resize still produces correct results after child change
    setClientWidth(container, 300);
    triggerResize();

    // After growing, all should fit (smart fit: 240 ≤ 300)
    const children = Array.from(wrapper.children) as HTMLElement[];
    children.forEach((child) => {
      expect(child.style.display).not.toBe("none");
    });
  });

  it("recalculates when a child's size changes via ResizeObserver", () => {
    const container = createContainer(300);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);

    // Child grows (e.g. dropdown selection changes text)
    const children = Array.from(wrapper.children) as HTMLElement[];
    setClientWidth(children[1], 200);

    // Child ResizeObserver fires
    triggerResize();

    expect(events[1].isOverflowing).toBe(true);
    expect(events[1].hiddenChildrenCount).toBeGreaterThan(0);
  });

  // ── Batching & performance ─────────────────────────────────────────

  it("batches multiple triggers into one calculation", () => {
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

    flushRaf();
    MockIntersectionObserver.triggerAll();

    // RAF dedup: should only calculate once
    expect(events).toHaveLength(1);
  });

  // ── Attributes ─────────────────────────────────────────────────────

  it("marks hidden children with data-v-fit-hidden attribute", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].hasAttribute("data-v-fit-hidden")).toBe(false);
    expect(children[1].getAttribute("data-v-fit-hidden")).toBe("true");
    expect(children[2].getAttribute("data-v-fit-hidden")).toBe("true");
  });

  // ── Cleanup ────────────────────────────────────────────────────────

  it("cleans up observers on unmount", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, { widthRestrictingContainer: container });
    triggerResize();

    const resizeObs = MockResizeObserver.instances[0];
    const mutationObs = MockMutationObserver.instances[0];
    const resizeDisconnect = vi.spyOn(resizeObs, "disconnect");
    const mutationDisconnect = vi.spyOn(mutationObs, "disconnect");

    unmountDirective(wrapper);

    expect(resizeDisconnect).toHaveBeenCalled();
    expect(mutationDisconnect).toHaveBeenCalled();
  });

  it("pending RAF after unmount does not crash", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);

    mountDirective(wrapper, { widthRestrictingContainer: container });

    // Trigger without flushing — RAF is pending
    MockResizeObserver.instances.forEach((obs) => obs.trigger());

    unmountDirective(wrapper);

    // Flushing after unmount should not throw
    expect(() => {
      flushRaf();
      MockIntersectionObserver.triggerAll();
    }).not.toThrow();
  });

  it("restores hidden children on unmount", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

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

  // ── Event details ──────────────────────────────────────────────────

  it("event hiddenChildren references the actual hidden DOM elements", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(events[0].hiddenChildren).toContain(children[1]);
    expect(events[0].hiddenChildren).toContain(children[2]);
    expect(events[0].hiddenChildren).not.toContain(children[0]);
  });

  it("keeps all children visible when they fit", () => {
    const container = createContainer(500);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    children.forEach((child) => {
      expect(child.style.display).not.toBe("none");
    });
    expect(events[0].hiddenChildrenCount).toBe(0);
    expect(events[0].isOverflowing).toBe(false);
  });

  // ── Gap ────────────────────────────────────────────────────────────

  it("applies CSS gap to ghost for overflow calculation", () => {
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
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(events[0].hiddenChildrenCount).toBe(1);

    spy.mockRestore();
  });

  it("uses gap option over CSS gap", () => {
    const container = createContainer(200);
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
    triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(0);

    spy.mockRestore();
  });

  // ── Overflow: visible (scrollWidth) ────────────────────────────────

  it("accounts for scrollWidth when child content overflows its box", () => {
    const container = createContainer(170);
    const wrapper = document.createElement("div");

    // Child 0: box width 60px, but scrollWidth 120px (overflow: visible)
    const child0 = document.createElement("span");
    setClientWidth(child0, 60);
    Object.defineProperty(child0, "scrollWidth", {
      configurable: true,
      value: 120,
    });

    // Child 1: normal 60px box
    const child1 = document.createElement("span");
    setClientWidth(child1, 60);

    wrapper.appendChild(child0);
    wrapper.appendChild(child1);

    const events = captureEvents(wrapper);

    // Without scrollWidth: 60 + 60 = 120 ≤ 170 → smart fit, all visible
    // With scrollWidth: max(60, 120) = 120. Total: 120 + 60 = 180 > 170 → overflow
    // Ghost width: 170 - 50 = 120. child0=120 fits (120 ≤ 120). child1: 120+60=180 > 120 → hidden.
    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].isOverflowing).toBe(true);
  });

  // ── keepVisibleEl ──────────────────────────────────────────────────

  it("prioritizes elements with data-v-fit-keep", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([100, 100, 100]);
    wrapper.children[2].setAttribute("data-v-fit-keep", "true");

    mountDirective(wrapper, {
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[2].style.display).not.toBe("none"); // Priority kept
    expect(children[0].style.display).not.toBe("none"); // Normal fit
    expect(children[1].style.display).toBe("none"); // Hidden
  });

  it("keeps a direct child visible via keepVisibleEl option", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([100, 100, 100]);
    const inputChild = wrapper.children[2] as HTMLElement;
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: inputChild,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).toBe("none");
    expect(children[2].style.display).not.toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(1);
    expect(events[0].hiddenChildren[0]).toBe(children[1]);
  });

  it("keeps a parent child visible when keepVisibleEl is a nested descendant", () => {
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
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).not.toBe("none");
    expect(children[1].style.display).not.toBe("none");
    expect(children[2].style.display).toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(1);
  });

  it("force-keeps keepVisibleEl even when it exceeds available space", () => {
    const container = createContainer(100);
    const wrapper = createWrapper([80, 150]);
    const keepEl = wrapper.children[1] as HTMLElement;
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      keepVisibleEl: keepEl,
      offsetNeededInPx: 0,
      widthRestrictingContainer: container,
    });
    triggerResize();

    const children = Array.from(wrapper.children) as HTMLElement[];
    expect(children[0].style.display).toBe("none");
    expect(children[1].style.display).not.toBe("none");

    expect(events[0].hiddenChildrenCount).toBe(1);
  });

  // ── Updated hook (reactive options) ───────────────────────────────

  it("recalculates when offsetNeededInPx changes via updated hook", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80]);
    const events = captureEvents(wrapper);

    const binding = mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    // Smart fit: 160 ≤ 200, all visible
    expect(events[0].hiddenChildrenCount).toBe(0);

    // Shrink container to force overflow
    setClientWidth(container, 150);
    binding.value = { ...binding.value, offsetNeededInPx: 0 };
    updateDirective(wrapper, binding);
    flushRaf();
    MockIntersectionObserver.triggerAll();

    // 160 > 150, enters overflow. offset=0, so 80≤150 fits, 80+80=160>150 hidden
    expect(events[1].hiddenChildrenCount).toBe(1);
  });

  it("recalculates when widthRestrictingContainer changes", () => {
    const container1 = createContainer(100);
    const container2 = createContainer(500);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    const binding = mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container1,
    });
    triggerResize();

    expect(events[0].hiddenChildrenCount).toBeGreaterThan(0);

    // Switch to larger container
    binding.value = {
      ...binding.value,
      widthRestrictingContainer: container2,
    };
    updateDirective(wrapper, binding);
    MockResizeObserver.instances.forEach((i) => i.trigger());
    flushRaf();
    MockIntersectionObserver.triggerAll();

    expect(events[events.length - 1].hiddenChildrenCount).toBe(0);
  });

  // ── data option & hiddenIndices ──────────────────────────────────

  it("includes hiddenIndices in the event detail", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenIndices).toEqual([1, 2, 3]);
  });

  it("returns empty hiddenIndices when all children fit", () => {
    const container = createContainer(500);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenIndices).toEqual([]);
  });

  it("maps hidden children to data objects when data is provided", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const data = [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
      { id: 4, name: "Delta" },
    ];
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      data,
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenData).toEqual([
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
      { id: 4, name: "Delta" },
    ]);
    expect(events[0].hiddenIndices).toEqual([1, 2, 3]);
  });

  it("does not include hiddenData when data option is omitted", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenData).toBeUndefined();
  });

  it("handles data array shorter than children count", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80, 80]);
    const data = [{ id: 1 }, { id: 2 }];
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      data,
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenIndices).toEqual([1, 2, 3]);
    expect(events[0].hiddenData).toEqual([{ id: 2 }]);
  });

  it("hiddenData reports correct items when a kept child shifts indices", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([100, 100, 100]);
    wrapper.children[0].setAttribute("data-v-fit-keep", "true");
    const data = ["alpha", "beta", "gamma"];
    const events = captureEvents(wrapper);

    mountDirective(wrapper, {
      data,
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    // child[0] is kept (100px). Ghost width = 200-50=150.
    // Kept takes 100, leaves 50. child[1]=100 doesn't fit, child[2]=100 doesn't fit.
    expect(events[0].hiddenIndices).toEqual([1, 2]);
    expect(events[0].hiddenData).toEqual(["beta", "gamma"]);
  });

  it("recalculates when data array changes", () => {
    const container = createContainer(200);
    const wrapper = createWrapper([80, 80, 80]);
    const events = captureEvents(wrapper);

    const binding = mountDirective(wrapper, {
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      offsetNeededInPx: 50,
      widthRestrictingContainer: container,
    });
    triggerResize();

    expect(events[0].hiddenData).toEqual([{ id: 2 }, { id: 3 }]);

    binding.value = {
      ...binding.value,
      data: [{ id: 10 }, { id: 20 }, { id: 30 }],
    };
    updateDirective(wrapper, binding);
    flushRaf();
    MockIntersectionObserver.triggerAll();

    expect(events[1].hiddenData).toEqual([{ id: 20 }, { id: 30 }]);
  });
});
