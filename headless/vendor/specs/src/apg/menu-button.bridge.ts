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
 * Menu button vocabulary <-> `specs/apg/menu-button.qnt`. The spec's fixture is
 * fixed: 4 items, item 3 (DOM index 2) aria-disabled, typeahead codes
 * item1=1, item2=2, item3=1, item4=2. `items` is only a length gate (the spec
 * cannot model a menu longer than four); the labels never reach the model.
 *
 * The spec's `menuOpen` axis is its own controlled contract (`controlled` /
 * `accepts` / `value`), separate from `createMenu`'s packed checked `value`.
 * `createMenu`'s open state is still uncontrolled, so the differential walk
 * stays uncontrolled and `setValue` / `hostToggle` are inert on both sides; the
 * controlled vocabulary is accepted here only so a scenario carrying it is
 * modelled instead of silently dropped (see the menu-button DIVERGENCES).
 */
export interface MenuButtonConfig {
  readonly items: ReadonlyArray<string>;
  readonly disabled: ReadonlyArray<number>;
  readonly controlled: boolean;
  readonly accepts: boolean;
  /** The controlled open value (meaningful while controlled). */
  readonly value: boolean;
}

const CONFIG_KEYS = new Set([
  'items',
  'disabled',
  'controlled',
  'accepts',
  'value',
]);

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

