import type { Accessor } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createFocusHost, whenDisposed } from './focus-host';
import type { PartHandlers } from './parts';
import { nextId } from './parts';

export interface MenubarMenuItemInput {
  readonly label: string;
  readonly submenu?: ReadonlyArray<MenubarMenuItemInput>;
  readonly disabled?: boolean;
}

export interface MenubarItemInput {
  readonly label: string;
  readonly menu?: ReadonlyArray<MenubarMenuItemInput>;
  readonly disabled?: boolean;
}

export interface MenubarOptions {
  readonly items: ReadonlyArray<string | MenubarItemInput>;
  /** The bar's axis, for `aria-orientation` and the manager's group. The keys are the spec's horizontal ones. */
  readonly orientation?: 'horizontal' | 'vertical';
  readonly id?: string;
  /** The focus manager the bar and the open menus register with; a private one when omitted. */
  readonly focus?: Focus;
  /** A leaf was activated (Enter, Space or a click): the path of its bar item, its menu item and its submenu item. */
  readonly onActivate?: (path: ReadonlyArray<number>) => void;
  /** The open top menu changed (`-1`: none). */
  readonly onOpenChange?: (openTop: number) => void;
}

export interface MenubarItem {
  readonly id: string;
  readonly label: string;
  readonly menu: ReadonlyArray<MenubarMenuItem>;
  readonly disabled: boolean;
}

export interface MenubarMenuItem {
  readonly id: string;
  readonly label: string;
  readonly submenu: ReadonlyArray<MenubarMenuItem>;
  readonly disabled: boolean;
}

/** The bar: `role=menubar`. It takes no focus; its items do. Its `keyDown` is for a host that focuses the bar itself. */
export interface MenubarPart {
  readonly id: string;
  readonly role: 'menubar';
  readonly orientation: 'horizontal' | 'vertical';
  readonly keyDown: (key: string) => boolean;
}

/** One bar item: `role=menuitem`, `aria-haspopup` and `aria-expanded` when it owns a menu, roving `tabIndex`. */
export interface MenubarBarItemPart extends PartHandlers {
  readonly id: string;
  readonly role: 'menuitem';
  readonly label: string;
  readonly hasPopup: 'menu' | undefined;
  readonly expanded: boolean | undefined;
  readonly tabIndex: 0 | -1;
  readonly disabled: boolean;
  readonly focused: boolean;
}

/** One menu: `role=menu`. It takes no focus; its items do. */
export interface MenubarMenuPart {
  readonly id: string;
  readonly role: 'menu';
  readonly hidden: boolean;
}

/** One item of a top-level menu or of a submenu: `role=menuitem`, with `aria-haspopup` on a parent. */
export interface MenubarMenuItemPart extends PartHandlers {
  readonly id: string;
  readonly role: 'menuitem';
  readonly label: string;
  readonly hasPopup: 'menu' | undefined;
  readonly expanded: boolean | undefined;
  readonly tabIndex: 0 | -1;
  readonly disabled: boolean;
  readonly focused: boolean;
}

export interface Menubar {
  /** 0 outside, 1 the bar, 2 a top-level menu, 3 a submenu. */
  readonly focusLevel: Accessor<0 | 1 | 2 | 3>;
  readonly focusIndex: Accessor<number>;
  readonly barStop: Accessor<number>;
  /** The bar index whose menu is open, or -1. */
  readonly openTop: Accessor<number>;
  /** The item of the open menu whose submenu is open, or -1. */
  readonly openSub: Accessor<number>;
  readonly items: ReadonlyArray<MenubarItem>;
  readonly menubar: MenubarPart;
  readonly item: (bar: number) => MenubarBarItemPart;
  readonly menu: (bar: number) => MenubarMenuPart;
  readonly menuItem: (bar: number, item: number) => MenubarMenuItemPart;
  readonly submenu: (bar: number, item: number) => MenubarMenuPart;
  readonly submenuItem: (bar: number, item: number, sub: number) => MenubarMenuItemPart;
  /** Tab into the bar: lands on the roving item. */
  readonly focusIn: () => void;
  /** Focus leaves the widget: everything closes, the roving item stays. */
  readonly leave: () => void;
  /** A key for the focused part; returns whether the bar took it (nothing is taken while focus is outside). */
  readonly keyDown: (key: string) => boolean;
}

