// @vitest-environment node
//
// The invariants ARCHITECTURE.md names, asserted against the source text rather
// than against behaviour — because every one of them is a rule about WHERE code
// may live, and a behavioural test cannot see a second measurement that happens
// to agree with the first one today.
//
// Both of the invariants below were broken in 2.2.0 while the whole behavioural
// suite stayed green, and both were described in prose as impossible.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "src");

const modules = readdirSync(SRC)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(SRC, name), "utf8") }));

/** Comments explain the rule; only real code can break it. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ARCHITECTURE: one measurement per pass", () => {
  // The defect class that produced partially-visible children for the whole of
  // 2.x, and that came back through `observers.ts` storing ResizeObserver
  // content rects — a different geometry definition, taken in a different DOM
  // state, feeding the same `min(host, container)`.
  const LAYOUT_APIS = [
    "getBoundingClientRect",
    "getClientRects",
    "getComputedStyle",
    "scrollWidth",
    "offsetWidth",
    "clientWidth",
    "offsetHeight",
    "clientHeight",
  ];

  it("reads layout in measure.ts and nowhere else", () => {
    const offenders = modules
      .filter((module) => module.name !== "measure.ts")
      .flatMap((module) =>
        LAYOUT_APIS.filter((api) => code(module.text).includes(api)).map(
          (api) => `${module.name} calls ${api}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("control: measure.ts really does contain the APIs being searched for", () => {
    // Otherwise the assertion above passes by searching for nothing. The
    // height APIs are on the ban list without being used anywhere: this is a
    // width-only package, and the point of listing them is that reading one
    // would be a new measurement in a new module.
    const measure = modules.find((module) => module.name === "measure.ts")!;
    for (const api of [
      "getBoundingClientRect",
      "getComputedStyle",
      "scrollWidth",
      "offsetWidth",
      "clientWidth",
    ]) {
      expect(code(measure.text)).toContain(api);
    }
  });
});

describe("ARCHITECTURE: hiding never touches el.style.display", () => {
  // `v-show`, Vue's style-prop patcher and <Transition> all write that
  // property. A fourth writer means the last one wins — and `isConsumerHidden`
  // would silently invert, because it reads the same property to decide who hid
  // a child.
  it("never assigns style.display", () => {
    const offenders = modules
      .filter((module) => /\.style\.display\s*=[^=]/.test(code(module.text)))
      .map((module) => module.name);
    expect(offenders).toEqual([]);
  });

  it("control: the ownership test that depends on it is still there", () => {
    const dom = modules.find((module) => module.name === "dom.ts")!;
    expect(code(dom.text)).toContain("child.style.display === 'none'");
  });
});

describe("ARCHITECTURE: the module graph points strictly downward", () => {
  // No cycles, and a leaf stays a leaf: `constants.ts` and `types.ts` import
  // nothing, so anything may depend on them.
  it("keeps constants.ts and types.ts free of imports", () => {
    for (const name of ["constants.ts", "types.ts"]) {
      const module = modules.find((entry) => entry.name === name)!;
      expect(code(module.text)).not.toMatch(/^import\s/m);
    }
  });

  it("has no import cycles", () => {
    const edges = new Map<string, string[]>(
      modules.map((module) => [
        module.name,
        [...code(module.text).matchAll(/from '\.\/(\w+)'/g)].map(
          (match) => `${match[1]}.ts`,
        ),
      ]),
    );

    const cycles: string[] = [];
    const walk = (node: string, seen: string[]): void => {
      for (const next of edges.get(node) ?? []) {
        if (seen.includes(next)) {
          cycles.push([...seen, next].join(" -> "));
          continue;
        }
        walk(next, [...seen, next]);
      }
    };
    for (const module of modules) walk(module.name, [module.name]);
    expect(cycles).toEqual([]);
  });
});
