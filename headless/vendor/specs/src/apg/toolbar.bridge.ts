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

export type ToolbarOrientation = 'horizontal' | 'vertical';

export interface ToolbarConfig {
  readonly items: ReadonlyArray<string>;
  readonly orientation: ToolbarOrientation;
  readonly wrap: boolean;
  readonly disabled: ReadonlyArray<number>;
}

const UNMODELLED_TOKENS = new Set([
  'separator',
  'combobox',
  'numberfield',
  'modaltrigger',
  'group',
]);

// A menu trigger renders as the toolbar's item 0 in the spec; the base-ui
// scenario spells it `button:menutrigger`. Normalize both spellings.
const isMenuTrigger = (entry: string): boolean =>
  entry.toLowerCase().includes('menutrigger');

const toItems = (value: Schema.Json | undefined): ReadonlyArray<string> => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Unsupported(`items ${String(value)}`);
    }
    return Array.from({ length: value }, () => 'button');
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    for (const entry of value) {
      if (isMenuTrigger(entry)) {
        continue;
      }
      if (entry.includes(':') || UNMODELLED_TOKENS.has(entry.toLowerCase())) {
        throw new Unsupported(`item ${entry}`);
      }
    }
    return value.map((entry) => (isMenuTrigger(entry) ? 'menutrigger' : entry));
  }
  throw new Unsupported(`items ${JSON.stringify(value)}`);
};

const toIndices = (value: Schema.Json | undefined): ReadonlyArray<number> => {
  if (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'number' && Number.isInteger(v))
  ) {
    return value;
  }
  throw new Unsupported(`disabled ${JSON.stringify(value)}`);
};

/**
 * Toolbar vocabulary <-> `specs/apg/toolbar.qnt`. The spec's fixture is fixed at
 * five items (0 menu-button, 1 button, 2 text, 3 spin, 4 button); the fixture
 * maps item-kind tokens onto that shape, and a `menutrigger` token becomes item
 * 0. The roving-tabindex part is the platform's `focusgroup` contract (see
 * `shared/focusgroup.qnt`); this bridge reads the spec's delta (axis, wrap,
 * disabled-but-focusable, embedded consumers) plus the menu-button: while the
 * menu is open, focus is the menu item, the popup is visible and item 0 carries
 * aria-expanded.
 */
export const toolbarConfig = (config: ScenarioConfig): ToolbarConfig => {
  let items: ReadonlyArray<string> = [];
  let orientation: ToolbarOrientation = 'horizontal';
  let wrap = false;
  let disabled: ReadonlyArray<number> = [];
  for (const [key, value] of Object.entries(config)) {
    switch (key) {
      case 'items':
        items = toItems(value);
        break;
      case 'orientation':
        if (value !== 'horizontal' && value !== 'vertical') {
          throw new Unsupported(`orientation ${JSON.stringify(value)}`);
        }
        orientation = value;
        break;
      case 'loopFocus':
        wrap = value === true;
        break;
      case 'disabled':
      case 'disabledIndices':
        disabled = toIndices(value);
        break;
      case 'direction':
        if (value !== 'ltr') {
          throw new Unsupported(`direction ${JSON.stringify(value)}`);
        }
        break;
      case 'role':
        if (value !== 'toolbar') {
          throw new Unsupported(`role ${JSON.stringify(value)}`);
        }
        break;
      case 'composite':
        if (value !== true) {
          throw new Unsupported(`composite ${JSON.stringify(value)}`);
        }
        break;
      default:
        throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
  }
  if (items.length === 0) {
    throw new Unsupported('config has no items');
  }
  return { items, orientation, wrap, disabled };
};

const BIT = [1n, 2n, 4n, 8n, 16n];
const bit = (index: number): bigint => BIT[index] ?? 0n;
const isDisabledIn = (mask: bigint, index: number): boolean =>
  (mask / bit(index)) % 2n === 1n;

const keyEvent = (key: string | undefined): QuintEvent => {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End':
      return specEvent('key', {
        k: key.replace('Arrow', ''),
      });
    case 'Enter':
    case ' ':
    case 'Space':
      return specEvent('activate');
    case 'Escape':
      return specEvent('escape');
    case 'Tab':
      return specEvent('tab', { back: false });
    case 'Shift+Tab':
      return specEvent('tab', { back: true });
    default:
      throw new Unsupported(`key ${key ?? ''}`);
  }
};

