// Run: node focus/test/focus.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createFocus } from "../src/focus.ts";
import type { Focus, GroupOptions, Key } from "../src/focus.ts";

// a, then a group g of m1 m2 m3, then b
function row(options: GroupOptions): Focus {
  const f = createFocus();
  f.register("a");
  f.group("g", options);
  f.register("m1", { group: "g" });
  f.register("m2", { group: "g" });
  f.register("m3", { group: "g" });
  f.register("b");
  return f;
}

const plain: GroupOptions = { orientation: "horizontal", wrap: true, memory: false };

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("Tab order: plain entries and a group are one stop each", () => {
  const f = row(plain);
  assert.deepEqual(f.tabOrder(), ["a", "m1", "b"]);
  assert.equal(f.key("Tab"), true);
  assert.equal(f.focused(), "a");
  assert.equal(f.key("Tab"), true);
  assert.equal(f.focused(), "m1");
  assert.equal(f.key("Tab"), true);
  assert.equal(f.focused(), "b");
  assert.equal(f.key("Tab"), false);
  assert.equal(f.focused(), null);
});

test("Shift+Tab walks back; from nothing it starts at the end", () => {
  const f = row(plain);
  assert.equal(f.key("Shift+Tab"), true);
  assert.equal(f.focused(), "b");
  assert.equal(f.key("Shift+Tab"), true);
  assert.equal(f.focused(), "m1");
  assert.equal(f.key("Shift+Tab"), true);
  assert.equal(f.focused(), "a");
  assert.equal(f.key("Shift+Tab"), false);
  assert.equal(f.focused(), null);
});

test("Tab from any member leaves the group, in both directions", () => {
  const f = row(plain);
  for (const m of ["m1", "m2", "m3"]) {
    f.focus(m);
    f.key("Tab");
    assert.equal(f.focused(), "b");
  }
  f.focus("m2");
  f.key("Shift+Tab");
  assert.equal(f.focused(), "a");
});

test("wrap: the arrows go round the group", () => {
  const f = row({ ...plain, wrap: true });
  f.focus("m1");
  f.key("ArrowRight");
  assert.equal(f.focused(), "m2");
  f.key("ArrowRight");
  f.key("ArrowRight");
  assert.equal(f.focused(), "m1");
  f.key("ArrowLeft");
  assert.equal(f.focused(), "m3");
});

test("nowrap: the arrows stop at the ends, and the key is still handled", () => {
  const f = row({ ...plain, wrap: false });
  f.focus("m1");
  assert.equal(f.key("ArrowLeft"), true);
  assert.equal(f.focused(), "m1");
  f.focus("m3");
  assert.equal(f.key("ArrowRight"), true);
  assert.equal(f.focused(), "m3");
});

test("orientation: a horizontal group ignores ArrowUp and ArrowDown, a vertical one Left and Right", () => {
  const h = row(plain);
  h.focus("m1");
  assert.equal(h.key("ArrowDown"), false);
  assert.equal(h.focused(), "m1");

  const v = row({ ...plain, orientation: "vertical" });
  v.focus("m1");
  assert.equal(v.key("ArrowRight"), false);
  assert.equal(v.key("ArrowDown"), true);
  assert.equal(v.focused(), "m2");

  const both = row({ ...plain, orientation: "both" });
  both.focus("m1");
  both.key("ArrowDown");
  assert.equal(both.focused(), "m2");
  both.key("ArrowLeft");
  assert.equal(both.focused(), "m1");
});

test("Home and End jump to the first and last member; outside a group they are not handled", () => {
  const f = row(plain);
  f.focus("m2");
  f.key("End");
  assert.equal(f.focused(), "m3");
  f.key("Home");
  assert.equal(f.focused(), "m1");
  f.focus("a");
  assert.equal(f.key("Home"), false);
  assert.equal(f.key("ArrowRight"), false);
  assert.equal(f.focused(), "a");
});

test("memory: Tab back into the group lands on the member focused last", () => {
  const f = row({ ...plain, memory: true });
  f.focus("m2");
  f.key("Tab");
  f.key("Shift+Tab");
  assert.equal(f.focused(), "m2");
});

