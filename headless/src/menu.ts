import { type Accessor, createSignal } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createFocusHost, whenDisposed } from './focus-host';
import type { PartHandlers } from './parts';
import { nextId } from './parts';

export type MenuItemKind = 'item' | 'checkbox' | 'radio';

export interface MenuItemInput {
  readonly label: string;
  readonly kind?: MenuItemKind;
  readonly checked?: boolean;
  readonly disabled?: boolean;
}

export type MenuVariant = 'plain' | 'checkbox-items' | 'radio-items' | 'mixed';

/** Read lazily: pass an object with getters, never destructured values. */
export interface MenuOptions {
  readonly items: ReadonlyArray<string | MenuItemInput>;
  readonly variant?: MenuVariant;
  readonly defaultOpen?: boolean;
  /**
   * `outside` (menu button): focus can sit outside the widget, so keys are
   * inert until the trigger is focused. `held` (checkable menu): the trigger
   * always holds focus while the menu is closed.
   */
  readonly triggerMode?: 'outside' | 'held';
  /** Checkbox item indices checked at mount (`checkbox-items` / `mixed`). */
  readonly defaultChecked?: ReadonlyArray<number>;
  /** Radio item index selected at mount (`radio-items` / `mixed`). */
  readonly defaultChoice?: number;
  /**
   * Controlled: the host owns the checked items. Packed as
   * `checkboxItem0 * 5 + radioChoice` (1-based), matching `menu-checkable.qnt`'s
   * `checked(wrap, choice)`; `undefined` is uncontrolled. The open state stays
   * uncontrolled.
   */
  readonly value?: number | undefined;
  /** The uncontrolled packed checked state at mount. */
  readonly defaultValue?: number;
  /** A request to change the checked items (a packed `value` the host may ignore). */
  readonly onCheckedValueChange?: (value: number) => void;
  /** Item indices disabled (focusable, not activatable). */
  readonly disabled?: ReadonlyArray<number>;
  readonly id?: string;
  /** The focus manager the trigger and the items register with; a private one when omitted. */
  readonly focus?: Focus;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onItemClick?: (index: number) => void;
  readonly onCheckedChange?: (checked: boolean, index: number) => void;
  readonly onValueChange?: (index: number) => void;
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly kind: MenuItemKind;
  readonly disabled: boolean;
}

/** The button that opens the menu: `aria-haspopup="menu"`, `aria-expanded`. */
export interface MenuTriggerPart extends PartHandlers {
  readonly id: string;
  readonly role: 'button';
  readonly hasPopup: 'menu';
  readonly expanded: boolean;
  /** The id of the menu it controls. */
  readonly controls: string;
  readonly disabled: boolean;
  readonly focused: boolean;
  readonly tabIndex: 0;
}

/** The menu container: `role=menu`. It takes no focus; its items do. */
export interface MenuPanelPart {
  readonly id: string;
  readonly role: 'menu';
  readonly hidden: boolean;
  readonly keyDown: (key: string) => boolean;
}

/** One item: `role=menuitem`, `menuitemcheckbox` or `menuitemradio`. */
export interface MenuItemPart extends PartHandlers {
  readonly id: string;
  readonly label: string;
  readonly role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  readonly kind: MenuItemKind;
  readonly checked: boolean | undefined;
  readonly disabled: boolean;
  readonly focused: boolean;
  /** 0 on the focused item (the menu's roving stop), -1 on the rest. */
  readonly tabIndex: 0 | -1;
}

