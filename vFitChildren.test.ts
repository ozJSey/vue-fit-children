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
/** Content extent, for a child whose content spills past its box. */
const SCROLL = new WeakMap<Element, number>();
/** Padding-box width MINUS any classic scrollbar — what `clientWidth` reports. */
const CLIENT = new WeakMap<Element, number>();
let hostWidth = 0;
let rowGap = 0;

const isLaidOut = (el: HTMLElement): boolean =>
  el.style.display !== "none" && !el.hasAttribute("data-v-fit-hidden");

const widthOf = (el: HTMLElement): number => WIDTHS.get(el) ?? 0;

const rect = (left: number, width: number): DOMRect =>
  ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0 }) as DOMRect;

// Computed style. jsdom's own answers are kept for every key the package reads,
// so nothing here changes what an un-overridden test measures; a test that needs
// a browser-only value (a flex host, a shrinkable item, a real `overflow-x`)
// registers it with `styleOverride` and gets exactly that key back.
const REAL_COMPUTED = globalThis.getComputedStyle.bind(globalThis);
const STYLE_KEYS = [
  "borderLeftWidth",
  "borderRightWidth",
  "paddingLeft",
  "paddingRight",
  "marginRight",
  "overflowX",
  "display",
  "flexShrink",
] as const;
const STYLES = new WeakMap<Element, Record<string, string>>();
const styleOverride = (el: HTMLElement, over: Record<string, string>): void => {
  STYLES.set(el, { ...(STYLES.get(el) ?? {}), ...over });
};
const computedStub = (el: Element): CSSStyleDeclaration => {
  const real = REAL_COMPUTED(el as HTMLElement) as unknown as Record<string, string>;
  const out: Record<string, string> = {};
  for (const key of STYLE_KEYS) out[key] = real[key] ?? "";
  return { ...out, ...(STYLES.get(el) ?? {}) } as unknown as CSSStyleDeclaration;
};

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

  // `scrollWidth` is how a child that spills past its box, or one a flex row has
  // squashed below its content, reports what it actually wants.
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return Math.round(SCROLL.get(this) ?? this.getBoundingClientRect().width);
    },
  });
  // `offsetWidth - clientWidth - borders` is the classic scrollbar. Default: none.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return Math.round(this.getBoundingClientRect().width);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return Math.round(CLIENT.get(this) ?? this.getBoundingClientRect().width);
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

  /**
   * Deliver entries for the given targets, or for every observed target.
   *
   * The width comes from the target's own laid-out rect, which is what a real
   * ResizeObserver reports. It used to come from the module-level `hostWidth`
   * for the host, which `buildShrinkToFit` never assigns and `beforeEach` never
   * reset — so the feedback-loop tests fed a constant leaked from whichever
   * earlier test ran last and could not fail (quality audit, finding 10).
   */
  trigger(only?: HTMLElement[]) {
    if (this.dead) return;
    const targets = only ?? this.targets;
    const entries = targets.map((target) => ({
      target,
      contentRect: rect(0, target.getBoundingClientRect().width),
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
  hostWidth = 0;
  MockResizeObserver.reset();
  MockMutationObserver.reset();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("MutationObserver", MockMutationObserver);
  vi.stubGlobal("getComputedStyle", computedStub);
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

// ── FIT-1 and the quality audit ──────────────────────────────────────
//
// Every test below reproduces a defect found by driving the PUBLISHED package
// in a real browser. They assert what a consumer can observe — the event that
// arrives, the attribute on the host, which children are laid out — never what
// the directive believes internally.

describe("the event reports what is true now", () => {
  const seenOn = (host: HTMLElement): FitChildrenEventDetail[] => {
    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));
    return seen;
  };

  it("FIT-1 F1: dispatches when the very first pass hides every child", () => {
    // 9 chips into 90px: nothing fits. `state.visible` starts empty and the
    // first fit is empty too, so the old gate saw "no change" and stayed
    // silent — an over-full row with no "+N more" badge at exactly the widths
    // where the badge is the only thing the user could act on.
    const host = buildRow([100, 100, 100, 100, 100, 100, 100, 100, 100], 90);
    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    mount(host, { offsetNeededInPx: 0 });

    expect(visibleCount(host)).toBe(0);
    expect(host.getAttribute("data-v-fit-state")).toBe("overflowing");
    expect(seen).toHaveLength(1);
    expect(seen[0].hiddenChildrenCount).toBe(9);
    expect(seen[0].isOverflowing).toBe(true);
  });

  it("FIT-1 F1: dispatches on a remount that hides every child again", () => {
    const host = buildRow([100, 100, 100], 40);
    mount(host, { offsetNeededInPx: 0 });
    unmount(host);

    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));
    mount(host, { offsetNeededInPx: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0].hiddenChildrenCount).toBe(3);
  });

  it("FIT-1 F1: dispatches once at mount even when everything fits", () => {
    const host = buildRow([50, 50], 300);
    const seen: FitChildrenEventDetail[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));

    mount(host, { offsetNeededInPx: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0].hiddenChildrenCount).toBe(0);
    expect(seen[0].isOverflowing).toBe(false);
  });

  it("FIT-1 F2: isOverflowing follows the row on the RESIZE path, not only at mount", () => {
    // Every child is pinned, so the visible set never moves however narrow the
    // row gets. The attribute was right at every width and the event was not:
    // the dispatch gate watched the visible set, which is the one thing this
    // row cannot change.
    const host = buildRow([100, 100], 300);
    (Array.from(host.children) as HTMLElement[]).forEach((c) =>
      c.setAttribute("data-v-fit-keep", ""),
    );
    const seen = seenOn(host);
    mount(host, { offsetNeededInPx: 0 });

    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
    expect(seen.at(-1)?.isOverflowing).toBe(false);

    for (const width of [150, 90, 400, 120]) {
      hostWidth = width;
      MockResizeObserver.latest().trigger([host]);
      const attribute = host.getAttribute("data-v-fit-state");
      expect(seen.at(-1)?.isOverflowing).toBe(attribute === "overflowing");
    }

    // …and it really did change, so the loop above is not asserting `false`
    // against `false` four times over.
    expect(seen.map((d) => d.isOverflowing)).toContain(true);
  });

  it("quality 1: dispatches when hidden children are REMOVED by an in-place splice", () => {
    // `items.pop()` is how Vue code shortens an array. Neither the visible set
    // nor the array's identity moves, so the badge kept naming rows the user
    // had already deleted.
    const data = ["a", "b", "c", "d", "e", "f"];
    const host = buildRow([100, 100, 100, 100, 100, 100], 300);
    mount(host, { data, offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(3);

    const seen = seenOn(host);
    for (let i = 0; i < 3; i++) {
      data.pop();
      host.lastElementChild!.remove();
    }
    update(host, { data, offsetNeededInPx: 0 });

    expect(visibleCount(host)).toBe(3);
    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
    expect(seen.at(-1)?.hiddenChildrenCount).toBe(0);
    expect(seen.at(-1)?.hiddenData).toEqual([]);
    expect(seen.at(-1)?.isOverflowing).toBe(false);
  });

  it("quality 1: dispatches when hidden children are ADDED by an in-place push", () => {
    const data = ["a", "b", "c", "d"];
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { data, offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(3);

    const seen = seenOn(host);
    data.push("e", "f");
    addChild(host, 100);
    addChild(host, 100);
    update(host, { data, offsetNeededInPx: 0 });

    expect(visibleCount(host)).toBe(3);
    expect(seen.at(-1)?.hiddenChildrenCount).toBe(3);
    expect(seen.at(-1)?.hiddenData).toEqual(["d", "e", "f"]);
  });

  it("still stays quiet when nothing a listener can see has changed", () => {
    // The gate exists because hiding a child is itself a resize; a listener
    // that renders from the payload must not be able to loop.
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });

    const seen = seenOn(host);
    for (let i = 0; i < 5; i++) MockResizeObserver.latest().trigger([host]);
    expect(seen).toHaveLength(0);
  });

  it("stays quiet with `data` bound, including when the array is replaced by an equal one", () => {
    // `hiddenData` is a fresh array every pass, so a gate that compared it by
    // reference would report on every single delivery — and the payload is what
    // a "+N more" badge renders from, which makes that a loop. The items are
    // what a listener can see; the array holding them is not.
    const items = ["a", "b", "c", "d"];
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { data: items, offsetNeededInPx: 0 });

    const seen = seenOn(host);
    for (let i = 0; i < 5; i++) MockResizeObserver.latest().trigger([host]);
    expect(seen).toHaveLength(0);

    // `items = [...items]` — a new reference over the same values, which is how
    // half of Vue code "mutates" an array.
    update(host, { data: [...items], offsetNeededInPx: 0 });
    expect(seen).toHaveLength(0);
  });

  it("re-dispatches when only the hidden children's DOM positions moved", () => {
    // `hiddenIndices` is the one field that can change entirely on its own: the
    // same elements carrying the same data can sit at different DOM positions
    // once something is inserted ahead of them.
    const items = ["A", "B", "C", "D"];
    const host = buildRow([100, 100, 100, 100], 300);
    mount(host, { data: items, offsetNeededInPx: 0 });

    const seen = seenOn(host);
    const hiddenBefore = host.children[3] as HTMLElement;

    const separator = document.createElement("span");
    WIDTHS.set(separator, 0);
    separator.setAttribute("data-v-fit-decorative", "");
    host.insertBefore(separator, host.firstChild);
    update(host, { data: items, offsetNeededInPx: 0 });

    const detail = seen.at(-1);
    expect(detail).toBeDefined();
    // Same element, same name, same overflow state — only the position moved.
    expect(detail?.hiddenChildren).toEqual([hiddenBefore]);
    expect(detail?.hiddenData).toEqual(["D"]);
    expect(detail?.isOverflowing).toBe(true);
    expect(detail?.hiddenIndices).toEqual([4]);
  });
});