test("no memory: Tab lands on the entry, else the first member", () => {
  const f = row(plain);
  f.focus("m2");
  f.key("Tab");
  f.key("Shift+Tab");
  assert.equal(f.focused(), "m1");

  const e = row({ ...plain, entry: "m3" });
  e.focus("m2");
  e.key("Tab");
  e.key("Shift+Tab");
  assert.equal(e.focused(), "m3");
});

test("memory falls back to the entry when the remembered member is disabled", () => {
  const f = row({ ...plain, memory: true, entry: "m3" });
  f.focus("m2");
  f.key("Tab");
  f.register("m2", { group: "g", disabled: true });
  f.key("Shift+Tab");
  assert.equal(f.focused(), "m3");
});

test("disabled entries are skipped by Tab and the arrows", () => {
  const f = row(plain);
  f.register("m2", { group: "g", disabled: true });
  f.focus("m1");
  f.key("ArrowRight");
  assert.equal(f.focused(), "m3");
  assert.equal(f.focus("m2"), false);

  f.register("b", { disabled: true });
  assert.deepEqual(f.tabOrder(), ["a", "m1"]);
  assert.equal(f.focus("b"), false);

  f.register("m1", { group: "g", disabled: true });
  f.register("m3", { group: "g", disabled: true });
  assert.deepEqual(f.tabOrder(), ["a"]);
});

test("focusDisabled: disabled members of the group stay focusable and reachable", () => {
  const f = row({ ...plain, focusDisabled: true });
  f.register("m2", { group: "g", disabled: true });
  f.focus("m1");
  f.key("ArrowRight");
  assert.equal(f.focused(), "m2");
  assert.equal(f.focus("m2"), true);

  f.register("b", { disabled: true });
  assert.equal(f.focus("b"), false);
});

test("tabIndex below 0 keeps an entry out of the Tab order and the arrows, not out of focus(id)", () => {
  const f = row(plain);
  f.register("m2", { group: "g", tabIndex: -1 });
  f.focus("m1");
  f.key("ArrowRight");
  assert.equal(f.focused(), "m3");
  assert.equal(f.focus("m2"), true);

  f.register("x", { tabIndex: -1 });
  assert.equal(f.tabOrder().includes("x"), false);
  assert.equal(f.focus("x"), true);
});

test("unregister of the focused plain entry moves to the next stop, else none", () => {
  const f = row(plain);
  f.focus("a");
  f.unregister("a");
  assert.equal(f.focused(), "m1");
  f.focus("b");
  f.unregister("b");
  assert.equal(f.focused(), null);
});

test("unregister of the focused member moves to a neighbour in the group, then to the next stop", () => {
  const f = row(plain);
  f.focus("m2");
  f.unregister("m2");
  assert.equal(f.focused(), "m3");
  f.unregister("m3");
  assert.equal(f.focused(), "m1");
  f.unregister("m1");
  assert.equal(f.focused(), "b");
});

test("an entry that becomes disabled while focused hands the focus on", () => {
  const f = row(plain);
  f.focus("m2");
  f.register("m2", { group: "g", disabled: true });
  assert.equal(f.focused(), "m3");
  f.focus("a");
  f.register("a", { disabled: true });
  assert.equal(f.focused(), "m1");
});

test("turning focusDisabled off moves focus off a disabled member", () => {
  const f = row({ ...plain, focusDisabled: true });
  f.register("m2", { group: "g", disabled: true });
  f.focus("m2");
  f.group("g", { ...plain, focusDisabled: false });
  assert.equal(f.focused(), "m3");
});

test("restore stack: pop returns focus to the trigger", () => {
  const f = row(plain);
  f.focus("m2");
  f.push("m2");
  f.register("dialog", { order: 10 });
  f.focus("dialog");
  assert.equal(f.pop(), "m2");
  assert.equal(f.focused(), "m2");
  assert.equal(f.pop(), null);
  assert.equal(f.focused(), "m2");
});