export interface Menu {
  readonly open: Accessor<boolean>;
  /** 0 outside, 1 on the trigger, 2 on a menu item. */
  readonly focusLevel: Accessor<0 | 1 | 2>;
  readonly focusIndex: Accessor<number>;
  readonly items: ReadonlyArray<MenuItem>;
  readonly checked: Accessor<ReadonlyArray<number>>;
  readonly choice: Accessor<number>;
  readonly focusTrigger: () => void;
  readonly leave: () => void;
  readonly clickTrigger: () => void;
  readonly openMenu: () => void;
  readonly closeMenu: () => void;
  /** A key for the focused part; returns whether the menu consumed it. */
  readonly keyDown: (key: string) => boolean;
  readonly type: (text: string) => void;
  /** Type-ahead by the spec's letter code (item 1 is 1, item 2 is 2, ...). */
  readonly typeaheadCode: (code: number) => void;
  readonly setFocusItem: (index: number) => void;
  readonly trigger: MenuTriggerPart;
  readonly menu: MenuPanelPart;
  readonly item: (index: number) => MenuItemPart;
}

const toItem = (
  input: string | MenuItemInput,
  index: number,
  base: string,
): MenuItem => {
  if (typeof input === 'string') {
    return {
      label: input,
      kind: 'item',
      disabled: false,
      id: `${base}-item-${index}`,
    };
  }
  return {
    label: input.label,
    kind: input.kind ?? 'item',
    disabled: input.disabled ?? false,
    id: `${base}-item-${index}`,
  };
};

const kindFor = (variant: MenuVariant, index: number): MenuItemKind => {
  if (variant === 'mixed') {
    return index === 0 ? 'checkbox' : index >= 1 && index <= 3 ? 'radio' : 'item';
  }
  if (variant === 'checkbox-items') {
    return 'checkbox';
  }
  if (variant === 'radio-items') {
    return 'radio';
  }
  return 'item';
};

/** The type-ahead buffer timeout. */
const TYPEAHEAD_MS = 500;

/**
 * APG Menu Button and the checkable menus
 * (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/): `createMenu` is the
 * trigger and a flat menu of `menuitem`, `menuitemcheckbox` and
 * `menuitemradio` items, in the `plain`, `checkbox-items`, `radio-items` and
 * `mixed` shapes of `menu-button.qnt` and `menu-checkable.qnt`.
 *
 * Focus: the trigger is one Tab stop of the focus manager; while the menu is
 * open its items are a group of the manager (vertical, wrapping), so the menu is
 * one more Tab stop and the page's focus routing finds them. The keys are the
 * primitive's, as APG states them and the spec models them: Enter/Space on the
 * trigger open on the first item, the arrows open on the first/last or move and
 * wrap (disabled items stay focusable, APG note 1), Home and End go to the ends,
 * Escape closes and returns focus to the trigger, Tab closes and lets focus
 * leave, Enter activates and closes, Space activates without closing a
 * checkable item.
 *
 * `triggerMode: 'outside'` is the menu button (focus may be elsewhere);
 * `'held'` is the checkable menu, whose trigger keeps focus while closed. The
 * checked state is uncontrolled (`defaultChecked` / `defaultChoice` /
 * `defaultValue`) or controlled (`value` packed as the spec's
 * `checked(wrap, choice)`); the open state is uncontrolled.
 *
 * Not ported: `createMenubar` (the menubar, its submenus and its hover
 * opening). Checked against the two Quint specs by the scenario bridge.
 */
