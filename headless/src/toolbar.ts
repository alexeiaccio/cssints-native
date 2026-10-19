import type { Accessor } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createFocusHost, moveKey, tabKey, whenDisposed } from './focus-host';
import { type PartHandlers, nextId } from './parts';

/**
 * APG Toolbar: a `toolbar` of items, one tab stop, arrows along its axis,
 * Home/End, and a Tab that leaves it. A faithful port of `specs/apg/toolbar.qnt`.
 *
 * The roving tab stop is the focus manager's group (`memory`: Tab back in lands
 * on the item focused last; `focusDisabled`: a disabled item stays reachable,
 * as `aria-disabled` items do in APG). The toolbar owns the spec's delta on top:
 * the wrap choice, `aria-orientation`, activation (Enter and Space on a button),
 * and embedded controls that consume their own keys (a `text` item takes the
 * arrows of its axis and Home/End; a `spin` item takes Up, Down, Home, End), and
 * a Tab from a `text` item steps to the neighbour instead of leaving.
 *
 * ponytail: the item kinds are the three the spec models (button, text, spin);
 * separators, RTL and the embedded controls' own values are not modelled.
 */

export type ToolbarOrientation = 'horizontal' | 'vertical';
export type ToolbarItemKind = 'button' | 'text' | 'spin';

export interface ToolbarItemInput {
  readonly label: string;
  readonly kind?: ToolbarItemKind;
  readonly disabled?: boolean;
}

export interface ToolbarOptions {
  readonly items: ReadonlyArray<string | ToolbarItemInput>;
  readonly kinds?: ReadonlyArray<ToolbarItemKind>;
  readonly orientation?: ToolbarOrientation;
  readonly wrap?: boolean;
  readonly defaultFocus?: number;
  /** Item indices disabled at mount (aria-disabled, still focusable). */
  readonly disabled?: ReadonlyArray<number>;
  readonly id?: string;
  /** The focus manager the items register with; a private one when omitted. */
  readonly focus?: Focus;
  readonly onActivate?: (index: number) => void;
}

/** The toolbar: `role=toolbar`. It takes no focus; its items do. Its `keyDown` is Tab from outside: enter the toolbar. */
export interface ToolbarPart {
  readonly id: string;
  readonly role: 'toolbar';
  readonly orientation: ToolbarOrientation;
  readonly keyDown: (key: string) => boolean;
}

/** One item: `role=button`, with its kind and its handlers. */
export interface ToolbarItemPart extends PartHandlers {
  readonly id: string;
  readonly role: 'button';
  readonly label: string;
  readonly kind: ToolbarItemKind;
  readonly disabled: boolean;
  readonly focused: boolean;
  /** 0 for the tab stop, -1 for the rest. */
  readonly tabIndex: number;
}

export interface Toolbar {
  /** The focused item's index, or -1 when focus is outside. */
  readonly focus: Accessor<number>;
  /** The item a Tab into the toolbar lands on (the last focused one, else the first). */
  readonly tabStop: Accessor<number>;
  readonly orientation: Accessor<ToolbarOrientation>;
  readonly wrap: Accessor<boolean>;
  readonly toolbar: ToolbarPart;
  readonly items: ReadonlyArray<ToolbarItemPart>;
  /** Tab into the toolbar at its tab stop. */
  readonly focusIn: () => void;
  readonly leave: () => void;
  readonly focusItem: (index: number) => void;
  /** A key for the focused item; returns whether it was consumed. */
  readonly keyDown: (key: string) => boolean;
  /** Tab or Shift+Tab (`back`); returns whether focus stayed in the toolbar. */
  readonly tab: (back: boolean) => boolean;
  readonly clickItem: (index: number) => void;
  readonly activate: () => void;
  readonly toggleDisabled: (index: number) => void;
  readonly setOrientation: (orientation: ToolbarOrientation) => void;
  readonly setWrap: (wrap: boolean) => void;
}

const isEdge = (key: string): boolean => key === 'Home' || key === 'End';

const forwardKey = (orientation: ToolbarOrientation): string =>
  orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
const backwardKey = (orientation: ToolbarOrientation): string =>
  orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

const isNavKey = (orientation: ToolbarOrientation, key: string): boolean =>
  key === forwardKey(orientation) ||
  key === backwardKey(orientation) ||
  isEdge(key);