const toMenubarItem = (
  input: string | MenubarItemInput,
): MenubarItemInput & { label: string } =>
  typeof input === 'string' ? { label: input } : input;

const toMenuItems = (
  inputs: ReadonlyArray<MenubarMenuItemInput> | undefined,
  path: string,
): ReadonlyArray<MenubarMenuItem> =>
  (inputs ?? []).map((input, index): MenubarMenuItem => {
    const id = `${path}-${index}`;
    return {
      id,
      label: input.label,
      disabled: input.disabled ?? false,
      submenu: toMenuItems(input.submenu, `${id}-sub`),
    };
  });

/**
 * APG Menubar (https://www.w3.org/WAI/ARIA/apg/patterns/menubar/): the roving
 * bar, one menu per bar item and one more level of submenus, a faithful port of
 * `specs/apg/menu-menubar.qnt` and of eoa's `createMenubar` with the focus
 * manager in place of `document.activeElement`.
 *
 * Focus is `(focusLevel, focusIndex)`: 0 outside, 1 the bar, 2 a top-level
 * menu, 3 a submenu of the open item. The roving `tabindex` holder is `barStop`
 * (one bar item, always). The open path is `(openTop, openSub)`: at most one
 * menu per level. The keys are the spec's: Right/Left walk the bar (opening the
 * next item's menu when one was open), Down/Up open the bar item's menu on its
 * first/last item and move within a menu with wrapping, Home/End go to the
 * ends, Enter/Space open a parent or activate a leaf (every menu closes and
 * focus returns to the bar item), Escape closes the innermost open menu and
 * returns focus to its invoker, Tab leaves the widget and closes everything.
 * A click on a bar item toggles its menu; a click on a leaf closes everything.
 *
 * The bar items are a group of the focus manager (`wrap`, `focusDisabled`); the
 * items of the open top menu and of the open submenu are groups registered
 * while they are open, so a host's Tab and its focus routing find them.
 *
 * Not ported (see `headless/README.md`): hover opening, the vertical bar's
 * navigation (the keys stay the spec's horizontal ones), a controlled `value`,
 * type-ahead, and disabled items in the keys (they carry `disabled` for an
 * accessibility tree but stay focusable, as the spec has no disabled items).
 */