test("restore stack: nested dialogs unwind in order, stale triggers are skipped", () => {
  const f = row(plain);
  f.focus("a");
  f.push("a");
  f.focus("b");
  f.push("b");
  f.focus("m1");
  f.unregister("b");
  f.push("gone");
  f.focus("m3");
  assert.equal(f.pop(), "a");
  assert.equal(f.focused(), "a");
  assert.equal(f.pop(), null);
});

test("onChange is called once per real change", () => {
  const f = row(plain);
  const seen: Array<[string | null, string | null]> = [];
  const off = f.onChange((next, prev) => seen.push([next, prev]));
  f.focus("a");
  f.focus("a");
  f.key("Tab");
  f.key("Tab");
  f.blur();
  f.blur();
  f.unregister("m1");
  f.focus("b");
  assert.deepEqual(seen, [
    ["a", null],
    ["m1", "a"],
    ["b", "m1"],
    [null, "b"],
    ["b", null],
  ]);
  off();
  f.focus("a");
  assert.equal(seen.length, 5);
});

test("the Focus API rejects a member of an unknown group", () => {
  const f = createFocus();
  assert.throws(() => f.register("x", { group: "nope" }), /no group "nope"/);
});

test("random walk keeps the invariants after every step", () => {
  const groupOf = (id: string): string | undefined => (id.startsWith("m") ? "g" : id.startsWith("n") ? "h" : undefined);
  const ids = ["p0", "p1", "p2", "m0", "m1", "m2", "m3", "n0", "n1", "n2"];
  const keys: Key[] = ["Tab", "Shift+Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

  for (let seed = 1; seed <= 40; seed++) {
    const rand = random(seed);
    const f = createFocus();
    f.group("g", { orientation: "horizontal", wrap: true, memory: true, entry: "m1" });
    f.group("h", { orientation: "both", wrap: false, memory: false, focusDisabled: true });
    const registered = new Map<string, boolean>();
    let observed: string | null = null;
    f.onChange((next, prev) => {
      assert.notEqual(next, prev);
      assert.equal(prev, observed);
      observed = next;
    });

    for (let step = 0; step < 300; step++) {
      const id = pick(rand, ids);
      const roll = rand();
      const before = f.focused();
      let key: Key | undefined;
      let moved: boolean | undefined;

      if (roll < 0.2) {
        const disabled = rand() < 0.3;
        f.register(id, { group: groupOf(id), disabled, tabIndex: rand() < 0.1 ? -1 : 0 });
        registered.set(id, disabled);
      } else if (roll < 0.3) {
        f.unregister(id);
        registered.delete(id);
      } else if (roll < 0.4) {
        moved = f.focus(id);
        if (moved) assert.equal(f.focused(), id);
        else assert.equal(f.focused(), before);
      } else if (roll < 0.45) {
        f.blur();
        assert.equal(f.focused(), null);
      } else if (roll < 0.8) {
        key = pick(rand, keys);
        moved = f.key(key);
      } else if (roll < 0.9) {
        f.push(id);
      } else {
        const popped = f.pop();
        assert.ok(popped === null || f.focused() === popped);
      }

      const now = f.focused();
      assert.equal(now, observed, "onChange tracks focused()");
      if (now !== null) {
        assert.ok(registered.has(now), `focused ${now} is registered`);
        const disabled = registered.get(now)!;
        assert.ok(!disabled || groupOf(now) === "h", `focused ${now} is not disabled`);
      }
      for (const target of f.tabOrder()) {
        assert.ok(registered.has(target), `tab stop ${target} is registered`);
      }
      for (const g of ["g", "h"]) {
        assert.ok(f.tabOrder().filter((t) => groupOf(t) === g).length <= 1, `one tab stop for group ${g}`);
      }
      if (key !== undefined && before !== null && groupOf(before) !== undefined) {
        const group = groupOf(before);
        if (key === "Tab" || key === "Shift+Tab") {
          assert.notEqual(groupOf(now ?? ""), group, `${key} from ${before} leaves its group`);
        } else if (moved && now !== null) {
          assert.equal(groupOf(now), group, `${key} stays in the group of ${before}`);
        }
      }
      if (key !== undefined && (key !== "Tab" && key !== "Shift+Tab") && moved === false) {
        assert.equal(now, before, `unhandled ${key} leaves focus alone`);
      }
    }
  }
});
