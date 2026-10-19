import { type Accessor, createEffect } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createControllable } from './controllable';
import { createFocusHost, moveKey, tabKey, whenDisposed } from './focus-host';
import { type PartHandlers, nextId } from './parts';

export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsActivation = 'automatic' | 'manual';

/**
 * Options are read lazily (getters) so `orientation` / `activation` stay
 * reactive; pass a component's `props`.
 */
export interface TabsOptions {
  /** Number of tabs (needed for wrapping). */
  readonly items?: number;
  /** Controlled: the host owns the selection and this is the only thing that changes it. */
  readonly value?: number | undefined;
  /** Uncontrolled starting selection; ignored while `value` is set. */
  readonly defaultSelected?: number;
  readonly orientation?: TabsOrientation;
  readonly activation?: TabsActivation;
  /** Tab indices that cannot be selected. */
  readonly disabled?: ReadonlyArray<number>;
  /** Panels that already hold focusable content (no `tabindex` needed). */
  readonly focusablePanels?: ReadonlyArray<number>;
  /** Base for the generated ids. */
  readonly id?: string;
  /** The focus manager the tabs register with; a private one when omitted. */
  readonly focus?: Focus;
  /**
   * A request to change the selection, called when the intent differs from the
   * current value. Uncontrolled it is accepted; controlled the host may ignore it.
   */
  readonly onValueChange?: (index: number) => void;
}

/** One tab: `role=tab`. Its `controls` is the panel's id. */
export interface TabPart extends PartHandlers {
  readonly id: string;
  readonly role: 'tab';
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly focused: boolean;
  /** 0 for the roving tab stop (the selected tab, else the first enabled one), -1 for the rest. */
  readonly tabIndex: number;
  readonly controls: string;
}

/** A panel: a Tab stop when it is the selected one and has no focusable content of its own. */
export interface TabpanelPart {
  readonly id: string;
  readonly role: 'tabpanel';
  readonly labelledBy: string;
  readonly hidden: boolean;
  readonly focused: boolean;
  readonly tabIndex: number | undefined;
  readonly focus: () => void;
  readonly blur: () => void;
  readonly keyDown: (key: string) => boolean;
  readonly keyUp: (key: string) => boolean;
}

/** The tablist: `role=tablist`. It takes no focus; its tabs do. Its `keyDown` is Tab from outside: enter the tablist. */
export interface TablistPart {
  readonly id: string;
  readonly role: 'tablist';
  readonly orientation: TabsOrientation | undefined;
  readonly keyDown: (key: string) => boolean;
}

export interface Tabs {
  readonly items: number;
  readonly selected: Accessor<number>;
  /** The tab holding focus, or -1 when focus is elsewhere. */
  readonly focused: Accessor<number>;
  /** Programmatic selection request; ignores disabled tabs. */
  readonly select: (index: number) => void;
  /** Programmatic selection request (may point at a disabled tab, like base-ui). */
  readonly setSelected: (index: number) => void;
  /** Programmatic focus (does not select). A disabled tab refuses it. */
  readonly focusTab: (index: number) => void;
  /** A key for the focused tab; returns whether it was consumed. Tab is not consumed: it leaves the tablist. */
  readonly keyDown: (key: string) => boolean;
  readonly tablist: TablistPart;
  readonly tabs: ReadonlyArray<TabPart>;
  readonly panels: ReadonlyArray<TabpanelPart>;
}

/**
 * APG Tabs (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): a `tablist` of
 * `role=tab` parts and their `tabpanel`s. The tabs are one group in the focus
 * manager, horizontal or vertical as the orientation says: the arrows of that
 * axis wrap, Home and End go to the first and last enabled tab, disabled tabs
 * are skipped, and Tab enters on the selected tab. Automatic activation selects
 * the tab an arrow, Home or End moves to; manual activation waits for Enter or
 * Space. Pointer clicks select.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default
 * (`defaultSelected`); pass `value` + `onValueChange` to own the selection.
 * Programmatic methods (`select`, `setSelected`, `keyDown`) are requests too.
 * Checked against `specs/apg/tabs.qnt` by the scenario bridge.
 */
