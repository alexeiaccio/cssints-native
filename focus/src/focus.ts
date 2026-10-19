// Focus without a DOM: which entry has it, the Tab order, roving focus inside a group, and a stack to restore it.
// The rules are the APG patterns' (toolbar, tabs, radio) as the focusgroup contract states them, see README.md.

export type Key = "Tab" | "Shift+Tab" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export type Orientation = "horizontal" | "vertical" | "both";

export type EntryOptions = {
  // Document order. Default: registration order.
  order?: number;
  disabled?: boolean;
  // Below 0: not in the Tab order nor in the group's arrows; focus(id) still works (as tabindex=-1 does).
  tabIndex?: number;
  group?: string | undefined;
};

export type GroupOptions = {
  orientation: Orientation;
  wrap: boolean;
  // Tab back into the group lands on the member focused last.
  memory: boolean;
  // Where Tab lands when there is no memory. Default: the first member.
  entry?: string;
  // Disabled members stay focusable and reachable by the arrows (aria-disabled, as the APG toolbar does).
  focusDisabled?: boolean;
};

export type Listener = (next: string | null, prev: string | null) => void;

export type Focus = {
  register: (id: string, options?: EntryOptions) => void;
  unregister: (id: string) => void;
  group: (id: string, options: GroupOptions) => void;
  focused: () => string | null;
  focus: (id: string) => boolean;
  blur: () => void;
  key: (key: Key) => boolean;
  tabOrder: () => string[];
  onChange: (listener: Listener) => () => void;
  push: (id: string) => void;
  pop: () => string | null;
};

type Entry = { id: string; order: number; disabled: boolean; tabIndex: number; group?: string | undefined };

// A Tab stop: a plain entry, or a whole group (`group` set, `id` is the group, `target` the member it lands on).
type Stop = { id: string; order: number; group?: string | undefined; target: string };

export function createFocus(): Focus {
  const entries = new Map<string, Entry>();
  const groups = new Map<string, GroupOptions>();
  const memory = new Map<string, string>();
  const restore: string[] = [];
  const listeners = new Set<Listener>();
  let current: string | null = null;
  let seq = 0;

  const sorted = (): Entry[] => [...entries.values()].sort((a, b) => a.order - b.order);
  const focusable = (e: Entry): boolean =>
    !e.disabled || (e.group !== undefined && groups.get(e.group)?.focusDisabled === true);
  const navigable = (e: Entry): boolean => e.tabIndex >= 0 && focusable(e);
  const members = (group: string): Entry[] => sorted().filter((e) => e.group === group && navigable(e));

  // The member a Tab into the group lands on: the remembered one, else the entry, else the first.
  const entryOf = (group: string): string | undefined => {
    const options = groups.get(group)!;
    const list = members(group);
    const remembered = memory.get(group);
    if (options.memory && list.some((e) => e.id === remembered)) return remembered;
    if (list.some((e) => e.id === options.entry)) return options.entry;
    return list[0]?.id;
  };

  const stops = (): Stop[] => {
    const out: Stop[] = [];
    for (const e of sorted()) {
      if (!navigable(e)) continue;
      if (e.group === undefined) {
        out.push({ id: e.id, order: e.order, target: e.id });
      } else if (!out.some((s) => s.group === e.group)) {
        out.push({ id: e.group, order: e.order, group: e.group, target: entryOf(e.group)! });
      }
    }
    return out;
  };

  const setFocus = (id: string | null): void => {
    if (id === current) return;
    const prev = current;
    current = id;
    const group = id === null ? undefined : entries.get(id)?.group;
    if (id !== null && group !== undefined) memory.set(group, id);
    for (const listener of listeners) listener(id, prev);
  };

  // The focused entry stopped being focusable, from where it was: its nearest member, else the next stop, else none.
  const relocate = (at: { order: number; group?: string | undefined }): void => {
    if (at.group !== undefined) {
      const list = members(at.group);
      const next = list.find((e) => e.order > at.order) ?? list.at(-1);
      if (next !== undefined) {
        setFocus(next.id);
        return;
      }
    }
    setFocus(stops().find((s) => s.order > at.order)?.target ?? null);
  };

  const tab = (back: boolean): boolean => {
    const list = stops();
    const cur = current === null ? undefined : entries.get(current);
    let next: number;
    if (cur === undefined) {
      next = back ? list.length - 1 : 0;
    } else {
      const here = cur.group === undefined
        ? list.findIndex((s) => s.group === undefined && s.id === cur.id)
        : list.findIndex((s) => s.group === cur.group);
      if (here >= 0) next = back ? here - 1 : here + 1;
      else if (back) next = list.findLastIndex((s) => s.order < cur.order);
      else next = list.findIndex((s) => s.order > cur.order);
    }
    // Past either end, focus is released and the platform's own Tab takes over.
    const stop: Stop | undefined = list[next];
    setFocus(stop?.target ?? null);
    return stop !== undefined;
  };

  const move = (key: Key): boolean => {
    const cur = current === null ? undefined : entries.get(current);
    const group = cur?.group;
    if (cur === undefined || group === undefined) return false;
    const options = groups.get(group)!;
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    const vertical = key === "ArrowUp" || key === "ArrowDown";
    const owned = key === "Home" || key === "End"
      || (horizontal && options.orientation !== "vertical")
      || (vertical && options.orientation !== "horizontal");
    if (!owned) return false;
    const list = members(group);
    const forward = key === "ArrowRight" || key === "ArrowDown";
    let next: Entry | undefined;
    if (key === "Home") next = list[0];
    else if (key === "End") next = list.at(-1);
    else if (forward) next = list.find((e) => e.order > cur.order) ?? (options.wrap ? list[0] : undefined);
    else next = list.findLast((e) => e.order < cur.order) ?? (options.wrap ? list.at(-1) : undefined);
    if (next !== undefined) setFocus(next.id);
    // Owned keys are consumed even at a nowrap edge, where nothing moves.
    return true;
  };

  const register = (id: string, options: EntryOptions = {}): void => {
    if (options.group !== undefined && !groups.has(options.group)) {
      throw new Error(`focus: no group "${options.group}"`);
    }
    const before = entries.get(id);
    const entry: Entry = {
      id,
      order: options.order ?? before?.order ?? seq++,
      disabled: options.disabled ?? false,
      tabIndex: options.tabIndex ?? 0,
      group: options.group,
    };
    entries.set(id, entry);
    if (current === id && !focusable(entry)) relocate(before ?? entry);
  };

  const unregister = (id: string): void => {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entries.delete(id);
    if (entry.group !== undefined && memory.get(entry.group) === id) memory.delete(entry.group);
    if (current === id) relocate(entry);
  };

  const defineGroup = (id: string, options: GroupOptions): void => {
    groups.set(id, options);
    const cur = current === null ? undefined : entries.get(current);
    if (cur !== undefined && !focusable(cur)) relocate(cur);
  };

  const focus = (id: string): boolean => {
    const entry = entries.get(id);
    if (entry === undefined || !focusable(entry)) return false;
    setFocus(id);
    return true;
  };

  const key = (name: Key): boolean => (name === "Tab" || name === "Shift+Tab" ? tab(name === "Shift+Tab") : move(name));

  const pop = (): string | null => {
    while (restore.length > 0) {
      const id = restore.pop()!;
      if (focus(id)) return id;
    }
    return null;
  };

  return {
    register,
    unregister,
    group: defineGroup,
    focused: () => current,
    focus,
    blur: () => setFocus(null),
    key,
    tabOrder: () => stops().map((s) => s.target),
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push: (id) => {
      restore.push(id);
    },
    pop,
  };
}
