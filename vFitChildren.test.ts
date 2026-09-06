// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FitChildrenEventDetail,
  type FitChildrenOptions,
  vFitChildren,
} from "./vFitChildren";

// ── Row simulator ────────────────────────────────────────────────────
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed to lay the host's
// children out in one row. It reads the live DOM every call, which is the point:
// a child the directive has hidden collapses to zero exactly as it would in a
// browser, so the "hidden children cannot be measured" problem is reproduced
// rather than mocked away.

const WIDTHS = new WeakMap<Element, number>();
let hostWidth = 0;
let rowGap = 0;

const isLaidOut = (el: HTMLElement): boolean =>
  el.style.display !== "none" && !el.hasAttribute("data-v-fit-hidden");

const widthOf = (el: HTMLElement): number => WIDTHS.get(el) ?? 0;

const rect = (left: number, width: number): DOMRect =>
  ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0 }) as DOMRect;

function installLayout(): void {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      if (this.dataset.host !== undefined) return rect(0, hostWidth);

      const parent = this.parentElement;
      if (!parent) return rect(0, 0);

      let x = 0;
      for (const sibling of Array.from(parent.children) as HTMLElement[]) {
        if (sibling === this) break;
        if (!isLaidOut(sibling)) continue;
        x += widthOf(sibling) + rowGap;
      }
      return rect(x, isLaidOut(this) ? widthOf(this) : 0);
    },
  });
}

// ── Observer mocks ───────────────────────────────────────────────────
//
// `observe()` RECORDS its targets and `trigger()` passes real entries. A no-op
// observe() is what once let the suite stay green while the per-child observer
// did not exist at all — do not simplify it back.

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  targets: HTMLElement[] = [];
  private cb: ResizeObserverCallback;
  private dead = false;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    MockResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.targets.push(el as HTMLElement);
  }
  unobserve(el: Element) {
    this.targets = this.targets.filter((t) => t !== el);
  }
  disconnect() {
    this.dead = true;
    this.targets = [];
  }

  /** Deliver entries for the given targets, or for every observed target. */
  trigger(only?: HTMLElement[]) {
    if (this.dead) return;
    const targets = only ?? this.targets;
    const entries = targets.map((target) => ({
      target,
      contentRect: rect(
        0,
        target.dataset.host !== undefined ? hostWidth : widthOf(target),
      ),
    }));
    this.cb(entries as unknown as ResizeObserverEntry[], this as never);
  }

  static latest(): MockResizeObserver {
    return this.instances[this.instances.length - 1];
  }
  static reset() {
    this.instances = [];
  }
}

