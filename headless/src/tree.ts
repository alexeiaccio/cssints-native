import { type Accessor, createSignal } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createControllable } from './controllable';
import { createFocusHost, tabKey, whenDisposed } from './focus-host';
import { type PartHandlers, nextId } from './parts';

/** A tree node: `parent` is 0 for a root; order in `nodes` is document order. */
export interface TreeNode {
  readonly id: number;
  readonly parent: number;
  readonly label: string;
}

/**
 * The fixed tree of `specs/apg/treeview.qnt` (ids are pre-order = document
 * order): 1 Projects > {2 Reports > {3 Roadmap, 4 Summary}, 5 Notes}, 6 Photos
 * > {7 Trip}.
 */
export const TREE_NODES: ReadonlyArray<TreeNode> = [
  { id: 1, parent: 0, label: 'Projects' },
  { id: 2, parent: 1, label: 'Reports' },
  { id: 3, parent: 2, label: 'Roadmap' },
  { id: 4, parent: 2, label: 'Summary' },
  { id: 5, parent: 1, label: 'Notes' },
  { id: 6, parent: 0, label: 'Photos' },
  { id: 7, parent: 6, label: 'Trip' },
];

/** Read lazily: pass an object with getters, never destructured values. */
export interface TreeOptions {
  readonly nodes?: ReadonlyArray<TreeNode>;
  /** One selected node (default) or a set. Same switch as eoa's `multiSelectable`. */
  readonly selection?: 'single' | 'multiple';
  /** eoa's spelling of `selection: 'multiple'`; `selection` wins when both are given. */
  readonly multiSelectable?: boolean;
  /** Controlled: the host owns the selected node ids and this is the only thing that changes them. */
  readonly value?: ReadonlyArray<number> | undefined;
  /** Uncontrolled starting selection; ignored while `value` is set. */
  readonly defaultValue?: ReadonlyArray<number>;
  /** Selected node ids at mount (an alias for `defaultValue`). */
  readonly defaultSelected?: ReadonlyArray<number>;
  /** Expanded (open) parent ids at mount; expansion is always uncontrolled. */
  readonly defaultExpanded?: ReadonlyArray<number>;
  /** Roving-tabindex node id at mount. */
  readonly defaultFocus?: number;
  readonly label?: string;
  /** Only `horizontal` is rendered as `aria-orientation`; the modelled keys are the vertical tree's. */
  readonly orientation?: 'vertical' | 'horizontal';
  /** Base for the generated ids. */
  readonly id?: string;
  /** The focus manager the tree items register with; a private one when omitted. */
  readonly focus?: Focus;
  /** Fires for each node whose expanded state changed, in document order. */
  readonly onExpandedChange?: (node: TreeNode) => void;
  /** Fires for each node that becomes selected. */
  readonly onSelectionChange?: (node: TreeNode) => void;
  /**
   * A request to change the selected node ids, called when the intent differs
   * from the current value. Uncontrolled it is accepted; controlled the host may
   * ignore it.
   */
  readonly onValueChange?: (selected: ReadonlyArray<number>) => void;
  /** Enter's default action. */
  readonly onActivate?: (node: TreeNode) => void;
}

/** The tree container: `role=tree`. It takes no focus itself; its items do. */
export interface TreePart {
  readonly id: string;
  readonly role: 'tree';
  readonly label: string | undefined;
  readonly multiSelectable: boolean;
  readonly orientation: 'horizontal' | undefined;
  /** DOM focus is on one of this tree's items. */
  readonly focused: boolean;
  readonly keyDown: (key: string) => boolean;
  /** Tab from outside enters at the group's tab stop; gives focus to the roving item. */
  readonly focus: () => void;
  readonly blur: () => void;
}

/** One tree item: `role=treeitem`, with its own handlers. */
export interface TreeItemPart extends PartHandlers {
  readonly id: string;
  readonly role: 'treeitem';
  readonly label: string;
  readonly level: number;
  readonly posInSet: number;
  readonly setSize: number;
  /** `undefined` on an end node (`aria-expanded` is absent there). */
  readonly expanded: boolean | undefined;
  readonly selected: boolean;
  /** The spec models no disabled nodes; a host may still read the field. */
  readonly disabled: boolean;
  readonly focused: boolean;
  /** 0 on the roving node, -1 on the rest. */
  readonly tabIndex: number;
  /** A node inside a collapsed subtree. */
  readonly hidden: boolean;
}

