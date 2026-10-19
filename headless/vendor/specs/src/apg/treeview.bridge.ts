import {
  type ActionStep,
  type Probe,
  type ScenarioConfig,
  type SpecBridge,
  Unsupported,
} from '../scenario';
import type { QuintEvent, QuintModelValue } from '@eoa/quint-machine';
import type { Schema } from 'effect';

// The spec's events are `{ _tag }` records by construction (quint-machine's QuintEvent).
// oxlint-disable-next-line automation/no-manual-tagged-construction
const specEvent = (
  tag: string,
  params: Record<string, bigint | string | boolean> = {},
): QuintEvent => ({ _tag: tag, ...params });

/**
 * Treeview vocabulary <-> `specs/apg/treeview.qnt`, shared by the spec driver
 * and the DOM driver so both gate scenarios identically.
 *
 * The tree is the fixed 7-node pre-order tree of the spec (ids 1..7); scenario
 * targets carry the slash path the fixture renders as `data-part`, so
 * `treeitem:0/1` is Notes. `expanded` / `selected` arrive as path arrays;
 * `focused` maps to `hasFocus`, `multiSelectable` to `multi`.
 */
const PARENT = new Map<number, number>([
  [1, 0],
  [2, 1],
  [3, 2],
  [4, 2],
  [5, 1],
  [6, 0],
  [7, 6],
]);
const CHILDREN = new Map<number, ReadonlyArray<number>>([
  [1, [2, 5]],
  [2, [3, 4]],
  [6, [7]],
]);
const ROOTS: ReadonlyArray<number> = [1, 6];
const IDS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7];

const PREFIX = 'treeitem:';

/** The `data-part` target of a node id (e.g. `treeitem:0/0/1`). */
export const nodeToPath = (node: number): string => {
  const segments: number[] = [];
  let current = node;
  while (current !== 0) {
    const parent = PARENT.get(current) ?? 0;
    const siblings = parent === 0 ? ROOTS : (CHILDREN.get(parent) ?? []);
    const index = siblings.indexOf(current);
    if (index < 0) {
      throw new Error(`unknown treeview node ${current}`);
    }
    segments.unshift(index);
    current = parent;
  }
  return `${PREFIX}${segments.join('/')}`;
};

/** Resolve a scenario path (`treeitem:0/0/1`, `0/1`, ...) to a node id. */
export const pathToNode = (path: string): number => {
  const clean = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
  const parts = clean.split('/');
  const root = Number(parts[0]);
  let node = 0;
  if (root === 0) {
    node = 1;
  } else if (root === 1) {
    node = 6;
  }
  if (node === 0) {
    throw new Unsupported(`treeitem path ${path}`);
  }
  for (const part of parts.slice(1)) {
    const children = CHILDREN.get(node) ?? [];
    const next = children[Number(part)];
    if (next === undefined) {
      throw new Unsupported(`treeitem path ${path}`);
    }
    node = next;
  }
  return node;
};

const parentOf = (node: number): number => PARENT.get(node) ?? 0;
const childrenOf = (node: number): ReadonlyArray<number> =>
  node === 0 ? ROOTS : (CHILDREN.get(node) ?? []);
const isParent = (node: number): boolean => childrenOf(node).length > 0;

const weight = (node: number): number => 1 << (node - 1);
const bit = (mask: number, node: number): boolean =>
  (mask & weight(node)) !== 0;
const setBit = (mask: number, node: number, on: boolean): number =>
  on ? mask | weight(node) : mask & ~weight(node);

const maskOfPaths = (value: Schema.Json | undefined): number => {
  if (!Array.isArray(value)) {
    throw new Unsupported(
      `expected a path array, got ${JSON.stringify(value)}`,
    );
  }
  let mask = 0;
  for (const path of value) {
    if (typeof path !== 'string') {
      throw new Unsupported(`treeitem path ${JSON.stringify(path)}`);
    }
    mask = setBit(mask, pathToNode(path), true);
  }
  return mask;
};

export interface TreeviewConfig {
  readonly multi: boolean;
  readonly expanded: number;
  readonly selected: number;
  readonly focus: number;
  readonly hasFocus: boolean;
  /** Controlled: the host owns the selection and this is the only thing that changes it. */
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
  readonly label?: string;
  readonly orientation?: 'vertical';
}