export const createMenubar = (options: MenubarOptions): Menubar => {
  const base = options.id ?? nextId('menubar');
  const orientation = options.orientation ?? 'horizontal';
  const items: ReadonlyArray<MenubarItem> = options.items.map((input, index) => {
    const normalized = toMenubarItem(input);
    return {
      id: `${base}-bar-${index}`,
      label: normalized.label,
      disabled: normalized.disabled ?? false,
      menu: toMenuItems(normalized.menu, `${base}-menu-${index}`),
    };
  });
  const bar = items.length;
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const barGroup = `${base}-bar-group`;
  const menuGroup = `${base}-menu-group`;
  const subGroup = `${base}-sub-group`;
  const barId = (index: number): string => `${base}-bar-${index}`;
  const menuId = (index: number): string => `${base}-menu-${index}`;
  const menuItemId = (b: number, item: number): string => `${base}-menu-${b}-${item}`;
  const submenuId = (b: number, item: number): string => `${base}-submenu-${b}-${item}`;
  const subItemId = (b: number, item: number, sub: number): string =>
    `${base}-menu-${b}-${item}-sub-${sub}`;

  let level: 0 | 1 | 2 | 3 = 0;
  let focusIdx = -1;
  let barStop = 0;
  let openTop = -1;
  let openSub = -1;

  const menuSize = (b: number): number => items[b]?.menu.length ?? 0;
  const hasMenu = (b: number): boolean => b >= 0 && b < bar && menuSize(b) > 0;
  const hasSub = (b: number, item: number): boolean => (items[b]?.menu[item]?.submenu.length ?? 0) > 0;
  const subSize = (b: number, item: number): number => items[b]?.menu[item]?.submenu.length ?? 0;

  const containerSize = (): number => {
    if (level === 1) return bar;
    if (level === 2) return menuSize(openTop);
    if (level === 3) return subSize(openTop, openSub);
    return 0;
  };

  const wrapNext = (i: number, n: number): number => (n <= 0 ? 0 : i + 1 >= n ? 0 : i + 1);
  const wrapPrev = (i: number, n: number): number => (n <= 0 ? 0 : i <= 0 ? n - 1 : i - 1);
  const barNext = (i: number): number => wrapNext(i, bar);
  const barPrev = (i: number): number => wrapPrev(i, bar);
  // after moving along the bar, the new item's menu follows when one was open
  const follow = (wasOpen: number, next: number): number => (wasOpen >= 0 && hasMenu(next) ? next : -1);
  const opensMenu = (): boolean => level === 1 && hasMenu(barStop);
  const entersSub = (): boolean => level === 2 && hasSub(openTop, focusIdx);

  // the groups are the manager's, so Tab and a host's focus routing see the bar and the open containers
  manager.group(barGroup, {
    get orientation() {
      return orientation;
    },
    wrap: true,
    memory: false,
    focusDisabled: true,
    get entry() {
      return barId(barStop);
    },
  });
  manager.group(menuGroup, {
    orientation: 'vertical',
    wrap: true,
    memory: false,
    focusDisabled: true,
    get entry() {
      return menuItemId(openTop, focusIdx >= 0 ? focusIdx : 0);
    },
  });
  manager.group(subGroup, {
    orientation: 'vertical',
    wrap: true,
    memory: false,
    focusDisabled: true,
    get entry() {
      return subItemId(openTop, openSub, focusIdx >= 0 ? focusIdx : 0);
    },
  });
  for (let i = 0; i < bar; i += 1) {
    manager.register(barId(i), { group: barGroup, disabled: items[i]?.disabled === true });
  }

  // what is registered while open: the items of one top menu and of one submenu
  let topOwner = -1;
  let subOwner = -1;
  let subBar = -1;
  const removeTop = (): void => {
    if (topOwner < 0) return;
    for (let i = 0; i < menuSize(topOwner); i += 1) manager.unregister(menuItemId(topOwner, i));
    topOwner = -1;
  };
  const addTop = (): void => {
    if (openTop < 0 || level < 2) return;
    topOwner = openTop;
    for (let i = 0; i < menuSize(topOwner); i += 1) {
      manager.register(menuItemId(topOwner, i), {
        group: menuGroup,
        disabled: items[topOwner]?.menu[i]?.disabled === true,
      });
    }
  };
  const removeSub = (): void => {
    if (subOwner < 0) return;
    for (let i = 0; i < subSize(subBar, subOwner); i += 1) manager.unregister(subItemId(subBar, subOwner, i));
    subOwner = -1;
    subBar = -1;
  };
  const addSub = (): void => {
    if (level !== 3 || openSub < 0) return;
    subOwner = openSub;
    subBar = openTop;
    for (let i = 0; i < subSize(openTop, subOwner); i += 1) {
      manager.register(subItemId(openTop, subOwner, i), {
        group: subGroup,
        disabled: items[openTop]?.menu[subOwner]?.submenu[i]?.disabled === true,
      });
    }
  };

  const isOurs = (id: string | null): boolean => {
    if (id === null) return false;
    for (let i = 0; i < bar; i += 1) {
      if (id === barId(i)) return true;
      for (let j = 0; j < menuSize(i); j += 1) {
        if (id === menuItemId(i, j)) return true;
        for (let k = 0; k < subSize(i, j); k += 1) if (id === subItemId(i, j, k)) return true;
      }
    }
    return false;
  };

  /** Put the manager's focus where `level` and `focusIdx` say it is. */
  const applyFocus = (): void => {
    if (level === 1 && barStop >= 0 && barStop < bar) manager.focus(barId(barStop));
    else if (level === 2 && openTop >= 0) manager.focus(menuItemId(openTop, focusIdx));
    else if (level === 3 && openTop >= 0 && openSub >= 0) manager.focus(subItemId(openTop, openSub, focusIdx));
    else if (isOurs(manager.focused())) manager.blur();
  };

  const commit = (): void => {
    // opening registers before focus moves in; closing moves focus out before it unregisters (an unregistered focused
    // item relocates to the next stop)
    if (level >= 2 && openTop >= 0) {
      if (topOwner !== openTop) {
        removeTop();
        addTop();
      }
      if (level === 3 && openSub >= 0 && (subOwner !== openSub || subBar !== openTop)) {
        removeSub();
        addSub();
      }
    }
    applyFocus();
    if (level < 2 || openTop < 0) removeTop();
    if (level !== 3 || openSub < 0) removeSub();
    host.changed();
  };

  const notifyOpen = (): void => {
    options.onOpenChange?.(openTop);
  };

  const focusIn = (): void => {
    if (level === 0) {
      level = 1;
      focusIdx = barStop;
      commit();
    }
  };

  const leave = (): void => {
    level = 0;
    focusIdx = -1;
    openTop = -1;
    openSub = -1;
    commit();
  };

  const activate = (): void => {
    if (opensMenu()) {
      level = 2;
      focusIdx = 0;
      openTop = barStop;
      openSub = -1;
      commit();
      notifyOpen();
      return;
    }
    if (entersSub()) {
      level = 3;
      openSub = focusIdx;
      focusIdx = 0;
      commit();
      return;
    }
    if (level === 0) return;
    if (level === 2) options.onActivate?.([openTop, focusIdx]);
    if (level === 3) options.onActivate?.([openTop, openSub, focusIdx]);
    if (level >= 2) {
      focusIdx = openTop;
      openTop = -1;
      openSub = -1;
    }
    level = 1;
    commit();
    notifyOpen();
  };

  const keyDown = (key: string): boolean => {
    switch (key) {
      case 'ArrowRight':
        if (level === 0) return false;
        if (entersSub()) {
          level = 3;
          openSub = focusIdx;
          focusIdx = 0;
          commit();
          return true;
        }
        barStop = barNext(barStop);
        focusIdx = barStop;
        openTop = follow(openTop, barStop);
        openSub = -1;
        level = 1;
        commit();
        notifyOpen();
        return true;
      case 'ArrowLeft':
        if (level === 0) return false;
        if (level === 3) {
          level = 2;
          focusIdx = openSub;
          openSub = -1;
          commit();
          return true;
        }
        barStop = barPrev(barStop);
        focusIdx = barStop;
        openTop = follow(openTop, barStop);
        openSub = -1;
        level = 1;
        commit();
        notifyOpen();
        return true;
      case 'ArrowDown':
        if (opensMenu()) {
          level = 2;
          focusIdx = 0;
          openTop = barStop;
          commit();
          notifyOpen();
          return true;
        }
        if (level >= 2) {
          focusIdx = wrapNext(focusIdx, containerSize());
          commit();
          return true;
        }
        return false;
      case 'ArrowUp':
        if (opensMenu()) {
          level = 2;
          focusIdx = menuSize(barStop) - 1;
          openTop = barStop;
          commit();
          notifyOpen();
          return true;
        }
        if (level >= 2) {
          focusIdx = wrapPrev(focusIdx, containerSize());
          commit();
          return true;
        }
        return false;
      case 'Home':
        if (level === 0) return false;
        focusIdx = 0;
        if (level === 1) {
          barStop = 0;
          openTop = follow(openTop, 0);
        }
        commit();
        notifyOpen();
        return true;
      case 'End':
        if (level === 0) return false;
        focusIdx = containerSize() - 1;
        if (level === 1) {
          barStop = bar - 1;
          openTop = follow(openTop, bar - 1);
        }
        commit();
        notifyOpen();
        return true;
      case 'Enter':
      case ' ':
      case 'Space':
        if (level === 0) return false;
        activate();
        return true;
      case 'Escape':
        if (level === 0) return false;
        if (level === 3) {
          level = 2;
          focusIdx = openSub;
          openSub = -1;
        } else if (level === 2) {
          level = 1;
          focusIdx = openTop;
          openTop = -1;
          openSub = -1;
        } else {
          openTop = -1;
          openSub = -1;
        }
        commit();
        notifyOpen();
        return true;
      case 'Tab':
      case 'Shift+Tab':
        // focus leaves the widget: everything closes, the roving item stays
        if (level === 0) return false;
        level = 0;
        focusIdx = -1;
        openTop = -1;
        openSub = -1;
        commit();
        notifyOpen();
        return true;
      default:
        return false;
    }
  };

  // the handlers a part needs, so a host routes one key of whatever holds focus. A blur of this part is the host taking
  // focus away: when focus went to another part of the widget the state stays, when it left the widget everything closes.
  const handlers = (id: string, focus: () => void, press: () => void): PartHandlers => ({
    press,
    keyDown: (key, repeat) => (repeat === true ? false : keyDown(key)),
    keyUp: () => false,
    key: (key) => keyDown(key),
    focus,
    blur: () => {
      const now = manager.focused();
      if (now === id) manager.blur();
      else if (now === null || !isOurs(now)) leave();
    },
  });

  const itemParts: MenubarBarItemPart[] = items.map((item, index) => ({
    id: barId(index),
    role: 'menuitem',
    label: item.label,
    get hasPopup() {
      return read(() => (hasMenu(index) ? 'menu' : undefined));
    },
    get expanded() {
      return read(() => (hasMenu(index) ? openTop === index : undefined));
    },
    get tabIndex() {
      return read(() => (barStop === index ? 0 : -1));
    },
    disabled: item.disabled,
    get focused() {
      return read(() => manager.focused() === barId(index));
    },
    ...handlers(
      barId(index),
      () => {
        level = 1;
        focusIdx = index;
        barStop = index;
        commit();
      },
      () => {
        if (!hasMenu(index)) return;
        openTop = openTop === index ? -1 : index;
        level = 1;
        focusIdx = index;
        barStop = index;
        openSub = -1;
        commit();
        notifyOpen();
      },
    ),
  }));

  const menuItemPart = (b: number, item: number): MenubarMenuItemPart => ({
    id: menuItemId(b, item),
    role: 'menuitem',
    label: items[b]?.menu[item]?.label ?? '',
    get hasPopup() {
      return read(() => (hasSub(b, item) ? 'menu' : undefined));
    },
    get expanded() {
      return read(() => (hasSub(b, item) ? openTop === b && openSub === item : undefined));
    },
    get tabIndex() {
      return read(() => (level === 2 && openTop === b && focusIdx === item ? 0 : -1));
    },
    disabled: items[b]?.menu[item]?.disabled === true,
    get focused() {
      return read(() => manager.focused() === menuItemId(b, item));
    },
    ...handlers(
      menuItemId(b, item),
      () => {
        level = 2;
        openTop = b;
        openSub = -1;
        focusIdx = item;
        commit();
      },
      () => {
        if (hasSub(b, item)) {
          level = 3;
          openTop = b;
          openSub = item;
          focusIdx = 0;
          commit();
          return;
        }
        options.onActivate?.([b, item]);
        level = 1;
        focusIdx = b;
        barStop = b;
        openTop = -1;
        openSub = -1;
        commit();
        notifyOpen();
      },
    ),
  });

  const subItemPart = (b: number, item: number, sub: number): MenubarMenuItemPart => ({
    id: subItemId(b, item, sub),
    role: 'menuitem',
    label: items[b]?.menu[item]?.submenu[sub]?.label ?? '',
    hasPopup: undefined,
    get expanded() {
      return undefined;
    },
    get tabIndex() {
      return read(() => (level === 3 && openTop === b && openSub === item && focusIdx === sub ? 0 : -1));
    },
    disabled: items[b]?.menu[item]?.submenu[sub]?.disabled === true,
    get focused() {
      return read(() => manager.focused() === subItemId(b, item, sub));
    },
    ...handlers(
      subItemId(b, item, sub),
      () => {
        level = 3;
        openTop = b;
        openSub = item;
        focusIdx = sub;
        commit();
      },
      () => {
        options.onActivate?.([b, item, sub]);
        level = 1;
        focusIdx = openTop >= 0 ? openTop : 0;
        barStop = focusIdx;
        openTop = -1;
        openSub = -1;
        commit();
        notifyOpen();
      },
    ),
  });

  whenDisposed(() => {
    removeTop();
    removeSub();
    for (let i = 0; i < bar; i += 1) manager.unregister(barId(i));
  });

  return {
    focusLevel: () => read(() => level),
    focusIndex: () => read(() => focusIdx),
    barStop: () => read(() => barStop),
    openTop: () => read(() => openTop),
    openSub: () => read(() => openSub),
    items,
    menubar: {
      id: base,
      role: 'menubar',
      orientation,
      keyDown,
    },
    item: (b) => itemParts[b] ?? itemParts[0]!,
    menu: (b) => ({
      id: menuId(b),
      role: 'menu',
      get hidden() {
        return read(() => openTop !== b);
      },
    }),
    menuItem: menuItemPart,
    submenu: (b, item) => ({
      id: submenuId(b, item),
      role: 'menu',
      get hidden() {
        return read(() => !(openTop === b && openSub === item));
      },
    }),
    submenuItem: subItemPart,
    focusIn,
    leave,
    keyDown,
  };
};