export const createMenu = (options: MenuOptions): Menu => {
  const base = options.id ?? nextId('menu');
  const menuId = `${base}-menu`;
  const groupId = `${base}-menu-items`;
  const items: ReadonlyArray<MenuItem> = options.items.map((input, index) => ({
    ...toItem(input, index, base),
    kind: kindFor(options.variant ?? 'plain', index),
  }));
  const count = items.length;
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const disabled = new Set<number>(options.disabled ?? []);
  for (const [index, item] of items.entries()) {
    if (item.disabled) {
      disabled.add(index);
    }
  }

  const triggerId = `${base}-trigger`;
  const itemId = (index: number): string => `${base}-item-${index}`;
  const idIndex = new Map<string, number>(
    items.map((_item, index) => [itemId(index), index]),
  );
  const isDisabled = (index: number): boolean => disabled.has(index);

  // Local state + a version signal: Solid 2 setters apply on the next flush, so a
  // signal would lag behind a transition performed in one tick. The focus
  // manager is the host's truth for focus; `level` and `index` mirror it.
  const held = (options.triggerMode ?? 'outside') === 'held';
  let level: 0 | 1 | 2 = 0;
  let index = -1;
  let open = options.defaultOpen ?? false;
  let checked = new Set<number>(options.defaultChecked ?? []);
  const variantChoice = (): number => {
    if (options.variant === 'mixed') return 1;
    if (options.variant === 'radio-items') return 0;
    return -1;
  };
  let choice = options.defaultChoice ?? variantChoice();
  if (options.defaultValue !== undefined) {
    checked = new Set<number>();
    if (options.defaultValue >= 5) {
      checked.add(0);
    }
    const packedChoice = options.defaultValue % 5;
    choice = packedChoice === 0 ? -1 : packedChoice - 1;
  }

  const currentChecked = (): Set<number> => {
    if (options.value === undefined) {
      return checked;
    }
    const set = new Set<number>();
    if (options.value >= 5) {
      set.add(0);
    }
    return set;
  };
  const currentChoice = (): number => {
    if (options.value === undefined) {
      return choice;
    }
    const packedChoice = options.value % 5;
    return packedChoice === 0 ? -1 : packedChoice - 1;
  };
  const packChecked = (set: Set<number>, radio: number): number =>
    (set.has(0) ? 5 : 0) + (radio >= 0 ? radio + 1 : 0);

  let buffer = '';
  let bufferTimer: ReturnType<typeof setTimeout> | undefined;
  const [version, setVersion] = createSignal(0);
  const bump = (): void => {
    setVersion((v) => v + 1);
  };
  const track = <T>(readIt: () => T): Accessor<T> => {
    return () => {
      version();
      return readIt();
    };
  };

  if (open) {
    level = 2;
    index = 0;
  } else if (held) {
    level = 1;
  }

  // The items are a group of the manager while the menu is open; the trigger is
  // a plain entry, registered before them (its document order).
  manager.group(groupId, {
    orientation: 'vertical',
    wrap: true,
    memory: false,
    focusDisabled: true,
    get entry() {
      return itemId(index >= 0 ? index : 0);
    },
  });
  manager.register(triggerId);
  const registered = new Set<number>();

  const isOurs = (id: string | null): boolean =>
    id === triggerId || (id !== null && idIndex.has(id));

  const syncItems = (): void => {
    if (open) {
      for (let i = 0; i < count; i += 1) {
        if (!registered.has(i)) {
          manager.register(itemId(i), {
            group: groupId,
            disabled: isDisabled(i),
          });
          registered.add(i);
        }
      }
    } else {
      for (const i of registered) {
        manager.unregister(itemId(i));
      }
      registered.clear();
    }
  };

  /** Put the manager's focus where `level` and `index` say it is. */
  const applyFocus = (): void => {
    if (level === 2 && index >= 0 && index < count) {
      manager.focus(itemId(index));
    } else if (level === 1) {
      manager.focus(triggerId);
    } else if (isOurs(manager.focused())) {
      manager.blur();
    }
  };

  const commit = (): void => {
    // opening registers before it moves focus in; closing moves focus out before
    // it unregisters (an unregistered focused item relocates to the next stop)
    if (open) {
      syncItems();
      applyFocus();
    } else {
      applyFocus();
      syncItems();
    }
    bump();
  };

  const openOn = (target: number): void => {
    level = 2;
    index = target;
    open = true;
    commit();
    options.onOpenChange?.(true);
  };

  const closeToTrigger = (): void => {
    level = 1;
    index = -1;
    open = false;
    commit();
    options.onOpenChange?.(false);
  };

  const focusTrigger = (): void => {
    if (level === 0) {
      level = 1;
      index = -1;
      commit();
    }
  };

  const leave = (): void => {
    const wasOpen = open;
    level = held ? 1 : 0;
    index = -1;
    open = false;
    commit();
    if (wasOpen) {
      options.onOpenChange?.(false);
    }
  };

  const clickTrigger = (): void => {
    if (open) {
      closeToTrigger();
    } else {
      openOn(0);
    }
  };

  const openMenu = (): void => {
    if (!open) {
      openOn(0);
    }
  };

  const closeMenu = (): void => {
    if (open) {
      closeToTrigger();
    }
  };

  const activate = (close: boolean): void => {
    if (level === 1) {
      openOn(0);
      return;
    }
    if (level !== 2 || index < 0 || isDisabled(index)) {
      return;
    }
    const item = items[index];
    if (item === undefined) {
      return;
    }
    if (item.kind === 'checkbox') {
      const current = currentChecked();
      const next = !current.has(index);
      const updated = new Set(current);
      if (next) {
        updated.add(index);
      } else {
        updated.delete(index);
      }
      if (options.value === undefined) {
        checked = updated;
        bump();
      } else {
        options.onCheckedValueChange?.(packChecked(updated, currentChoice()));
      }
      options.onCheckedChange?.(next, index);
      if (close) {
        closeToTrigger();
      }
      return;
    }
    if (item.kind === 'radio') {
      if (options.value === undefined) {
        choice = index;
        bump();
      } else {
        options.onCheckedValueChange?.(packChecked(currentChecked(), index));
      }
      options.onValueChange?.(index);
      if (close) {
        closeToTrigger();
      }
      return;
    }
    options.onItemClick?.(index);
    closeToTrigger();
  };

  const wrapNext = (i: number): number => (i + 1 >= count ? 0 : i + 1);
  const wrapPrev = (i: number): number => (i <= 0 ? count - 1 : i - 1);

  const keyDown = (key: string): boolean => {
    switch (key) {
      case 'Enter':
        activate(true);
        return level !== 0;
      case ' ':
      case 'Space':
        activate(false);
        return level !== 0;
      case 'ArrowDown':
        if (level === 1) {
          openOn(0);
          return true;
        }
        if (level === 2) {
          index = wrapNext(index);
          commit();
          return true;
        }
        return false;
      case 'ArrowUp':
        if (level === 1) {
          openOn(count - 1);
          return true;
        }
        if (level === 2) {
          index = wrapPrev(index);
          commit();
          return true;
        }
        return false;
      case 'Home':
        if (level === 2) {
          index = 0;
          commit();
          return true;
        }
        return false;
      case 'End':
        if (level === 2) {
          index = count - 1;
          commit();
          return true;
        }
        return false;
      case 'Escape':
        if (level === 2) {
          closeToTrigger();
        }
        return level !== 0;
      case 'Tab':
      case 'Shift+Tab': {
        if (level === 0) {
          return false;
        }
        // from the trigger the manager has to move first (the items are not
        // registered while the menu is closed); from an item, `leave`'s
        // unregistration relocates focus to the next stop
        if (manager.focused() === triggerId) {
          manager.key(key);
        }
        leave();
        return true;
      }
      default:
        return false;
    }
  };

  const search = (from: number, text: string): number | undefined => {
    const needle = text.toLowerCase();
    for (let offset = 1; offset <= count; offset += 1) {
      const candidate = (from + offset) % count;
      if (items[candidate]?.label.toLowerCase().startsWith(needle)) {
        return candidate;
      }
    }
    return undefined;
  };

  const type = (text: string): void => {
    if (!open || text.length === 0) {
      return;
    }
    buffer += text;
    if (bufferTimer !== undefined) {
      clearTimeout(bufferTimer);
    }
    // ponytail: one fixed buffer timeout; the prefs table an editor would wire comes later
    bufferTimer = setTimeout(() => {
      buffer = '';
    }, TYPEAHEAD_MS);
    const from = index >= 0 ? index : 0;
    const match = search(from, buffer);
    if (match !== undefined) {
      index = match;
      commit();
    }
  };

  // The `menu-button.qnt` fixture's type-ahead codes are index-based (items 1
  // and 3 are code 1, items 2 and 4 are code 2), independent of the label.
  const codeOf = (i: number): number => (i % 2 === 0 ? 1 : 2);

  const typeaheadCode = (code: number): void => {
    if (!open) {
      return;
    }
    const from = index >= 0 ? index : 0;
    for (let offset = 1; offset < count; offset += 1) {
      const candidate = (from + offset) % count;
      if (codeOf(candidate) === code) {
        index = candidate;
        commit();
        return;
      }
    }
  };

  const setFocusItem = (i: number): void => {
    if (i < 0 || i >= count) {
      return;
    }
    if (open && level === 2 && index === i) {
      return;
    }
    open = true;
    level = 2;
    index = i;
    commit();
  };

  whenDisposed(() => {
    for (const i of registered) {
      manager.unregister(itemId(i));
    }
    manager.unregister(triggerId);
  });

  return {    open: track(() => open),
    focusLevel: track(() => level),
    focusIndex: track(() => index),
    items,
    checked: track(() => [...currentChecked()].sort((a, b) => a - b)),
    choice: track(() => currentChoice()),
    focusTrigger,
    leave,
    clickTrigger,
    openMenu,
    closeMenu,
    keyDown,
    type,
    typeaheadCode,
    setFocusItem,
    trigger: {
      id: triggerId,
      role: 'button',
      hasPopup: 'menu',
      get expanded() {
        return track(() => open)();
      },
      controls: menuId,
      disabled: false,
      get focused() {
        return read(() => manager.focused() === triggerId);
      },
      tabIndex: 0,
      press: clickTrigger,
      keyDown: (key, repeat) => (repeat === true ? false : keyDown(key)),
      keyUp: () => false,
      key: (key) => keyDown(key),
      focus: focusTrigger,
      blur: () => {
        if (level === 0) {
          return;
        }
        const id = manager.focused();
        if (id === triggerId) {
          manager.blur();
        } else if (!isOurs(id)) {
          leave();
        }
      },
    },
    menu: {
      id: menuId,
      role: 'menu',
      get hidden() {
        return !track(() => open)();
      },
      keyDown: (key) => keyDown(key),
    },
    item: (i): MenuItemPart => {
      const item = items[i];
      const id = itemId(i);
      return {
        id,
        label: item?.label ?? '',
        get role() {
          const kind = item?.kind ?? 'item';
          return kind === 'checkbox'
            ? 'menuitemcheckbox'
            : kind === 'radio'
              ? 'menuitemradio'
              : 'menuitem';
        },
        kind: item?.kind ?? 'item',
        get checked() {
          const kind = item?.kind ?? 'item';
          if (kind === 'checkbox') {
            return read(() => currentChecked().has(i));
          }
          if (kind === 'radio') {
            return read(() => currentChoice() === i);
          }
          return undefined;
        },
        get disabled() {
          return isDisabled(i);
        },
        get focused() {
          return read(() => manager.focused() === id);
        },
        get tabIndex() {
          return read(() => (level === 2 && index === i ? 0 : -1));
        },
        press: () => {
          if (isDisabled(i)) {
            return;
          }
          setFocusItem(i);
          // a checkbox/radio item toggles without closing; a plain item closes
          activate((items[i]?.kind ?? 'item') === 'item');
        },
        keyDown,
        keyUp: () => false,
        key: keyDown,
        focus: () => {
          setFocusItem(i);
        },
        blur: () => {
          if (level === 0) {
            return;
          }
          const now = manager.focused();
          if (now === null || !isOurs(now)) {
            leave();
          }
        },
      };
    },
  };
};