/** Scenario `config` -> what both targets are mounted with. */
export const treeviewConfig = (config: ScenarioConfig): TreeviewConfig => {
  let multi = false;
  let hasFocus = false;
  let expanded = 0;
  let selected = 0;
  let focus = 1;
  let controlled = false;
  let accepts = false;
  let label: string | undefined;
  let orientation: 'vertical' | undefined;
  for (const [key, value] of Object.entries(config)) {
    switch (key) {
      case 'focused':
        if (typeof value !== 'boolean') {
          throw new Unsupported(`focused=${JSON.stringify(value)}`);
        }
        hasFocus = value;
        break;
      case 'multiSelectable':
        if (typeof value !== 'boolean') {
          throw new Unsupported(`multiSelectable=${JSON.stringify(value)}`);
        }
        multi = value;
        break;
      case 'expanded':
        expanded = maskOfPaths(value);
        break;
      case 'selected':
        selected = maskOfPaths(value);
        break;
      case 'controlled':
        if (typeof value !== 'boolean') {
          throw new Unsupported(`controlled=${JSON.stringify(value)}`);
        }
        controlled = value;
        accepts = value;
        break;
      case 'accepts':
        if (typeof value !== 'boolean') {
          throw new Unsupported(`accepts=${JSON.stringify(value)}`);
        }
        controlled = true;
        accepts = value;
        break;
      case 'focus':
        if (typeof value !== 'string') {
          throw new Unsupported(`focus=${JSON.stringify(value)}`);
        }
        focus = pathToNode(value);
        break;
      case 'label':
        if (typeof value !== 'string') {
          throw new Unsupported(`label=${JSON.stringify(value)}`);
        }
        label = value;
        break;
      case 'orientation':
        if (value !== 'vertical') {
          throw new Unsupported(`orientation ${JSON.stringify(value)}`);
        }
        orientation = 'vertical';
        break;
      default:
        throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
  }
  return {
    multi,
    expanded,
    selected,
    focus,
    hasFocus,
    controlled,
    accepts,
    ...(label === undefined ? {} : { label }),
    ...(orientation === undefined ? {} : { orientation }),
  };
};

const visibleIn = (node: number, expanded: number): boolean => {
  let current = node;
  while (current !== 0) {
    const parent = parentOf(current);
    if (parent !== 0 && !bit(expanded, parent)) {
      return false;
    }
    current = parent;
  }
  return true;
};

const orderVisible = (expanded: number): ReadonlyArray<number> =>
  IDS.filter((node) => visibleIn(node, expanded));

/**
 * Events that bring a fresh model to the scenario config: switch the select
 * mode, focus the tree, open the requested parents, set the selection, move the
 * roving node, then drop DOM focus if the config says so.
 */
const setupEvents = (config: TreeviewConfig): ReadonlyArray<QuintEvent> => {
  const events: QuintEvent[] = [
    specEvent('configure', { m: config.multi }),
    specEvent('focusTree'),
  ];
  let focus = 1;
  let expanded = 0;

  const moveTo = (target: number): void => {
    let guard = 0;
    while (focus !== target) {
      if (guard++ > IDS.length) {
        throw new Unsupported(`focus is not reachable at ${target}`);
      }
      const visible = orderVisible(expanded);
      const from = visible.indexOf(focus);
      const to = visible.indexOf(target);
      if (from < 0 || to < 0) {
        throw new Unsupported(`node ${target} is not visible`);
      }
      events.push(specEvent(from < to ? 'pressDown' : 'pressUp'));
      focus =
        from < to ? (visible[from + 1] ?? focus) : (visible[from - 1] ?? focus);
    }
  };

  for (const node of IDS) {
    if (isParent(node) && bit(config.expanded, node)) {
      moveTo(node);
      events.push(specEvent('pressRight'));
      expanded = setBit(expanded, node, true);
    }
  }
  if (config.controlled) {
    events.push(specEvent('control'));
    if (config.accepts) {
      events.push(specEvent('acceptRequests'));
    }
    if (config.selected !== 0) {
      events.push(specEvent('setValue', { v: BigInt(config.selected) }));
    }
  } else {
    for (const node of IDS.filter((n) => bit(config.selected, n))) {
      moveTo(node);
      events.push(specEvent('pressSpace'));
    }
  }
  moveTo(config.focus);
  if (!config.hasFocus) {
    events.push(specEvent('blurTree'));
  }
  return events;
};

const KEY_EVENTS = new Map<string, string>([
  ['ArrowDown', 'pressDown'],
  ['ArrowUp', 'pressUp'],
  ['ArrowRight', 'pressRight'],
  ['ArrowLeft', 'pressLeft'],
  ['Home', 'pressHome'],
  ['End', 'pressEnd'],
  ['Enter', 'pressEnter'],
  ['Space', 'pressSpace'],
  [' ', 'pressSpace'],
  ['*', 'pressStar'],
]);

export const treeviewBridge: SpecBridge = {
  setup: (config) => setupEvents(treeviewConfig(config)),
  event: (step: ActionStep) => {
    switch (step.event) {
      case 'focus':
        return [specEvent('focusTree')];
      case 'blur':
        return [specEvent('blurTree')];
      case 'click': {
        const node = pathToNode(step.target ?? '');
        return [specEvent('click', { node: BigInt(node) })];
      }
      case 'key': {
        const action = KEY_EVENTS.get(step.key ?? '');
        if (action === undefined) {
          throw new Unsupported(`key ${step.key ?? ''}`);
        }
        return [specEvent('focusTree'), specEvent(action)];
      }
      case 'type': {
        const text = step.text ?? '';
        if ([...text].length !== 1) {
          throw new Unsupported(`type ${JSON.stringify(text)}`);
        }
        return [specEvent('focusTree'), specEvent('typeChar', { ch: text })];
      }
      case 'typeaheadReset':
        return [specEvent('typeaheadReset')];
      case 'prop':
        switch (step.prop) {
          case 'selected':
          case 'setValue':
            return [
              specEvent('setValue', { v: BigInt(maskOfPaths(step.value)) }),
            ];
          case 'hostToggle':
            return [specEvent('hostToggle', { n: 1n })];
          default:
            throw new Unsupported(`prop ${step.prop ?? ''}`);
        }
      case 'hover':
      case 'unhover':
        return [];
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  focus: (state: QuintModelValue) =>
    state['hasFocus'] === true ? nodeToPath(Number(state['focus'])) : null,
  attr: (state: QuintModelValue, target: string, name: string) => {
    const expanded = Number(state['expanded']);
    const selected = Number(state['selected']);
    const focus = Number(state['focus']);
    if (target === 'tree') {
      if (name === 'aria-multiselectable') {
        return state['multi'] === true ? 'true' : 'false';
      }
      if (name === 'aria-orientation') {
        return null;
      }
      throw new Unsupported(`attribute ${name} on tree`);
    }
    const node = pathToNode(target);
    switch (name) {
      case 'aria-expanded':
        return isParent(node) ? (bit(expanded, node) ? 'true' : 'false') : null;
      case 'aria-selected':
        return bit(selected, node) ? 'true' : 'false';
      case 'aria-level': {
        let level = 1;
        let parent = parentOf(node);
        while (parent !== 0) {
          level += 1;
          parent = parentOf(parent);
        }
        return String(level);
      }
      case 'aria-setsize':
        return String(childrenOf(parentOf(node)).length);
      case 'aria-posinset':
        return String(childrenOf(parentOf(node)).indexOf(node) + 1);
      case 'tabindex':
        return focus === node ? '0' : '-1';
      default:
        throw new Unsupported(`attribute ${name} on ${target}`);
    }
  },
  visible: (state: QuintModelValue) =>
    orderVisible(Number(state['expanded'])).map(nodeToPath),
  events: (before: QuintModelValue, after: QuintModelValue) => {
    const out: Array<readonly [string, Schema.Json]> = [];
    const expandedBefore = Number(before['expanded']);
    const expandedAfter = Number(after['expanded']);
    for (const node of IDS) {
      if (bit(expandedBefore, node) !== bit(expandedAfter, node)) {
        out.push(['onExpandedChange', nodeToPath(node)]);
      }
    }
    // onSelectionChange reports the request's intent (newly requested nodes),
    // even while a controlled host ignores it
    if (before['requests'] !== after['requests']) {
      const requested = Number(after['requested']);
      const base = Number(after['base']);
      for (const node of IDS) {
        if (bit(requested, node) && !bit(base, node)) {
          out.push(['onSelectionChange', nodeToPath(node)]);
        }
      }
    }
    return out;
  },
};

/** The user-level steps a differential walk draws from. */
export const treeviewSteps: ReadonlyArray<ActionStep> = [
  { event: 'focus', target: 'tree' },
  { event: 'blur', target: 'tree' },
  { event: 'key', key: 'ArrowDown', target: 'tree' },
  { event: 'key', key: 'ArrowUp', target: 'tree' },
  { event: 'key', key: 'ArrowRight', target: 'tree' },
  { event: 'key', key: 'ArrowLeft', target: 'tree' },
  { event: 'key', key: 'Home', target: 'tree' },
  { event: 'key', key: 'End', target: 'tree' },
  { event: 'key', key: 'Enter', target: 'tree' },
  { event: 'key', key: ' ', target: 'tree' },
  { event: 'key', key: '*', target: 'tree' },
  { event: 'type', text: 'p', target: 'tree' },
  { event: 'type', text: 'r', target: 'tree' },
  { event: 'type', text: 'o', target: 'tree' },
  { event: 'type', text: 's', target: 'tree' },
  { event: 'typeaheadReset' },
  ...IDS.map((node): ActionStep => ({
    event: 'click',
    target: nodeToPath(node),
  })),
  { event: 'prop', prop: 'hostToggle' },
  { event: 'prop', prop: 'selected', value: ['treeitem:0'] },
  { event: 'prop', prop: 'selected', value: ['treeitem:1'] },
  { event: 'prop', prop: 'selected', value: [] },
];

export const treeviewProbe: Probe = {
  attrs: [
    ['tree', 'aria-multiselectable'],
    ...IDS.flatMap((node) => {
      const path = nodeToPath(node);
      return [
        [path, 'aria-expanded'],
        [path, 'aria-selected'],
        [path, 'aria-level'],
        [path, 'aria-setsize'],
        [path, 'aria-posinset'],
        [path, 'tabindex'],
      ] as ReadonlyArray<readonly [string, string]>;
    }),
  ],
  events: ['onExpandedChange', 'onSelectionChange'],
};