export const menuButtonConfig = (config: ScenarioConfig): MenuButtonConfig => {
  let items: ReadonlyArray<string> = [];
  let disabled: ReadonlyArray<number> = [];
  let controlled = false;
  let accepts = true;
  let value = false;
  for (const [key, raw] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(raw)}`);
    }
    if (key === 'items') {
      items = toItems(raw);
    } else if (key === 'disabled') {
      disabled = toIndices(raw);
    } else if (key === 'controlled') {
      controlled = raw === true;
    } else if (key === 'accepts') {
      controlled = true;
      accepts = raw === true;
    } else if (typeof raw === 'boolean') {
      controlled = true;
      value = raw;
    } else {
      throw new Unsupported(`value ${JSON.stringify(raw)}`);
    }
  }
  if (items.length === 0) {
    throw new Unsupported('config has no items');
  }
  // menu-button.qnt models a four-item menu; a longer fixture is a different
  // model, so the scenario is skipped instead of failing on a missing part.
  if (items.length > 4) {
    throw new Unsupported(`items ${items.length}`);
  }
  if (disabled.some((i) => i < 0 || i >= items.length)) {
    throw new Unsupported(`disabled ${JSON.stringify(disabled)}`);
  }
  return { items, disabled, controlled, accepts, value };
};

const keyEvent = (key: string | undefined): QuintEvent => {
  switch (key) {
    case 'Enter':
      return specEvent('activate', { key: 'Enter' });
    case ' ':
    case 'Space':
      return specEvent('activate', { key: 'Space' });
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
    case 'Tab':
      return specEvent('tab_out');
    default:
      throw new Unsupported(`key ${key ?? ''}`);
  }
};

const charCode = (text: string | undefined): bigint => {
  switch ((text ?? '').slice(0, 1).toLowerCase()) {
    case 'a':
    case '1':
      return 1n;
    case 'b':
    case '2':
      return 2n;
    case 'c':
    case '3':
      return 3n;
    default:
      return 1n;
  }
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'focus':
      return [specEvent('focus_in')];
    case 'leave':
      return [specEvent('tab_out')];
    case 'key': {
      const key = (step.value as { key?: unknown } | undefined)?.['key'];
      if (typeof key !== 'string') {
        throw new Unsupported(`prop key ${JSON.stringify(step.value)}`);
      }
      return [keyEvent(key)];
    }
    case 'typeahead':
      return [specEvent('typeahead', { ch: BigInt(Number(step.value)) })];
    case 'type':
      return [specEvent('typeahead', { ch: charCode(String(step.value)) })];
    case 'setValue': {
      if (typeof step.value !== 'boolean') {
        throw new Unsupported(`prop setValue=${JSON.stringify(step.value)}`);
      }
      return [specEvent('setValue', { v: step.value })];
    }
    case 'hostToggle':
      return [specEvent('hostToggle')];
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

// The bridge only models the flat menu button: `trigger`, the `menu` popup and
// `menuitem:0..3`. Any other part (a submenu, a dismiss sibling, an outside
// element) is unsupported, so the scenario is skipped rather than failing on a
// missing DOM part.
const ITEM = /^menuitem:(\d+)$/;

// Whether an opening action has been seen in the current bridge pass. A closed
// menu has no clickable item, so `setup` resets it and the opening events arm
// it; a menuitem click while closed is unsupported (see `event`).
let armed = false;

const assertTarget = (target: string | undefined): void => {
  if (target === undefined || target === 'trigger' || target === 'menu') {
    return;
  }
  const match = ITEM.exec(target);
  if (match?.[1] !== undefined && Number(match[1]) < 4) {
    return;
  }
  throw new Unsupported(`target ${target}`);
};

export const menuButtonBridge: SpecBridge = {
  setup: (config) => {
    const mount = menuButtonConfig(config);
    armed = false;
    return [
      ...(mount.controlled ? [specEvent('control')] : []),
      ...(mount.controlled && mount.accepts
        ? [specEvent('acceptRequests')]
        : []),
      ...(mount.controlled && mount.value
        ? [specEvent('setValue', { v: true })]
        : []),
    ];
  },
  event: (step) => {
    if (step.repeat === true) {
      throw new Unsupported('key repeat');
    }
    assertTarget(step.target);
    switch (step.event) {
      case 'focus':
        return [specEvent('focus_in')];
      case 'blur':
        return [specEvent('tab_out')];
      case 'click':
        // a click on the button toggles; a click on an item activates it. A
        // closed menu has no clickable item, so only a click after an opening
        // action is modelled (armed is set by the opening events below).
        if (step.target === 'trigger' || step.target === undefined) {
          armed = true;
          return [specEvent('click_button')];
        }
        if (!armed) {
          throw new Unsupported('click on a closed menu');
        }
        return [specEvent('activate', { key: 'Enter' })];
      case 'key':
        if (step.target === 'trigger' || step.target === undefined) {
          if (
            step.key === 'Enter' ||
            step.key === ' ' ||
            step.key === 'Space' ||
            step.key === 'ArrowDown' ||
            step.key === 'ArrowUp'
          ) {
            armed = true;
          }
        }
        return [keyEvent(step.key)];
      case 'type':
        // the DOM driver has no label-driven typeahead path; type steps skip
        throw new Unsupported(`type ${step.text ?? ''}`);
      case 'hover':
      case 'unhover':
        // store hover-intent opening (an ariakit/base-ui extension) is not
        // modelled; the menu opens on keyboard and click
        throw new Unsupported(`event ${step.event}`);
      case 'wait':
        return [];
      case 'prop':
        return programmatic(step);
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  focus: (state: QuintModelValue) => {
    const level = Number(state['focusLevel']);
    if (level === 1) {
      return 'trigger';
    }
    if (level === 2) {
      return `menuitem:${Number(state['focusIdx']) - 1}`;
    }
    return null;
  },
  attr: (state: QuintModelValue, target: string, name: string) => {
    if (target === 'trigger') {
      if (name === 'aria-haspopup') {
        return 'menu';
      }
      if (name === 'aria-expanded') {
        return String(state['menuOpen']);
      }
      throw new Unsupported(`attribute ${name} on trigger`);
    }
    if (target === 'menu') {
      if (name === 'hidden') {
        return state['menuOpen'] === true ? null : 'true';
      }
      throw new Unsupported(`attribute ${name} on menu`);
    }
    const match = ITEM.exec(target);
    if (match?.[1] === undefined) {
      throw new Unsupported(`attribute ${name} on ${target}`);
    }
    const index = Number(match[1]);
    if (name === 'role') {
      return 'menuitem';
    }
    if (name === 'aria-disabled') {
      return index === 2 ? 'true' : null;
    }
    if (name === 'tabindex') {
      const focused =
        Number(state['focusLevel']) === 2 &&
        Number(state['focusIdx']) - 1 === index;
      return focused ? '0' : '-1';
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state: QuintModelValue) =>
    state['menuOpen'] === true ? ['menu'] : [],
  events: () => [],
};

/** The user-level steps a differential walk draws from. */
export const menuButtonSteps: ReadonlyArray<ActionStep> = [
  { event: 'prop', prop: 'focus' },
  { event: 'prop', prop: 'leave' },
  { event: 'prop', prop: 'key', value: { key: 'Enter' } },
  { event: 'prop', prop: 'key', value: { key: 'Space' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowDown' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowUp' } },
  { event: 'prop', prop: 'key', value: { key: 'Home' } },
  { event: 'prop', prop: 'key', value: { key: 'End' } },
  { event: 'prop', prop: 'key', value: { key: 'Escape' } },
  { event: 'prop', prop: 'key', value: { key: 'Tab' } },
  { event: 'prop', prop: 'typeahead', value: 1 },
  { event: 'prop', prop: 'typeahead', value: 2 },
  { event: 'prop', prop: 'setValue', value: true },
  { event: 'prop', prop: 'setValue', value: false },
  { event: 'prop', prop: 'hostToggle' },
];

export const menuButtonProbe: Probe = {
  attrs: [
    ['trigger', 'aria-haspopup'],
    ['trigger', 'aria-expanded'],
    ['menu', 'hidden'],
    ['menuitem:0', 'role'],
    ['menuitem:0', 'aria-disabled'],
    ['menuitem:1', 'aria-disabled'],
    ['menuitem:2', 'aria-disabled'],
    ['menuitem:3', 'aria-disabled'],
    ['menuitem:0', 'tabindex'],
    ['menuitem:1', 'tabindex'],
    ['menuitem:2', 'tabindex'],
    ['menuitem:3', 'tabindex'],
  ],
  events: [],
};