class MockMutationObserver {
  static instances: MockMutationObserver[] = [];
  private cb: MutationCallback;
  constructor(cb: MutationCallback) {
    this.cb = cb;
    MockMutationObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  trigger() {
    this.cb([] as never, this as never);
  }
  static latest(): MockMutationObserver {
    return this.instances[this.instances.length - 1];
  }
  static reset() {
    this.instances = [];
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────

type Hooks = {
  mounted: (el: HTMLElement, binding: unknown, v: unknown, p: unknown) => void;
  updated: (el: HTMLElement, binding: unknown, v: unknown, p: unknown) => void;
  beforeUnmount: (el: HTMLElement, binding: unknown, v: unknown, p: unknown) => void;
};
const hooks = vFitChildren as unknown as Hooks;

const mount = (el: HTMLElement, value?: FitChildrenOptions): void =>
  hooks.mounted(el, { value }, null, null);
const update = (el: HTMLElement, value?: FitChildrenOptions): void =>
  hooks.updated(el, { value }, null, null);
const unmount = (el: HTMLElement): void =>
  hooks.beforeUnmount(el, { value: undefined }, null, null);

function buildRow(widths: number[], available = 300): HTMLElement {
  hostWidth = available;
  const host = document.createElement("div");
  host.dataset.host = "";
  widths.forEach((w, i) => {
    const child = document.createElement("span");
    child.textContent = `child-${i}`;
    WIDTHS.set(child, w);
    host.appendChild(child);
  });
  document.body.appendChild(host);
  return host;
}

const addChild = (host: HTMLElement, width: number): HTMLElement => {
  const child = document.createElement("span");
  WIDTHS.set(child, width);
  host.appendChild(child);
  return child;
};

const hiddenOf = (host: HTMLElement): string[] =>
  (Array.from(host.children) as HTMLElement[])
    .filter((c) => c.hasAttribute("data-v-fit-hidden"))
    .map((c) => c.textContent ?? "");

const visibleCount = (host: HTMLElement): number =>
  (Array.from(host.children) as HTMLElement[]).filter(
    (c) => !c.hasAttribute("data-v-fit-hidden"),
  ).length;

beforeEach(() => {
  installLayout();
  rowGap = 0;
  MockResizeObserver.reset();
  MockMutationObserver.reset();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("MutationObserver", MockMutationObserver);
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});

// ── The fit decision ─────────────────────────────────────────────────

describe("fitting", () => {
  it("hides the children that do not fit, in DOM order", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(hiddenOf(host)).toEqual(["child-3"]);
  });

  it("keeps everything when everything fits", () => {
    const host = buildRow([50, 50, 50], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(hiddenOf(host)).toEqual([]);
    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
  });

  it("does not reserve the offset when everything fits (smart fit)", () => {
    // 150 of content in 200 of room: the offset would push it over, but no
    // badge is needed when nothing is hidden, so none is reserved.
    const host = buildRow([50, 50, 50], 200);
    mount(host, { offsetNeededInPx: 100 });
    expect(hiddenOf(host)).toEqual([]);
  });

  it("reserves the offset once it is actually overflowing", () => {
    const host = buildRow([100, 100, 100], 250);
    mount(host, { offsetNeededInPx: 60 });
    // 250 - 60 = 190 of budget, so only the first child survives.
    expect(visibleCount(host)).toBe(1);
  });

  it("hides a single child that cannot fit at all", () => {
    const host = buildRow([500], 100);
    mount(host, { offsetNeededInPx: 0 });
    expect(hiddenOf(host)).toEqual(["child-0"]);
  });

  it("handles a host with no children", () => {
    const host = buildRow([], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
  });

  it("counts the spacing between children", () => {
    rowGap = 20;
    const host = buildRow([100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    // 100 + 20+100 + 20+100 = 340 > 300, so the last one goes.
    expect(hiddenOf(host)).toEqual(["child-2"]);
  });

  it("treats the gap option as a floor over measured spacing, never a replacement", () => {
    rowGap = 20;
    const host = buildRow([100, 100, 100], 340);
    mount(host, { gap: 0, offsetNeededInPx: 0 });
    // gap: 0 must not erase the real 20px spacing and let a child through.
    expect(visibleCount(host)).toBe(3);

    const wider = buildRow([100, 100, 100], 340);
    mount(wider, { gap: 40, offsetNeededInPx: 0 });
    // Raising it above the measured spacing does reserve more room.
    expect(visibleCount(wider)).toBe(2);
  });
});

// ── Regressions found by review ──────────────────────────────────────

describe("regressions", () => {
  it("does not charge a leading gap to the first child", () => {
    rowGap = 20;
    // 100 + 20+100 + 20+100 = 340, which fits in 350. Flooring the first
    // child's spacing too bills 3 gaps instead of 2 and drops a chip.
    const host = buildRow([100, 100, 100], 350);
    mount(host, { gap: 20, offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(3);
    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
  });

  it("reports overflowing when every child is pinned and the row still clips", () => {
    const host = buildRow([300, 300], 100);
    (Array.from(host.children) as HTMLElement[]).forEach((c) =>
      c.setAttribute("data-v-fit-keep", ""),
    );
    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    mount(host, { offsetNeededInPx: 0 });

    // Nothing could be hidden, but 600px of content in 100px is overflowing.
    expect(visibleCount(host)).toBe(2);
    expect(host.getAttribute("data-v-fit-state")).toBe("overflowing");
    expect(seen.at(-1)?.isOverflowing).toBe(true);
  });

  it("re-dispatches when only the data reference changed", () => {
    const first = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { data: first, offsetNeededInPx: 0 });

    const seen: FitChildrenEventDetail<{ id: number }>[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    // Same fit, new objects: an unchanged visible set still means new
    // hiddenData, so a listener rendering from the payload must hear about it.
    const second = [{ id: 9 }, { id: 8 }, { id: 7 }, { id: 6 }];
    update(host, { data: second, offsetNeededInPx: 0 });

    expect(seen.at(-1)?.hiddenData).toEqual([{ id: 6 }]);
  });

  it("puts the hide rule back if something removed it", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(document.head.querySelector("style[data-v-fit-style]")).not.toBeNull();

    // A hot reload, or a framework that rewrites <head>. Without the rule every
    // hidden child keeps its attribute and silently renders at full size.
    document.head.querySelector("style[data-v-fit-style]")!.remove();
    hostWidth = 150;
    MockResizeObserver.latest().trigger([host]);

    expect(document.head.querySelector("style[data-v-fit-style]")).not.toBeNull();
  });
});

// ── Hiding mechanism ─────────────────────────────────────────────────

describe("hiding", () => {
  it("hides via an attribute and one injected rule, never an inline style", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    const last = host.lastElementChild as HTMLElement;
    expect(last.hasAttribute("data-v-fit-hidden")).toBe(true);
    expect(last.style.display).toBe("");

    const sheet = document.head.querySelector("style[data-v-fit-style]");
    expect(sheet?.textContent).toContain("display:none !important");
  });

  it("injects the rule only once per root", () => {
    mount(buildRow([100], 300), { offsetNeededInPx: 0 });
    mount(buildRow([100], 300), { offsetNeededInPx: 0 });
    expect(document.head.querySelectorAll("style[data-v-fit-style]")).toHaveLength(1);
  });

  it("restores every child it hid on unmount", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(hiddenOf(host).length).toBeGreaterThan(0);

    unmount(host);
    expect(hiddenOf(host)).toEqual([]);
    expect(host.hasAttribute("data-v-fit-state")).toBe(false);
  });
});

// ── The v-show collision ─────────────────────────────────────────────
//
// `v-show`, Vue's style patcher and <Transition> all own `el.style.display`.
// These two tests are the reason the directive stays off that property.

describe("v-show composition", () => {
  it("does not force-show a child the consumer hid", () => {
    const host = buildRow([100, 100, 100], 300);
    const middle = host.children[1] as HTMLElement;
    middle.style.display = "none"; // what vShow.setDisplay(el, false) does

    mount(host, { offsetNeededInPx: 0 });

    expect(middle.style.display).toBe("none");
    expect(middle.hasAttribute("data-v-fit-hidden")).toBe(false);
  });

  it("excludes a consumer-hidden child from measurement and from the event", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    const first = host.children[0] as HTMLElement;
    first.style.display = "none";

    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));
    mount(host, { offsetNeededInPx: 0 });

    // Only three children are in the row now, and 300 fits exactly three.
    expect(hiddenOf(host)).toEqual([]);
    expect(seen.at(-1)?.hiddenIndices ?? []).toEqual([]);
  });

  it("survives vShow writing display on a child the directive hid", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    const last = host.lastElementChild as HTMLElement;
    expect(last.hasAttribute("data-v-fit-hidden")).toBe(true);

    // vShow.updated flipping to true: a plain assignment that would have wiped
    // an inline `display: none !important`.
    last.style.display = "";

    expect(last.hasAttribute("data-v-fit-hidden")).toBe(true);
  });
});

const EVENT = "fit-children-updated";

// ── Resize behaviour ─────────────────────────────────────────────────

describe("resizing", () => {
  it("hides more as the container shrinks", () => {
    const host = buildRow([100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(3);

    hostWidth = 150;
    MockResizeObserver.latest().trigger([host]);
    expect(visibleCount(host)).toBe(1);
  });

  it("shows them again as it grows", () => {
    const host = buildRow([100, 100, 100], 150);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(1);

    hostWidth = 300;
    MockResizeObserver.latest().trigger([host]);
    expect(visibleCount(host)).toBe(3);
  });

  it("re-measures on growth rather than trusting a stale record", () => {
    const host = buildRow([100, 100, 100], 150);
    mount(host, { offsetNeededInPx: 0 });
    const last = host.lastElementChild as HTMLElement;
    expect(last.hasAttribute("data-v-fit-hidden")).toBe(true);

    // The hidden child's content grows while it is hidden. A display:none
    // element reports 0x0 once and then goes quiet, so no ResizeObserver entry
    // ever arrives for it — only a fresh measurement can notice.
    WIDTHS.set(last, 250);

    hostWidth = 320;
    MockResizeObserver.latest().trigger([host]);

    // 100 + 100 + 250 = 450 > 320, so it must stay hidden.
    expect(last.hasAttribute("data-v-fit-hidden")).toBe(true);
    expect(visibleCount(host)).toBe(2);
  });

  it("observes every child, not just the container", () => {
    const host = buildRow([100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    const observed = MockResizeObserver.latest().targets;
    expect(observed).toContain(host);
    expect(observed).toContain(host.children[0]);
    expect(observed).toContain(host.children[1]);
  });

  it("recalculates when a child changes size on its own", () => {
    const host = buildRow([100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(2);

    const second = host.children[1] as HTMLElement;
    WIDTHS.set(second, 400);
    MockResizeObserver.latest().trigger([second]);

    expect(second.hasAttribute("data-v-fit-hidden")).toBe(true);
  });

  it("ignores entries for children it hid itself", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    const hidden = host.lastElementChild as HTMLElement;
    const before = hiddenOf(host);

    // The 0x0 report a child emits as it goes display:none is our own churn.
    MockResizeObserver.latest().trigger([hidden]);
    expect(hiddenOf(host)).toEqual(before);
  });

  it("does not re-enter while a pass is running", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    let passes = 0;
    host.addEventListener(EVENT, () => {
      passes++;
      // A listener that resizes during the event must not recurse.
      MockResizeObserver.latest().trigger([host]);
    });
    mount(host, { offsetNeededInPx: 0 });
    expect(passes).toBe(1);
  });
});

// ── Content-sized hosts ──────────────────────────────────────────────

describe("a host that sizes to its own children", () => {
  // This is the layout that puts a "+N" badge directly after the last chip,
  // rather than after a flex-1 host that claims the whole row.
  const CAP = 350;

  function buildShrinkToFit(widths: number[]): HTMLElement {
    const host = document.createElement("div");
    host.dataset.host = "";
    widths.forEach((w, i) => {
      const child = document.createElement("span");
      child.textContent = `child-${i}`;
      WIDTHS.set(child, w);
      host.appendChild(child);
    });
    document.body.appendChild(host);

    // The host's width IS the sum of what is currently visible, capped by the
    // row — so every hide immediately changes the number we would measure.
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement) {
        if (this.dataset.host !== undefined) {
          const run = (Array.from(this.children) as HTMLElement[])
            .filter(isLaidOut)
            .reduce((sum, c) => sum + widthOf(c), 0);
          return rect(0, Math.min(CAP, run));
        }
        const parent = this.parentElement;
        if (!parent) return rect(0, 0);
        let x = 0;
        for (const sibling of Array.from(parent.children) as HTMLElement[]) {
          if (sibling === this) break;
          if (isLaidOut(sibling)) x += widthOf(sibling) + rowGap;
        }
        return rect(x, isLaidOut(this) ? widthOf(this) : 0);
      },
    });
    return host;
  }

  it("settles instead of collapsing to zero when an offset is reserved", () => {
    const host = buildShrinkToFit([100, 100, 100, 100]);
    mount(host, { offsetNeededInPx: 50 });
    const settled = visibleCount(host);
    expect(settled).toBeGreaterThan(0);

    // Feed the post-hide width back in the way a real ResizeObserver does.
    // Acting on it would subtract the offset again each round: 3 -> 2 -> 1 -> 0.
    for (let i = 0; i < 5; i++) {
      MockResizeObserver.latest().trigger([host]);
    }

    expect(visibleCount(host)).toBe(settled);
  });

  it("settles with no offset too", () => {
    const host = buildShrinkToFit([100, 100, 100, 100]);
    mount(host, { offsetNeededInPx: 0 });
    const settled = visibleCount(host);

    for (let i = 0; i < 5; i++) {
      MockResizeObserver.latest().trigger([host]);
    }

    expect(visibleCount(host)).toBe(settled);
    expect(settled).toBe(3);
  });
});

// ── Siblings ─────────────────────────────────────────────────────────

describe("a sibling that changes size", () => {
  // A "+N" badge next to a shrink-to-fit host: when it grows it takes room from
  // the row, but NEITHER the host's box nor the parent's box changes. Nothing
  // fires unless the badge itself is watched.
  function buildWithSibling(widths: number[], available: number) {
    hostWidth = available;
    const frame = document.createElement("div");
    const host = document.createElement("div");
    host.dataset.host = "";
    widths.forEach((w, i) => {
      const child = document.createElement("span");
      child.textContent = `child-${i}`;
      WIDTHS.set(child, w);
      host.appendChild(child);
    });
    const badge = document.createElement("span");
    badge.textContent = "+N";
    WIDTHS.set(badge, 40);
    frame.append(host, badge);
    document.body.appendChild(frame);
    return { host, badge };
  }

  it("observes the siblings, not just the host and its children", () => {
    const { host, badge } = buildWithSibling([100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(MockResizeObserver.latest().targets).toContain(badge);
  });

  it("recalculates when only the sibling resized", () => {
    const { host, badge } = buildWithSibling([100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(3);

    // The badge grows; the row loses that width. The host's own box is
    // unchanged, so the badge's entry is the only signal there is.
    WIDTHS.set(badge, 160);
    hostWidth = 180;
    MockResizeObserver.latest().trigger([badge]);

    expect(visibleCount(host)).toBe(1);
  });
});

// ── The event ────────────────────────────────────────────────────────

describe("event", () => {
  it("reports the hidden children, indices and overflow state", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    mount(host, { offsetNeededInPx: 0 });

    const detail = seen.at(-1)!;
    expect(detail.hiddenChildrenCount).toBe(1);
    expect(detail.hiddenIndices).toEqual([3]);
    expect(detail.hiddenChildren[0]).toBe(host.children[3]);
    expect(detail.isOverflowing).toBe(true);
  });

  it("only dispatches when the outcome actually changes", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    let count = 0;
    host.addEventListener(EVENT, () => count++);

    // Same width, same fit: hiding a child is itself a resize, so an
    // unconditional dispatch would let a listener that renders from the
    // payload loop forever.
    MockResizeObserver.latest().trigger([host]);
    expect(count).toBe(0);

    hostWidth = 150;
    MockResizeObserver.latest().trigger([host]);
    expect(count).toBe(1);
  });

  it("flips data-v-fit-state between fits and overflowing", () => {
    const host = buildRow([100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(host.getAttribute("data-v-fit-state")).toBe("fits");

    hostWidth = 150;
    MockResizeObserver.latest().trigger([host]);
    expect(host.getAttribute("data-v-fit-state")).toBe("overflowing");
  });
});

// ── Pinned children ──────────────────────────────────────────────────

describe("pinned children", () => {
  it("never hides a child carrying data-v-fit-keep", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    const last = host.lastElementChild as HTMLElement;
    last.setAttribute("data-v-fit-keep", "");

    mount(host, { offsetNeededInPx: 0 });

    expect(last.hasAttribute("data-v-fit-hidden")).toBe(false);
    expect(hiddenOf(host)).toEqual(["child-2"]);
  });

  it("keeps a child that contains keepVisibleEl", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    const wrapper = host.lastElementChild as HTMLElement;
    const inner = document.createElement("input");
    wrapper.appendChild(inner);

    mount(host, { offsetNeededInPx: 0, keepVisibleEl: inner });

    expect(wrapper.hasAttribute("data-v-fit-hidden")).toBe(false);
  });

  it("keeps a pinned child visible even when it alone exceeds the room", () => {
    const host = buildRow([500], 100);
    const only = host.firstElementChild as HTMLElement;
    only.setAttribute("data-v-fit-keep", "");

    mount(host, { offsetNeededInPx: 0 });

    expect(only.hasAttribute("data-v-fit-hidden")).toBe(false);
  });
});

// ── Data mapping ─────────────────────────────────────────────────────

describe("data mapping", () => {
  it("maps hidden children back to the data objects", () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const host = buildRow([100, 100, 100, 100], 300);
    const seen: FitChildrenEventDetail<{ id: number }>[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    mount(host, { data, offsetNeededInPx: 0 });

    expect(seen.at(-1)?.hiddenData).toEqual([{ id: 4 }]);
  });

  it("omits hiddenData when no data was given", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    mount(host, { offsetNeededInPx: 0 });

    expect(seen.at(-1)?.hiddenData).toBeUndefined();
  });

  it("does not let decorative children consume a data index", () => {
    const data = ["a", "b", "c"];
    const host = document.createElement("div");
    host.dataset.host = "";
    hostWidth = 300;
    ["a", "sep", "b", "sep", "c"].forEach((label) => {
      const child = document.createElement("span");
      child.textContent = label;
      WIDTHS.set(child, label === "sep" ? 20 : 100);
      if (label === "sep") child.setAttribute("data-v-fit-decorative", "");
      host.appendChild(child);
    });
    document.body.appendChild(host);

    const seen: FitChildrenEventDetail<string>[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));
    mount(host, { data, offsetNeededInPx: 0 });

    // 100 + 20 + 100 = 220 fits; the next separator takes it to 240, then "c"
    // would reach 340. So "c" is hidden and it must map to data index 2.
    expect(seen.at(-1)?.hiddenData).toEqual(["c"]);
  });
});

// ── Reacting to changes ──────────────────────────────────────────────

describe("updates", () => {
  it("recalculates when an option changes", () => {
    // Already overflowing, so the offset is genuinely in play: smart fit
    // reserves nothing while everything still fits.
    const host = buildRow([100, 100, 100], 250);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(2);

    update(host, { offsetNeededInPx: 120 });
    expect(visibleCount(host)).toBe(1);
  });

  it("picks up children added through the child list", () => {
    const host = buildRow([100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(2);

    addChild(host, 100);
    addChild(host, 100);
    update(host, { offsetNeededInPx: 0 });

    expect(visibleCount(host)).toBe(3);
    expect(MockResizeObserver.latest().targets).toContain(host.children[3]);
  });

  it("does no work when a re-render leaves the children untouched", () => {
    const host = buildRow([100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    const observers = MockResizeObserver.instances.length;
    // Vue invokes `updated` on every patch of the host, not only when children
    // change — an unrelated re-render must not cost a measure pass.
    update(host, { offsetNeededInPx: 0 });
    expect(MockResizeObserver.instances.length).toBe(observers);
  });

  it("reacts to children injected outside Vue", () => {
    const host = buildRow([100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    addChild(host, 100);
    addChild(host, 100);
    MockMutationObserver.latest().trigger();

    expect(visibleCount(host)).toBe(3);
  });

  it("stops observing after unmount", () => {
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    const observer = MockResizeObserver.latest();

    unmount(host);
    hostWidth = 50;
    observer.trigger([host]);

    expect(hiddenOf(host)).toEqual([]);
  });
});