const itemIndexOf = (target: string | undefined): number => {
  const match = /^item:(\d+)$/.exec(target ?? 'item:0');
  if (match?.[1] === undefined) {
    throw new Unsupported(`target ${target ?? ''}`);
  }
  return Number(match[1]);
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'tabIn':
      return [specEvent('tabIn')];
    case 'leave':
      return [specEvent('leave')];
    case 'tab':
      return [
        specEvent('tab', {
          back:
            (step.value as { back?: unknown } | undefined)?.['back'] === true,
        }),
      ];
    case 'click':
      return [specEvent('click', { idx: BigInt(Number(step.value)) })];
    case 'key': {
      const key = (step.value as { k?: unknown } | undefined)?.['k'];
      if (typeof key !== 'string') {
        throw new Unsupported(`prop key ${JSON.stringify(step.value)}`);
      }
      // the walk alphabet spells arrows short (`Left`); keyEvent wants `ArrowLeft`
      const named = ['Left', 'Right', 'Up', 'Down'].includes(key)
        ? `Arrow${key}`
        : key;
      return [keyEvent(named)];
    }
    case 'activate':
      return [specEvent('activate')];
    case 'toggleDisabled':
      return [specEvent('toggleDisabled', { idx: BigInt(Number(step.value)) })];
    case 'flipOrientation':
      return [specEvent('flipOrientation')];
    case 'flipWrap':
      return [specEvent('flipWrap')];
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

export const toolbarBridge: SpecBridge = {
  setup: (config) => {
    const mount = toolbarConfig(config);
    return [
      ...(mount.orientation === 'vertical'
        ? [specEvent('flipOrientation')]
        : []),
      ...(mount.wrap ? [specEvent('flipWrap')] : []),
      ...mount.disabled.map((index) =>
        specEvent('toggleDisabled', { idx: BigInt(index) }),
      ),
    ];
  },
  event: (step) => {
    if (step.repeat === true) {
      throw new Unsupported('key repeat');
    }
    switch (step.event) {
      case 'focus':
        return [specEvent('tabIn')];
      case 'blur':
        return [specEvent('leave')];
      case 'click':
        return [specEvent('click', { idx: BigInt(itemIndexOf(step.target)) })];
      case 'key':
        return [keyEvent(step.key)];
      case 'hover':
      case 'unhover':
      case 'wait':
        return [];
      case 'prop':
        return programmatic(step);
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  focus: (state: QuintModelValue) => {
    // while the menu is open the menu owns focus: the roving focus is suspended
    // on the menu-button item (spec item 0)
    if (state['menuOpen'] === true) {
      return `menuitem:${Number(state['menuIndex'])}`;
    }
    const focus = Number(state['focus']);
    return focus >= 0 ? `item:${focus}` : null;
  },
  attr: (state: QuintModelValue, target: string, name: string) => {
    if (target === 'toolbar') {
      if (name === 'role') {
        return 'toolbar';
      }
      if (name === 'aria-orientation') {
        return String(state['orientation']);
      }
      throw new Unsupported(`attribute ${name} on toolbar`);
    }
    const index = itemIndexOf(target);
    if (name === 'tabindex') {
      return Number(state['tabStop']) === index ? '0' : '-1';
    }
    if (name === 'aria-disabled') {
      const mask =
        typeof state['disabledMask'] === 'bigint' ? state['disabledMask'] : 0n;
      return isDisabledIn(mask, index) ? 'true' : null;
    }
    // item 0 is the menu-button: aria-haspopup and aria-expanded track the menu
    if (index === 0 && name === 'aria-haspopup') {
      return 'menu';
    }
    if (index === 0 && name === 'aria-expanded') {
      return String(state['menuOpen'] === true);
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state: QuintModelValue) =>
    state['menuOpen'] === true ? ['popup'] : [],
  events: () => [],
};

/** The user-level steps a differential walk draws from. */
export const toolbarSteps: ReadonlyArray<ActionStep> = [
  { event: 'prop', prop: 'tabIn' },
  { event: 'prop', prop: 'leave' },
  { event: 'prop', prop: 'tab', value: { back: false } },
  { event: 'prop', prop: 'tab', value: { back: true } },
  { event: 'prop', prop: 'click', value: 0 },
  { event: 'prop', prop: 'click', value: 1 },
  { event: 'prop', prop: 'click', value: 2 },
  { event: 'prop', prop: 'click', value: 3 },
  { event: 'prop', prop: 'click', value: 4 },
  { event: 'prop', prop: 'key', value: { k: 'Left' } },
  { event: 'prop', prop: 'key', value: { k: 'Right' } },
  { event: 'prop', prop: 'key', value: { k: 'Up' } },
  { event: 'prop', prop: 'key', value: { k: 'Down' } },
  { event: 'prop', prop: 'key', value: { k: 'Home' } },
  { event: 'prop', prop: 'key', value: { k: 'End' } },
  { event: 'prop', prop: 'key', value: { k: 'Escape' } },
  { event: 'prop', prop: 'activate' },
  { event: 'prop', prop: 'toggleDisabled', value: 0 },
  { event: 'prop', prop: 'toggleDisabled', value: 3 },
  { event: 'prop', prop: 'flipOrientation' },
  { event: 'prop', prop: 'flipWrap' },
];

export const toolbarProbe: Probe = {
  attrs: [
    ['toolbar', 'role'],
    ['toolbar', 'aria-orientation'],
    ['item:0', 'tabindex'],
    ['item:0', 'aria-disabled'],
    ['item:0', 'aria-haspopup'],
    ['item:0', 'aria-expanded'],
    ['item:1', 'tabindex'],
    ['item:1', 'aria-disabled'],
    ['item:2', 'tabindex'],
    ['item:2', 'aria-disabled'],
    ['item:3', 'tabindex'],
    ['item:3', 'aria-disabled'],
    ['item:4', 'tabindex'],
    ['item:4', 'aria-disabled'],
  ],
  events: [],
};