export const createToolbar = (options: ToolbarOptions): Toolbar => {
  const base = options.id ?? nextId('toolbar');
  const groupId = `${base}-group`;
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const itemId = (index: number): string => `${base}-item-${index}`;
  const count = options.items.length;
  const indexById = new Map<string, number>(
    Array.from({ length: count }, (_value, index) => [itemId(index), index]),
  );

  const labels = options.items.map((input) =>
    typeof input === 'string' ? input : input.label,
  );
  const kinds: ToolbarItemKind[] = options.items.map(
    (input, index): ToolbarItemKind =>
      (typeof input === 'string' ? undefined : input.kind) ??
      options.kinds?.[index] ??
      'button',
  );
  const disabledMask = new Set<number>(options.disabled ?? []);
  options.items.forEach((input, index) => {
    if (typeof input !== 'string' && input.disabled === true) {
      disabledMask.add(index);
    }
  });

  let orientation: ToolbarOrientation = options.orientation ?? 'horizontal';
  let wrap = options.wrap ?? false;

  manager.group(groupId, {
    get orientation() {
      return orientation;
    },
    get wrap() {
      return wrap;
    },
    memory: true,
    focusDisabled: true,
    entry: itemId(options.defaultFocus ?? 0),
  });
  for (let index = 0; index < count; index += 1) {
    manager.register(itemId(index), { group: groupId });
  }
  whenDisposed(() => {
    for (let index = 0; index < count; index += 1) {
      manager.unregister(itemId(index));
    }
  });

  const focusedItem = (): number => {
    const id = manager.focused();
    return id === null ? -1 : (indexById.get(id) ?? -1);
  };
  const tabStopItem = (): number => {
    const stop = manager.tabOrder().find((id) => indexById.has(id));
    return stop === undefined ? -1 : (indexById.get(stop) ?? -1);
  };
  const kindOf = (index: number): ToolbarItemKind => kinds[index] ?? 'button';
  const isDisabled = (index: number): boolean => disabledMask.has(index);
  const activates = (index: number): boolean =>
    index >= 0 && kindOf(index) === 'button' && !isDisabled(index);

  const onActivate = (index: number): void => {
    if (activates(index)) {
      options.onActivate?.(index);
    }
  };

  // an embedded control keeps the keys it edits: a text item the arrows of its axis, a spin item Up, Down and the edges
  const captures = (index: number, key: string): boolean => {
    const kind = kindOf(index);
    if (kind === 'text') {
      return isNavKey(orientation, key);
    }
    return kind === 'spin' && (key === 'ArrowUp' || key === 'ArrowDown' || isEdge(key));
  };

  const focusIn = (): void => {
    if (focusedItem() >= 0) {
      return;
    }
    const stop = manager.tabOrder().find((id) => indexById.has(id));
    if (stop !== undefined) {
      manager.focus(stop);
    }
  };

  const leave = (): void => {
    if (focusedItem() >= 0) {
      manager.blur();
    }
  };

  const focusItem = (index: number): void => {
    if (index >= 0 && index < count) {
      manager.focus(itemId(index));
    }
  };

  const clickItem = (index: number): void => {
    if (index < 0 || index >= count) {
      return;
    }
    manager.focus(itemId(index));
    onActivate(index);
  };

  const activate = (): void => {
    onActivate(focusedItem());
  };

  const keyDown = (key: string): boolean => {
    const current = focusedItem();
    const back = tabKey(key);
    if (back !== undefined) {
      return tab(back === 'Shift+Tab');
    }
    if (key === 'Enter' || key === ' ' || key === 'Space') {
      activate();
      return true;
    }
    const name = moveKey(key);
    if (name === undefined || !isNavKey(orientation, key)) {
      return false;
    }
    if (current >= 0 && captures(current, key)) {
      return true;
    }
    manager.key(name);
    return true;
  };

  const tab = (back: boolean): boolean => {
    const current = focusedItem();
    if (current < 0) {
      focusIn();
      return focusedItem() >= 0;
    }
    if (kindOf(current) === 'text') {
      const next = back ? current - 1 : current + 1;
      if (next >= 0 && next < count) {
        manager.focus(itemId(next));
        return true;
      }
    }
    // from a plain item, Tab leaves the toolbar: the manager's next stop, or none
    manager.key(back ? 'Shift+Tab' : 'Tab');
    return focusedItem() >= 0;
  };

  const items: ToolbarItemPart[] = labels.map((label, index) => {
    const id = itemId(index);
    return {
      id,
      role: 'button',
      label,
      kind: kindOf(index),
      get disabled() {
        return read(() => isDisabled(index));
      },
      get focused() {
        return read(() => manager.focused() === id);
      },
      get tabIndex() {
        return read(() => (tabStopItem() === index ? 0 : -1));
      },
      press: () => {
        clickItem(index);
      },
      keyDown,
      keyUp: () => false,
      key: keyDown,
      focus: () => {
        focusItem(index);
      },
      blur: () => {
        if (manager.focused() === id) {
          manager.blur();
        }
      },
    };
  });

  return {
    focus: () => read(focusedItem),
    tabStop: () => read(tabStopItem),
    orientation: () => read(() => orientation),
    wrap: () => read(() => wrap),
    toolbar: {
      id: base,
      role: 'toolbar',
      get orientation() {
        return read(() => orientation);
      },
      // Tab from outside the toolbar enters it at its tab stop
      keyDown: (key) => {
        const back = tabKey(key);
        if (back === undefined || focusedItem() >= 0) {
          return false;
        }
        return tab(back === 'Shift+Tab');
      },
    },
    items,
    focusIn,
    leave,
    focusItem,
    keyDown,
    tab,
    clickItem,
    activate,
    toggleDisabled: (index) => {
      if (disabledMask.has(index)) {
        disabledMask.delete(index);
      } else {
        disabledMask.add(index);
      }
      host.changed();
    },
    setOrientation: (next) => {
      orientation = next;
      host.changed();
    },
    setWrap: (next) => {
      wrap = next;
      host.changed();
    },
  };
};
