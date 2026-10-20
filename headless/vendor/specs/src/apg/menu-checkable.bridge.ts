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

export type MenuCheckableVariant = 'checkbox-items' | 'radio-items' | 'mixed';

export interface MenuCheckableConfig {
  readonly items: ReadonlyArray<string>;
  readonly variant: MenuCheckableVariant;
  readonly disabled: ReadonlyArray<number>;
  readonly controlled: boolean;
  readonly accepts: boolean;
  /** The controlled packed checked state (`checked(wrap, choice)`). */
  readonly value: number;
}

const CONFIG_KEYS = new Set([
  'items',
  'variant',
  'disabled',
  'controlled',
  'accepts',
  'value',
]);

/** The packed checked values `menu-checkable.qnt`'s `setValue` pool carries. */
const CHECKED_POOL = new Set([2, 3, 4, 7, 8, 9]);

const toItems = (value: Schema.Json | undefined): ReadonlyArray<string> => {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value;
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
 * Menu (checkable) vocabulary <-> `specs/apg/menu-checkable.qnt`. The spec's
 * fixture is fixed: item 1 is a menuitemcheckbox, items 2-4 one menuitemradio
 * group and item 5 a plain menuitem; `variant: "mixed"` asks the fixture for
 * that shape. `checkbox-items` / `radio-items` are the ported scenarios'
 * uniform menus (never used by the differential walk).
 */
export const menuCheckableConfig = (
  config: ScenarioConfig,
): MenuCheckableConfig => {
  let items: ReadonlyArray<string> = [];
  let variant: MenuCheckableVariant = 'mixed';
  let disabled: ReadonlyArray<number> = [];
  let controlled = false;
  let accepts = true;
  let value = 2;
  for (const [key, val] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(val)}`);
    }
    if (key === 'items') {
      items = toItems(val);
    } else if (key === 'variant') {
      if (
        val !== 'checkbox-items' &&
        val !== 'radio-items' &&
        val !== 'mixed'
      ) {
        throw new Unsupported(`variant ${JSON.stringify(val)}`);
      }
      variant = val;
    } else if (key === 'controlled') {
      controlled = val === true;
    } else if (key === 'accepts') {
      controlled = true;
      accepts = val === true;
    } else if (key === 'value') {
      const packed = typeof val === 'number' ? val : Number.NaN;
      if (!CHECKED_POOL.has(packed)) {
        throw new Unsupported(`value ${JSON.stringify(val)}`);
      }
      controlled = true;
      value = packed;
    } else {
      disabled = toIndices(val);
    }
  }
  if (items.length === 0) {
    throw new Unsupported('config has no items');
  }
  return { items, variant, disabled, controlled, accepts, value };
};

const keyEvent = (key: string | undefined): QuintEvent => {
  switch (key) {
    case 'Enter':
      return specEvent('enter');
    case ' ':
    case 'Space':
      return specEvent('space');
    case 'ArrowDown':
      return specEvent('arrow_down');
    case 'ArrowUp':
      return specEvent('arrow_up');
    case 'Home':
      return specEvent('key_home');
    case 'End':
      return specEvent('key_end');
    case 'Escape':
      return specEvent('escape');
    default:
      throw new Unsupported(`key ${key ?? ''}`);
  }
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'key': {
      const key = (step.value as { key?: unknown } | undefined)?.['key'];
      if (typeof key !== 'string') {
        throw new Unsupported(`prop key ${JSON.stringify(step.value)}`);
      }
      return [keyEvent(key)];
    }
    case 'setValue': {
      const packed = typeof step.value === 'number' ? step.value : Number.NaN;
      if (!CHECKED_POOL.has(packed)) {
        throw new Unsupported(`prop setValue=${JSON.stringify(step.value)}`);
      }
      return [specEvent('setValue', { v: BigInt(packed) })];
    }
    case 'hostToggle':
      return [specEvent('hostToggle')];
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

const itemIndexOf = (target: string | undefined): number => {
  const match = /^(?:menuitem|item):(\d+)$/.exec(target ?? 'menuitem:0');
  if (match?.[1] === undefined) {
    throw new Unsupported(`target ${target ?? ''}`);
  }
  return Number(match[1]) + 1;
};

export const menuCheckableBridge: SpecBridge = {
  setup: (config) => {
    const mount = menuCheckableConfig(config);
    return [
      ...(mount.controlled ? [specEvent('control')] : []),
      ...(mount.controlled && mount.accepts
        ? [specEvent('acceptRequests')]
        : []),
      ...(mount.controlled && mount.value !== 2
        ? [specEvent('setValue', { v: BigInt(mount.value) })]
        : []),
    ];
  },
  event: (step) => {
    if (step.repeat === true) {
      throw new Unsupported('key repeat');
    }
    switch (step.event) {
      case 'focus':
      case 'blur':
        return [];
      case 'click':
        // the spec models keyboard activation only; the DOM keeps the pointer
        return [];
      case 'key':
        return [keyEvent(step.key)];
      case 'type':
        throw new Unsupported(`type ${step.text ?? ''}`);
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
    const index = Number(state['focusIdx']);
    return state['menuOpen'] === true ? `menuitem:${index - 1}` : 'trigger';
  },
  attr: (state: QuintModelValue, target: string, name: string) => {
    const index = itemIndexOf(target);
    if (target.startsWith('trigger')) {
      if (name === 'aria-expanded') {
        return String(state['menuOpen']);
      }
    } else if (name === 'role') {
      if (index === 1) {
        return 'menuitemcheckbox';
      }
      if (index >= 2 && index <= 4) {
        return 'menuitemradio';
      }
      return 'menuitem';
    } else if (name === 'aria-checked') {
      if (index === 1) {
        return state['wrap'] === true ? 'true' : 'false';
      }
      if (index >= 2 && index <= 4) {
        return Number(state['choice']) === index ? 'true' : 'false';
      }
      throw new Unsupported('plain item has no aria-checked');
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state: QuintModelValue) =>
    state['menuOpen'] === true ? ['menu'] : [],
  events: () => [],
};

/** The user-level steps a differential walk draws from. */
export const menuCheckableSteps: ReadonlyArray<ActionStep> = [
  { event: 'prop', prop: 'key', value: { key: 'Enter' } },
  { event: 'prop', prop: 'key', value: { key: 'Space' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowDown' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowUp' } },
  { event: 'prop', prop: 'key', value: { key: 'Home' } },
  { event: 'prop', prop: 'key', value: { key: 'End' } },
  { event: 'prop', prop: 'key', value: { key: 'Escape' } },
  { event: 'prop', prop: 'setValue', value: 7 },
  { event: 'prop', prop: 'setValue', value: 4 },
  { event: 'prop', prop: 'setValue', value: 2 },
  { event: 'prop', prop: 'hostToggle' },
];

export const menuCheckableProbe: Probe = {
  attrs: [
    ['trigger', 'aria-expanded'],
    ['menu', 'hidden'],
    ['menuitem:0', 'role'],
    ['menuitem:0', 'aria-checked'],
    ['menuitem:1', 'role'],
    ['menuitem:1', 'aria-checked'],
    ['menuitem:2', 'role'],
    ['menuitem:2', 'aria-checked'],
    ['menuitem:3', 'role'],
    ['menuitem:3', 'aria-checked'],
  ],
  events: [],
};