export interface Tree {
  readonly nodeIds: ReadonlyArray<number>;
  readonly expanded: Accessor<ReadonlyArray<number>>;
  readonly selected: Accessor<ReadonlyArray<number>>;
  /** The roving-tabindex node; it survives a blur, as in the spec. */
  readonly focus: Accessor<number>;
  readonly hasFocus: Accessor<boolean>;
  readonly isExpanded: (id: number) => boolean;
  readonly isSelected: (id: number) => boolean;
  readonly isVisible: (id: number) => boolean;
  readonly isParent: (id: number) => boolean;
  readonly expand: (id: number) => void;
  readonly collapse: (id: number) => void;
  readonly toggleExpanded: (id: number) => void;
  readonly select: (id: number) => void;
  readonly toggleSelected: (id: number) => void;
  /** A key for the focused item; returns whether it was consumed. */
  readonly keyDown: (key: string, repeat?: boolean) => boolean;
  readonly tree: TreePart;
  readonly item: (id: number) => TreeItemPart;
}

const isSpace = (key: string): boolean =>
  key === ' ' || key === 'Space' || key === 'Spacebar';

/**
 * APG Tree View (https://www.w3.org/WAI/ARIA/apg/patterns/treeview/): a `tree`
 * of `role=treeitem` parts over a flat node list (`parent` 0 = root). The items
 * are one vertical group in the focus manager: Up/Down move to the previous or
 * next visible item, Home/End to the first or last, collapsed subtrees are not
 * in the group and not Tab stops. Right opens a closed item, or steps into an
 * open one; Left closes an open item, or steps to the parent. Enter opens or
 * closes and (single-select) selects, then activates; Space selects, or toggles
 * in multi-select. Tab enters at the first selected visible item, else the
 * first visible one.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default
 * (`defaultExpanded`, `defaultValue`); pass `value` + `onValueChange` to own the
 * selection. Expansion stays uncontrolled (a `defaultExpanded` /
 * `onExpandedChange` pair). Every selection change is a request. Checked
 * against `specs/apg/treeview.qnt` by the scenario bridge.
 *
 * Not ported: type-ahead (the `type` / `typeaheadReset` steps), so the buffer
 * and its timeout are absent; the APG focused-on-entry rule is the spec's
 * deliberate omission (see the two divergences in `test/treeview.test.ts`).
 *
 * ponytail: selection and expansion are bitmasks over the node list, as in eoa
 * (so 31 nodes at most). A Set replaces them when a consumer needs more.
 */