export const createTabs = (options: TabsOptions = {}): Tabs => {
  const items = Math.max(1, options.items ?? 4);
  const base = options.id ?? nextId('tabs');
  const groupId = `${base}-tablist`;
  const disabled = new Set<number>(options.disabled ?? []);
  const focusablePanels = new Set<number>(options.focusablePanels ?? []);
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const tabId = (index: number): string => `${base}-tab-${index}`;
  const panelId = (index: number): string => `${base}-tabpanel-${index}`;
  const indexById = new Map<string, number>(
    Array.from({ length: items }, (_value, index) => [tabId(index), index]),
  );

  const activation = (): TabsActivation => options.activation ?? 'automatic';
  const orientation = (): TabsOrientation =>
    options.orientation ?? 'horizontal';

  const firstEnabled = (): number => {
    for (let index = 0; index < items; index += 1) {
      if (!disabled.has(index)) {
        return index;
      }
    }
    return 0;
  };

  const initial = options.defaultSelected ?? firstEnabled();
  const [selected, request] = createControllable({
    value: () => options.value,
    initial:
      initial >= 0 && initial < items && !disabled.has(initial)
        ? initial
        : firstEnabled(),
    onChange: () => options.onValueChange,
  });

  /** The tab that carries the roving tab stop: the selected one, or the first enabled. */
  const roving = (): number =>
    disabled.has(selected()) ? firstEnabled() : selected();

  manager.group(groupId, {
    get orientation() {
      return orientation();
    },
    wrap: true,
    memory: false,
    get entry() {
      return tabId(roving());
    },
  });
  for (let index = 0; index < items; index += 1) {
    manager.register(tabId(index), {
      group: groupId,
      disabled: disabled.has(index),
    });
  }
  whenDisposed(() => {
    for (let index = 0; index < items; index += 1) {
      manager.unregister(tabId(index));
    }
  });

  const focusedTab = (): number => {
    const id = manager.focused();
    return id === null ? -1 : (indexById.get(id) ?? -1);
  };
  const tabStopIndex = (): number => {
    const stop = manager.tabOrder().find((id) => indexById.has(id));
    return stop === undefined ? -1 : (indexById.get(stop) ?? -1);
  };

  const select = (index: number): void => {
    if (index < 0 || index >= items || disabled.has(index)) {
      return;
    }
    request(index);
  };

  const keyDown = (key: string): boolean => {
    const current = focusedTab();
    if (current < 0) {
      return false;
    }
    const tab = tabKey(key);
    if (tab !== undefined) {
      return manager.key(tab);
    }
    if (key === 'Enter' || key === ' ' || key === 'Space') {
      select(current);
      return true;
    }
    const name = moveKey(key);
    if (name === undefined || !manager.key(name)) {
      return false;
    }
    if (activation() === 'automatic') {
      select(focusedTab());
    }
    return true;
  };

  // The selected panel is a Tab stop after the tablist unless it holds focusable content of its own (then that is the stop).
  // Registered after the tabs, so it follows them in document order.
  const syncPanels = (): void => {
    for (let index = 0; index < items; index += 1) {
      manager.register(panelId(index), {
        disabled: index !== selected() || focusablePanels.has(index),
      });
    }
  };
  syncPanels();
  createEffect(
    () => selected(),
    () => {
      syncPanels();
    },
  );
  whenDisposed(() => {
    for (let index = 0; index < items; index += 1) {
      manager.unregister(panelId(index));
    }
  });

  const tabs: TabPart[] = Array.from({ length: items }, (_value, index) => {
    const id = tabId(index);
    return {
      id,
      role: 'tab',
      get selected() {
        return selected() === index;
      },
      disabled: disabled.has(index),
      get focused() {
        return read(() => manager.focused() === id);
      },
      get tabIndex() {
        return read(() => (tabStopIndex() === index ? 0 : -1));
      },
      controls: panelId(index),
      press: () => {
        if (disabled.has(index)) {
          return;
        }
        manager.focus(id);
        select(index);
      },
      keyDown,
      keyUp: () => false,
      key: keyDown,
      focus: () => {
        manager.focus(id);
      },
      blur: () => {
        if (manager.focused() === id) {
          manager.blur();
        }
      },
    };
  });

  const panels: TabpanelPart[] = Array.from({ length: items }, (_value, index) => {
    const id = panelId(index);
    return {
      id,
      role: 'tabpanel',
      labelledBy: tabId(index),
      get hidden() {
        return selected() !== index;
      },
      get focused() {
        return read(() => manager.focused() === id);
      },
      tabIndex: focusablePanels.has(index) ? undefined : 0,
      focus: () => {
        manager.focus(id);
      },
      blur: () => {
        if (manager.focused() === id) {
          manager.blur();
        }
      },
      keyDown: (key) => {
        const tab = tabKey(key);
        if (tab === undefined || manager.focused() !== id) {
          return false;
        }
        return manager.key(tab);
      },
      keyUp: () => false,
    };
  });

  return {
    items,
    selected,
    focused: () => read(focusedTab),
    select,
    setSelected: (index) => {
      if (index >= 0 && index < items) {
        request(index);
      }
    },
    focusTab: (index) => {
      if (index >= 0 && index < items) {
        manager.focus(tabId(index));
      }
    },
    keyDown,
    tablist: {
      id: groupId,
      role: 'tablist',
      get orientation() {
        return orientation() === 'vertical' ? 'vertical' : undefined;
      },
      // Tab from outside the tablist enters it at the tab stop
      keyDown: (key) => {
        if (tabKey(key) === undefined || focusedTab() >= 0) {
          return false;
        }
        manager.focus(tabId(roving()));
        return true;
      },
    },
    tabs,
    panels,
  };
};