// ── Pinning versus data membership ───────────────────────────────────

describe("data membership is declared, not inferred from pinning", () => {
  const build = (): { host: HTMLElement; pinned: HTMLElement } => {
    const host = buildRow([100, 100, 100, 100], 250);
    const pinned = host.firstElementChild as HTMLElement;
    return { host, pinned };
  };
  const data = () => ["A", "B", "C", "D"];

  it("FIT-1 F3: both pin mechanisms give the same hiddenData for the same row", () => {
    const viaAttribute = build();
    viaAttribute.pinned.setAttribute("data-v-fit-keep", "");
    const attributeSeen: FitChildrenEventDetail<string>[] = [];
    viaAttribute.host.addEventListener(EVENT, (e) =>
      attributeSeen.push((e as CustomEvent).detail),
    );
    mount(viaAttribute.host, { data: data(), offsetNeededInPx: 0 });

    const viaRef = build();
    const refSeen: FitChildrenEventDetail<string>[] = [];
    viaRef.host.addEventListener(EVENT, (e) => refSeen.push((e as CustomEvent).detail));
    mount(viaRef.host, {
      data: data(),
      keepVisibleEl: viaRef.pinned,
      offsetNeededInPx: 0,
    });

    // Same geometry, same pinned child, so the same two names are hidden.
    expect(hiddenOf(viaAttribute.host)).toEqual(hiddenOf(viaRef.host));
    expect(attributeSeen.at(-1)?.hiddenData).toEqual(["C", "D"]);
    expect(refSeen.at(-1)?.hiddenData).toEqual(["C", "D"]);
    expect(refSeen.at(-1)?.hiddenIndices).toEqual([2, 3]);
  });

  it("a pinned child that is NOT one of your data items is marked decorative", () => {
    // A(100) B(100) C(100) plus a pinned 60px control: 360 into 300, and the
    // control's 60 is reserved first, so C is the one that goes.
    const host = buildRow([100, 100, 100], 300);
    const control = document.createElement("button");
    WIDTHS.set(control, 60);
    control.setAttribute("data-v-fit-keep", "");
    control.setAttribute("data-v-fit-decorative", "");
    host.appendChild(control);

    const seen: FitChildrenEventDetail<string>[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));
    mount(host, { data: ["A", "B", "C"], offsetNeededInPx: 0 });

    expect(control.hasAttribute("data-v-fit-hidden")).toBe(false);
    expect(seen.at(-1)?.hiddenData).toEqual(["C"]);
  });

  it("warns when the data array does not map 1:1 with the children", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = buildRow([100, 100, 100], 250);
    const control = document.createElement("button");
    WIDTHS.set(control, 60);
    control.setAttribute("data-v-fit-keep", "");
    host.appendChild(control);

    mount(host, { data: ["A", "B", "C"], offsetNeededInPx: 0 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/data-v-fit-decorative/);

    // …and not again on every pass, or a resize drag becomes a log flood.
    hostWidth = 200;
    MockResizeObserver.latest().trigger([host]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not warn when the mapping is 1:1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = buildRow([100, 100, 100], 250);
    mount(host, { data: ["A", "B", "C"], offsetNeededInPx: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── Measurement ──────────────────────────────────────────────────────

describe("measurement", () => {
  it("quality 9: keeps the gap after a child whose content spills", () => {
    rowGap = 20;
    // Boxes are 100 wide; the first child's content spills to 160. The row
    // needs 160 + 20 + 100 + 20 + 100 = 400. Advancing the cursor by the SPILL
    // rather than the box swallowed the 20px in front of the second child and
    // billed the row 380 — so it admitted a chip that does not fit.
    const host = buildRow([100, 100, 100], 380);
    SCROLL.set(host.firstElementChild!, 160);
    mount(host, { offsetNeededInPx: 0 });

    expect(host.getAttribute("data-v-fit-state")).toBe("overflowing");
    expect(visibleCount(host)).toBe(2);
  });

  it("quality 9 control: the same row fits once it really has the room", () => {
    rowGap = 20;
    const host = buildRow([100, 100, 100], 400);
    SCROLL.set(host.firstElementChild!, 160);
    mount(host, { offsetNeededInPx: 0 });

    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
    expect(visibleCount(host)).toBe(3);
  });

  it("quality 3: measures what a squashed flex item WANTS, not what it was given", () => {
    // A flex item whose overflow is not `visible` has an automatic minimum size
    // of zero, so the browser squeezes it to whatever the row had left. Reading
    // its box then feeds the fit decision the answer it is trying to compute:
    // the total always equals the available width and the row always "fits".
    const host = buildRow([75, 75, 75, 75], 300);
    styleOverride(host, { display: "flex" });
    for (const child of Array.from(host.children) as HTMLElement[]) {
      styleOverride(child, { overflowX: "hidden", flexShrink: "1" });
      SCROLL.set(child, 100); // what the chip's text actually needs
    }

    mount(host, { offsetNeededInPx: 0 });

    expect(host.getAttribute("data-v-fit-state")).toBe("overflowing");
    expect(visibleCount(host)).toBe(3);
  });

  it("quality 3 control: a flex item that cannot shrink is still measured by its box", () => {
    const host = buildRow([75, 75, 75, 75], 300);
    styleOverride(host, { display: "flex" });
    for (const child of Array.from(host.children) as HTMLElement[]) {
      styleOverride(child, { overflowX: "hidden", flexShrink: "0" });
      SCROLL.set(child, 100);
    }

    mount(host, { offsetNeededInPx: 0 });

    // 4 x 75 = 300 in 300: it genuinely fits, and a clipping child that was
    // never squashed occupies its box.
    expect(host.getAttribute("data-v-fit-state")).toBe("fits");
    expect(visibleCount(host)).toBe(4);
  });

  it("quality 4: a scrollbar is not available width", () => {
    // `getBoundingClientRect` includes a classic scrollbar in the border box;
    // the space the children can actually use does not. 300px of chips into a
    // 300px host with a 15px scrollbar overflows.
    const host = buildRow([100, 100, 100], 300);
    CLIENT.set(host, 285);
    mount(host, { offsetNeededInPx: 0 });

    expect(host.getAttribute("data-v-fit-state")).toBe("overflowing");
    expect(visibleCount(host)).toBe(2);
  });

  it("quality 4 control: no scrollbar, no subtraction", () => {
    const host = buildRow([100, 100, 100], 300);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(3);
  });
});

// ── widthRestrictingContainer ────────────────────────────────────────

describe("widthRestrictingContainer", () => {
  /** A host that sizes to its children, inside a narrower ancestor. */
  function buildInContainer(widths: number[], containerWidth: number) {
    const container = document.createElement("div");
    WIDTHS.set(container, containerWidth);
    const host = document.createElement("div");
    host.dataset.host = "";
    widths.forEach((w, i) => {
      const child = document.createElement("span");
      child.textContent = `child-${i}`;
      WIDTHS.set(child, w);
      host.appendChild(child);
    });
    container.appendChild(host);
    document.body.appendChild(container);
    // The host reports the full run: it is content-sized and its children
    // overflow it, which is the one shape where the container bound matters.
    hostWidth = widths.reduce((sum, w) => sum + w, 0);
    return { container, host };
  }

  it("binds the budget when the host is wider than the container", () => {
    const { container, host } = buildInContainer([100, 100, 100, 100], 250);
    mount(host, { widthRestrictingContainer: container, offsetNeededInPx: 0 });

    // min(host 400, container 250) = 250, so two chips.
    expect(visibleCount(host)).toBe(2);
  });

  it("control: without the option the same row keeps every chip", () => {
    const { host } = buildInContainer([100, 100, 100, 100], 250);
    mount(host, { offsetNeededInPx: 0 });
    expect(visibleCount(host)).toBe(4);
  });

  it("is observed, so the row reacts when the container alone resizes", () => {
    const { container, host } = buildInContainer([100, 100, 100, 100], 250);
    mount(host, { widthRestrictingContainer: container, offsetNeededInPx: 0 });
    expect(MockResizeObserver.latest().targets).toContain(container);

    WIDTHS.set(container, 350);
    MockResizeObserver.latest().trigger([container]);
    expect(visibleCount(host)).toBe(3);
  });
});

// ── Decorative children ──────────────────────────────────────────────

describe("decorative children", () => {
  /** `A · B · C …` — a separator between every pair, as demo 08 renders it. */
  function buildSeparated(names: string[], available: number): HTMLElement {
    hostWidth = available;
    const host = document.createElement("div");
    host.dataset.host = "";
    names.forEach((name, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.textContent = "·";
        sep.setAttribute("data-v-fit-decorative", "");
        WIDTHS.set(sep, 10);
        host.appendChild(sep);
      }
      const chip = document.createElement("span");
      chip.textContent = name;
      WIDTHS.set(chip, 100);
      host.appendChild(chip);
    });
    document.body.appendChild(host);
    return host;
  }

  it("FIT-1 F4: never leaves a separator dangling at the end of the row", () => {
    // A(100) · B(100) · C(100) costs 320, and the separator that follows C
    // costs 330 — both inside 335, while D at 430 is not. So the row rendered
    // `A · B · C ·`, a separator introducing nothing.
    const host = buildSeparated(["A", "B", "C", "D"], 335);
    mount(host, { offsetNeededInPx: 0 });

    const laidOut = (Array.from(host.children) as HTMLElement[]).filter(
      (c) => !c.hasAttribute("data-v-fit-hidden"),
    );
    expect(laidOut.at(-1)?.textContent).toBe("C");
    expect(laidOut.map((c) => c.textContent).join(" ")).toBe("A · B · C");
  });

  it("counts a trimmed separator as hidden but never as data", () => {
    const host = buildSeparated(["A", "B", "C", "D"], 335);
    const seen: FitChildrenEventDetail<string>[] = [];
    host.addEventListener(EVENT, (e) => seen.push((e as CustomEvent).detail));
    mount(host, { data: ["A", "B", "C", "D"], offsetNeededInPx: 0 });

    expect(seen.at(-1)?.hiddenData).toEqual(["D"]);
    // D, plus the separator that would have introduced it.
    expect(seen.at(-1)?.hiddenChildrenCount).toBe(2);
  });

  it("leaves a trailing separator alone when the whole row fits", () => {
    const host = buildSeparated(["A", "B"], 800);
    const trailing = document.createElement("span");
    trailing.textContent = "·";
    trailing.setAttribute("data-v-fit-decorative", "");
    WIDTHS.set(trailing, 10);
    host.appendChild(trailing);

    mount(host, { offsetNeededInPx: 0 });
    expect(trailing.hasAttribute("data-v-fit-hidden")).toBe(false);
  });
});

// ── The badge feedback loop ──────────────────────────────────────────

describe("a badge whose WIDTH comes from the hidden count", () => {
  /**
   * The layout the loop guard exists for. A "+N · Name" badge beside the row is
   * rendered by the consumer FROM our own event, so its width is a function of
   * our last decision — and, because it names one of the hidden items, that
   * function is not monotonic: a short name gives back room a long one had
   * taken. Playground demo 02 is exactly this shape.
   *
   * The consumer's re-render happens AFTER the dispatch returns, never inside
   * it: Vue's listener sets a ref and the patch lands on the next flush. A rig
   * that re-renders inside the listener proves nothing, because the directive's
   * re-entrancy guard swallows everything a pass triggers in its own dispatch.
   */
  const BADGE_WIDTH: Record<number, number> = { 0: 0, 1: 30, 2: 160, 3: 40, 4: 40, 5: 40 };

  function buildFeedbackRow(chipCount: number, rowWidth: number) {
    const frame = document.createElement("div");
    const host = document.createElement("div");
    host.dataset.host = "";
    for (let i = 0; i < chipCount; i++) {
      const chip = document.createElement("span");
      chip.textContent = `chip-${i}`;
      WIDTHS.set(chip, 100);
      host.appendChild(chip);
    }
    frame.appendChild(host);
    document.body.appendChild(frame);
    hostWidth = rowWidth;

    let badge: HTMLElement | undefined;
    const rounds: number[] = [];
    let pending: number | undefined;

    host.addEventListener(EVENT, (e) => {
      pending = (e as CustomEvent<FitChildrenEventDetail>).detail.hiddenChildrenCount;
    });

    /** One consumer render: `v-if` the badge, label it, let the browser report it. */
    const render = (hiddenCount: number): void => {
      const wanted = BADGE_WIDTH[hiddenCount] ?? 40;
      if (wanted && !badge) {
        badge = document.createElement("span");
        frame.appendChild(badge);
      } else if (!wanted && badge) {
        badge.remove();
        badge = undefined;
      }
      if (badge) WIDTHS.set(badge, wanted);
      hostWidth = rowWidth - wanted;
      update(host, { offsetNeededInPx: 0 });
      if (badge) MockResizeObserver.latest().trigger([badge]);
    };

    /** Drain the queue the way a framework flush would, with a runaway cap. */
    const settle = (cap = 40): void => {
      for (let round = 0; round < cap; round++) {
        if (pending === undefined) return;
        const count = pending;
        pending = undefined;
        rounds.push(count);
        render(count);
      }
    };

    return {
      host,
      rounds,
      settle,
      get badgeWidth() {
        return badge ? (WIDTHS.get(badge) ?? 0) : 0;
      },
    };
  }

  it("settles rather than cycling forever", () => {
    const row = buildFeedbackRow(5, 400);
    mount(row.host, { offsetNeededInPx: 0 });
    row.settle();

    // It really did feed back on itself — otherwise this asserts nothing.
    expect(row.rounds.length).toBeGreaterThanOrEqual(3);
    expect(row.rounds.length).toBeLessThan(20);

    // And what it settled on is laid out inside the row it actually has.
    const shown = visibleCount(row.host);
    expect(shown).toBeGreaterThan(0);
    expect(shown * 100 + row.badgeWidth).toBeLessThanOrEqual(400);
  });

  it("still lets the row grow back when the row itself gets wider", () => {
    const row = buildFeedbackRow(5, 400);
    mount(row.host, { offsetNeededInPx: 0 });
    row.settle();
    const narrow = visibleCount(row.host);

    // A genuinely wider row is not the feedback loop, and must not be frozen
    // out by the record of runs that once proved too big.
    hostWidth = 900;
    MockResizeObserver.latest().trigger([row.host]);
    expect(visibleCount(row.host)).toBeGreaterThan(narrow);
  });
});