export const createTree = (options: TreeOptions = {}): Tree => {
  const nodes = options.nodes ?? TREE_NODES;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ids = nodes.map((node) => node.id);
  const weightOf = new Map(ids.map((id, index) => [id, 1 << index]));

  const weight = (id: number): number => weightOf.get(id) ?? 0;
  const bit = (mask: number, id: number): boolean => (mask & weight(id)) !== 0;
  const setBit = (mask: number, id: number, on: boolean): number =>
    on ? mask | weight(id) : mask & ~weight(id);
  const maskOf = (list: ReadonlyArray<number> | undefined): number =>
    (list ?? []).reduce((mask, id) => setBit(mask, id, true), 0);
  const idsOfMask = (mask: number): ReadonlyArray<number> =>
    ids.filter((id) => bit(mask, id));

  const parentOf = (id: number): number => byId.get(id)?.parent ?? 0;
  const childrenOf = (id: number): ReadonlyArray<number> =>
    id === 0
      ? ids.filter((child) => parentOf(child) === 0)
      : ids.filter((child) => parentOf(child) === id);
  const isParent = (id: number): boolean => childrenOf(id).length > 0;
  const nodeOf = (id: number): TreeNode => {
    const node = byId.get(id);
    if (node === undefined) {
      throw new Error(`unknown tree node ${id}`);
    }
    return node;
  };
  const levelOf = (id: number): number => {
    let level = 1;
    let parent = parentOf(id);
    while (parent !== 0) {
      level += 1;
      parent = parentOf(parent);
    }
    return level;
  };

  const base = options.id ?? nextId('tree');
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const multi = (): boolean =>
    options.selection === undefined
      ? options.multiSelectable === true
      : options.selection === 'multiple';

  // Expansion: controlled by nothing, so a local mask plus a version signal is
  // enough (a Solid setter lands on the next flush, so the local is the truth).
  let expandedMask = maskOf(options.defaultExpanded);
  const [expandedVersion, setExpandedVersion] = createSignal(0);
  const expandedNow = (): number => {
    expandedVersion();
    return expandedMask;
  };

  const visibleIn = (id: number): boolean => {
    let current = id;
    while (current !== 0) {
      const parent = parentOf(current);
      if (parent !== 0 && !bit(expandedNow(), parent)) {
        return false;
      }
      current = parent;
    }
    return true;
  };
  const visibleIds = (): ReadonlyArray<number> => ids.filter(visibleIn);
  const firstVisible = (): number => visibleIds()[0] ?? ids[0] ?? 0;

  const [selectedMask, requestSelected] = createControllable<number>({
    value: () =>
      options.value === undefined ? undefined : maskOf(options.value),
    initial: maskOf(options.defaultValue ?? options.defaultSelected),
    onChange: () => (next) => options.onValueChange?.(idsOfMask(next)),
  });

  const itemId = (id: number): string => `${base}-item-${id}`;
  const itemById = new Map<string, number>(
    ids.map((id) => [itemId(id), id]),
  );

  let roving = options.defaultFocus ?? firstVisible();

  const groupId = `${base}-tree`;
  manager.group(groupId, {
    orientation: 'vertical',
    // eoa clamps at the ends (a key at an edge is consumed and nothing moves)
    wrap: false,
    memory: false,
    // Tab into the tree lands on the first selected visible item, else the first visible
    get entry() {
      host.version();
      const selected = selectedMask();
      const first = visibleIds().find((id) => bit(selected, id));
      return itemId(first ?? firstVisible());
    },
  });
  const register = (): void => {
    for (const id of ids) {
      manager.register(itemId(id), {
        group: groupId,
        // a node inside a collapsed subtree is not a member: no arrows, no Tab stop
        tabIndex: visibleIn(id) ? 0 : -1,
      });
    }
  };
  register();
  whenDisposed(() => {
    for (const id of ids) {
      manager.unregister(itemId(id));
    }
  });

  whenDisposed(
    manager.onChange((next) => {
      const id = next === null ? undefined : itemById.get(next);
      if (id !== undefined) {
        roving = id;
      }
    }),
  );

  const focusedId = (): number => {
    const id = manager.focused();
    return id === null ? -1 : (itemById.get(id) ?? -1);
  };
  const tabStop = (): number | undefined => {
    const stop = manager.tabOrder().find((id) => itemById.has(id));
    return stop === undefined ? undefined : itemById.get(stop);
  };

  const emitExpanded = (changed: ReadonlyArray<number>): void => {
    for (const id of changed) {
      options.onExpandedChange?.(nodeOf(id));
    }
  };
  const setExpanded = (next: number): void => {
    expandedMask = next;
    setExpandedVersion((count) => count + 1);
    register();
    host.changed();
  };

  const open = (id: number): void => {
    if (!isParent(id) || bit(expandedNow(), id)) {
      return;
    }
    setExpanded(setBit(expandedMask, id, true));
    emitExpanded([id]);
  };
  const close = (id: number): void => {
    if (!isParent(id) || !bit(expandedNow(), id)) {
      return;
    }
    setExpanded(setBit(expandedMask, id, false));
    emitExpanded([id]);
  };
  const toggleExpanded = (id: number): void => {
    if (!isParent(id)) {
      return;
    }
    if (bit(expandedNow(), id)) {
      close(id);
    } else {
      open(id);
    }
  };

  /** A selection request: fire onValueChange when the intent differs, and report each newly requested node. */
  const requestSelection = (next: number): void => {
    const before = selectedMask();
    if (next === before) {
      return;
    }
    requestSelected(next);
    for (const id of idsOfMask(next)) {
      if (!bit(before, id)) {
        options.onSelectionChange?.(nodeOf(id));
      }
    }
  };
  const select = (id: number): void => {
    requestSelection(weight(id));
  };
  const toggleSelected = (id: number): void => {
    requestSelection(setBit(selectedMask(), id, !bit(selectedMask(), id)));
  };

  const click = (id: number): void => {
    // The spec's click on an unreachable (hidden) node is a no-op.
    if (!visibleIn(id)) {
      return;
    }
    toggleExpanded(id);
    select(id);
    manager.focus(itemId(id));
  };

  const expandSiblings = (id: number): void => {
    const parent = parentOf(id);
    const changed = ids.filter(
      (candidate) =>
        isParent(candidate) &&
        parentOf(candidate) === parent &&
        !bit(expandedNow(), candidate),
    );
    if (changed.length === 0) {
      return;
    }
    let next = expandedMask;
    for (const candidate of changed) {
      next = setBit(next, candidate, true);
    }
    setExpanded(next);
    emitExpanded(changed);
  };

  const selectAll = (): void => {
    const all = ids.reduce((mask, id) => setBit(mask, id, true), 0);
    requestSelection(selectedMask() === all ? 0 : all);
  };

  const isShift = (key: string): boolean => key.startsWith('Shift+');
  const isCtrlA = (key: string): boolean =>
    /^(Control|Meta)\+[aA]$/.test(key);

  const keyDown = (key: string, _repeat = false): boolean => {
    const current = focusedId();
    if (current < 0) {
      return false;
    }
    if (isCtrlA(key)) {
      if (!multi()) {
        return false;
      }
      selectAll();
      return true;
    }
    const tab = tabKey(key);
    if (tab !== undefined) {
      return manager.key(tab);
    }
    const shift = isShift(key);
    const name = shift ? key.slice('Shift+'.length) : key;
    switch (name) {
      case 'ArrowDown':
      case 'ArrowUp': {
        manager.key(name);
        const arrived = focusedId();
        if (shift && multi() && arrived >= 0 && arrived !== current) {
          toggleSelected(arrived);
        }
        return true;
      }
      case 'ArrowRight': {
        if (isParent(current) && bit(expandedNow(), current)) {
          const child = childrenOf(current)[0];
          if (child !== undefined) {
            manager.focus(itemId(child));
          }
        } else {
          toggleExpanded(current);
        }
        return true;
      }
      case 'ArrowLeft': {
        if (isParent(current) && bit(expandedNow(), current)) {
          close(current);
        } else if (parentOf(current) !== 0) {
          manager.focus(itemId(parentOf(current)));
        }
        return true;
      }
      case 'Home':
      case 'End':
        return manager.key(name);
      case 'Enter': {
        if (isParent(current)) {
          toggleExpanded(current);
        }
        if (!multi()) {
          select(current);
        }
        options.onActivate?.(nodeOf(current));
        return true;
      }
      case ' ': {
        if (multi()) {
          toggleSelected(current);
        } else {
          select(current);
        }
        return true;
      }
      case '*':
        expandSiblings(current);
        return true;
      default:
        if (isSpace(name)) {
          if (multi()) {
            toggleSelected(current);
          } else {
            select(current);
          }
          return true;
        }
        return false;
    }
  };

  const focusRoving = (): void => {
    const target = visibleIn(roving) ? roving : firstVisible();
    manager.focus(itemId(target));
  };
  const focusTabStop = (): void => {
    const target = tabStop();
    if (target !== undefined && visibleIn(target)) {
      manager.focus(itemId(target));
    } else {
      focusRoving();
    }
  };

  const items = new Map<number, TreeItemPart>(
    ids.map((id) => {
      const elementId = itemId(id);
      const part: TreeItemPart = {
        id: elementId,
        role: 'treeitem',
        label: byId.get(id)?.label ?? '',
        get level() {
          return levelOf(id);
        },
        get posInSet() {
          return childrenOf(parentOf(id)).indexOf(id) + 1;
        },
        get setSize() {
          return childrenOf(parentOf(id)).length;
        },
        get expanded() {
          return read(() => (isParent(id) ? bit(expandedNow(), id) : undefined));
        },
        get selected() {
          return read(() => bit(selectedMask(), id));
        },
        disabled: false,
        get focused() {
          return read(() => focusedId() === id);
        },
        get tabIndex() {
          return read(() => (roving === id ? 0 : -1));
        },
        get hidden() {
          return read(() => !visibleIn(id));
        },
        press: () => {
          click(id);
        },
        keyDown: (key, repeat) => {
          if (!visibleIn(id)) {
            return false;
          }
          return keyDown(key, repeat);
        },
        keyUp: () => false,
        key: (key) => {
          if (!visibleIn(id)) {
            return false;
          }
          return keyDown(key);
        },
        focus: () => {
          // a hidden element cannot take focus, as in the DOM
          if (visibleIn(id)) {
            manager.focus(elementId);
          }
        },
        blur: () => {
          if (manager.focused() === elementId) {
            manager.blur();
          }
        },
      };
      return [id, part];
    }),
  );

  return {
    nodeIds: ids,
    expanded: () => read(() => idsOfMask(expandedNow())),
    selected: () => read(() => idsOfMask(selectedMask())),
    focus: () => read(() => roving),
    hasFocus: () => read(() => focusedId() >= 0),
    isExpanded: (id) => read(() => bit(expandedNow(), id)),
    isSelected: (id) => read(() => bit(selectedMask(), id)),
    isVisible: (id) => read(() => visibleIn(id)),
    isParent,
    expand: open,
    collapse: close,
    toggleExpanded,
    select,
    toggleSelected,
    keyDown,
    tree: {
      id: base,
      role: 'tree',
      label: options.label,
      get multiSelectable() {
        return multi();
      },
      get orientation() {
        return options.orientation === 'horizontal' ? 'horizontal' : undefined;
      },
      get focused() {
        return read(() => focusedId() >= 0);
      },
      keyDown: (key) => {
        const tab = tabKey(key);
        if (tab !== undefined) {
          if (focusedId() < 0) {
            focusTabStop();
            return true;
          }
          return manager.key(tab);
        }
        return focusedId() >= 0 ? keyDown(key) : false;
      },
      focus: focusRoving,
      blur: () => {
        if (focusedId() >= 0) {
          manager.blur();
        }
      },
    },
    item: (id) => {
      const part = items.get(id);
      if (part === undefined) {
        throw new Error(`unknown tree node ${id}`);
      }
      return part;
    },
  };
};
