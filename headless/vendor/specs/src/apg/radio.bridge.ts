import type {
  ActionStep,
  Probe,
  ScenarioConfig,
  SpecBridge,
} from '../scenario';
import type {
  QuintEvent,
  QuintModelValue,
  QuintValue,
} from '@eoa/quint-machine';
import type { Schema } from 'effect';
import { Unsupported } from '../scenario';

// The spec's events are `{ _tag }` records by construction (quint-machine's QuintEvent).
// oxlint-disable-next-line automation/no-manual-tagged-construction
const specEvent = (
  tag: string,
  params: Record<string, bigint | string> = {},
): QuintEvent => ({ _tag: tag, ...params });

/** Scenario `config` -> what both targets are mounted with. */
export interface RadioConfig {
  /** Radio count; the spec fixes it at four, so more is unsupported. */
  readonly items: number;
  readonly values: ReadonlyArray<Schema.Json>;
  readonly checked: number | null;
  readonly flavor: 'roving' | 'activedescendant';
  readonly disabled: ReadonlyArray<number>;
  readonly direction: 'ltr' | 'rtl';
  readonly orientation: 'horizontal' | 'vertical' | undefined;
  readonly describedby: string | undefined;
  /** The host owns the check (`value` prop present). */
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back. */
  readonly accepts: boolean;
  /** Controlled only: a pinned checked index the host holds (rejects). */
  readonly pinned: number | null;
}

const FLAVORS = new Set<RadioConfig['flavor']>(['roving', 'activedescendant']);
const DIRECTIONS = new Set<RadioConfig['direction']>(['ltr', 'rtl']);
const ORIENTATIONS = new Set<NonNullable<RadioConfig['orientation']>>([
  'horizontal',
  'vertical',
]);

const parseChecked = (value: Schema.Json | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const match = /^radio:(\d+)$/.exec(value);
    if (match?.[1] !== undefined) {
      return Number(match[1]);
    }
  }
  throw new Unsupported(`checked ${JSON.stringify(value)}`);
};

/**
 * Radio-group vocabulary <-> `specs/apg/radio.qnt`. Parts: `radiogroup` and
 * `radio:N`. The spec fixes the group at four radios, so a scenario with more
 * (or a value count that disagrees with `items`) is unsupported; a smaller
 * group still maps onto the same events for scenario replay.
 */
export const radioConfig = (config: ScenarioConfig): RadioConfig => {
  let items: number | undefined;
  let values: ReadonlyArray<Schema.Json> | undefined;
  let checked: number | null = null;
  let flavor: RadioConfig['flavor'] = 'roving';
  let disabled: ReadonlyArray<number> = [];
  let direction: RadioConfig['direction'] = 'ltr';
  let orientation: RadioConfig['orientation'];
  let describedby: string | undefined;
  let controlled = false;
  let pinned: number | null = null;

  for (const [key, value] of Object.entries(config)) {
    switch (key) {
      case 'items':
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 1
        ) {
          throw new Unsupported(`items ${JSON.stringify(value)}`);
        }
        items = value;
        break;
      case 'values':
        if (!Array.isArray(value)) {
          throw new Unsupported(`values ${JSON.stringify(value)}`);
        }
        values = value;
        break;
      case 'checked':
        checked = parseChecked(value);
        break;
      case 'flavor':
        if (
          typeof value !== 'string' ||
          !FLAVORS.has(value as RadioConfig['flavor'])
        ) {
          throw new Unsupported(`flavor ${JSON.stringify(value)}`);
        }
        flavor = value as RadioConfig['flavor'];
        break;
      case 'disabled':
        if (
          !Array.isArray(value) ||
          !value.every((v) => typeof v === 'number' && Number.isInteger(v))
        ) {
          throw new Unsupported(`disabled ${JSON.stringify(value)}`);
        }
        disabled = value;
        break;
      case 'direction':
        if (
          typeof value !== 'string' ||
          !DIRECTIONS.has(value as RadioConfig['direction'])
        ) {
          throw new Unsupported(`direction ${JSON.stringify(value)}`);
        }
        direction = value as RadioConfig['direction'];
        break;
      case 'orientation':
        if (
          typeof value !== 'string' ||
          !ORIENTATIONS.has(value as NonNullable<RadioConfig['orientation']>)
        ) {
          throw new Unsupported(`orientation ${JSON.stringify(value)}`);
        }
        orientation = value as RadioConfig['orientation'];
        break;
      case 'radioDescribedby':
        if (typeof value !== 'string') {
          throw new Unsupported(`radioDescribedby ${JSON.stringify(value)}`);
        }
        describedby = value;
        break;
      case 'controlled':
        if (typeof value !== 'boolean') {
          throw new Unsupported(`controlled ${JSON.stringify(value)}`);
        }
        controlled ||= value;
        break;
      case 'value': {
        const index = parseChecked(value);
        if (index === null) {
          throw new Unsupported(`value ${JSON.stringify(value)}`);
        }
        pinned = index;
        controlled = true;
        break;
      }
      default:
        throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
  }

  if (items === undefined && values === undefined) {
    throw new Unsupported('radio config needs items or values');
  }
  if (items !== undefined && items > 4) {
    throw new Unsupported(`items ${items} (spec models four)`);
  }
  if (items === undefined) {
    if (values === undefined) {
      throw new Unsupported('no items');
    }
    items = values.length;
  }
  if (values !== undefined && values.length !== items) {
    throw new Unsupported(`values ${values.length} vs items ${items}`);
  }
  if (values === undefined) {
    values = Array.from({ length: items }, (_, i) => String(i));
  }
  if (
    pinned !== null &&
    (pinned < 0 || pinned > 3 || disabled.includes(pinned))
  ) {
    throw new Unsupported(`value ${pinned} cannot be checked`);
  }
  return {
    items,
    values,
    checked,
    flavor,
    disabled,
    direction,
    orientation,
    describedby,
    controlled,
    accepts: controlled && pinned === null,
    pinned,
  };
};

const partOf = (target: string | undefined): string => {
  if (target === undefined) {
    throw new Unsupported('step needs a target');
  }
  return target.replace(/:0$/, '');
};

/** base-ui calls the callback `onValueChange`; ariakit/react-aria call it `onChange`. */
export const canonicalEvent = (name: string): string =>
  name === 'onValueChange' ? 'onChange' : name;

const jsonKey = (value: Schema.Json | undefined): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const key = (value as Readonly<Record<string, Schema.Json>>)['key'];
  return typeof key === 'string' ? key : undefined;
};

const radioIndexOf = (target: string | undefined): number => {
  const part = partOf(target);
  if (part === 'radio') {
    return 0;
  }
  const match = /^radio:(\d+)$/.exec(part);
  const index = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(index) || index < 0 || index > 3) {
    throw new Unsupported(`target ${target ?? ''}`);
  }
  return index;
};

const keyEvents = (key: string | undefined): ReadonlyArray<QuintEvent> => {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return [specEvent('arrow_next')];
    case 'ArrowUp':
    case 'ArrowLeft':
      return [specEvent('arrow_prev')];
    case ' ':
    case 'Space':
      return [specEvent('space')];
    case 'Enter':
      return [];
    default:
      throw new Unsupported(`key ${key ?? ''}`);
  }
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'focus':
      return [specEvent('enter')];
    case 'blur':
      return [specEvent('leave')];
    case 'key': {
      const key = jsonKey(step.value);
      if (key === undefined) {
        throw new Unsupported(`prop key ${JSON.stringify(step.value)}`);
      }
      return keyEvents(key);
    }
    case 'click': {
      if (typeof step.value !== 'number' || !Number.isInteger(step.value)) {
        throw new Unsupported(`prop click ${JSON.stringify(step.value)}`);
      }
      return [specEvent('click', { target: BigInt(step.value) })];
    }
    case 'preselect': {
      const pick = typeof step.value === 'number' ? step.value : -1;
      return [specEvent('preselect', { pick: BigInt(pick) })];
    }
    case 'setValue': {
      if (typeof step.value !== 'number' || !Number.isInteger(step.value)) {
        throw new Unsupported(`setValue ${JSON.stringify(step.value)}`);
      }
      return [specEvent('setValue', { v: BigInt(step.value) })];
    }
    case 'disabled': {
      if (typeof step.value !== 'number' || !Number.isInteger(step.value)) {
        throw new Unsupported(`prop disabled ${JSON.stringify(step.value)}`);
      }
      return [specEvent('set_disabled', { m: BigInt(step.value) })];
    }
    case 'flavor': {
      if (
        typeof step.value !== 'string' ||
        !FLAVORS.has(step.value as RadioConfig['flavor'])
      ) {
        throw new Unsupported(`prop flavor ${JSON.stringify(step.value)}`);
      }
      return [specEvent('set_flavor', { v: step.value })];
    }
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

const asInt = (value: QuintValue | undefined): number => {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return -1;
};

const bit = (mask: bigint, index: number): boolean =>
  (mask >> BigInt(index)) % 2n === 1n;

const tabStop = (mask: bigint, checked: number): number => {
  if (checked >= 0) {
    return checked;
  }
  for (let index = 0; index < 4; index += 1) {
    if (!bit(mask, index)) {
      return index;
    }
  }
  return 0;
};

export const radioBridge: SpecBridge = {
  setup: (config) => {
    const mount = radioConfig(config);
    const events: QuintEvent[] = [];
    if (mount.flavor === 'activedescendant') {
      events.push(specEvent('set_flavor', { v: 'activedescendant' }));
    }
    if (mount.disabled.length > 0) {
      const mask = mount.disabled.reduce((acc, index) => acc | (1 << index), 0);
      events.push(specEvent('set_disabled', { m: BigInt(mask) }));
    }
    const initialChecked = mount.controlled
      ? (mount.pinned ?? mount.checked)
      : mount.checked;
    if (initialChecked !== null) {
      events.push(specEvent('preselect', { pick: BigInt(initialChecked) }));
    }
    if (mount.controlled) {
      events.push(specEvent('control'));
      if (mount.accepts) {
        events.push(specEvent('acceptRequests'));
      }
    }
    return events;
  },
  event: (step) => {
    switch (step.event) {
      case 'focus':
        radioIndexOf(step.target);
        return [specEvent('enter')];
      case 'blur':
        partOf(step.target);
        return [specEvent('leave')];
      case 'click':
        return [
          specEvent('click', { target: BigInt(radioIndexOf(step.target)) }),
        ];
      case 'key':
        partOf(step.target);
        if (step.repeat === true) {
          throw new Unsupported('key repeat is not modelled as one event');
        }
        return keyEvents(step.key);
      case 'prop':
        return programmatic(step);
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  focus: (state: QuintModelValue) => {
    const focus = asInt(state['focus']);
    if (state['flavor'] === 'activedescendant') {
      return focus >= 0 ? 'radiogroup' : null;
    }
    return focus >= 0 ? `radio:${focus}` : null;
  },
  attr: (state: QuintModelValue, target: string, name: string) => {
    const part = partOf(target);
    const flavor = String(state['flavor']);
    const checked = asInt(state['checked']);
    const focus = asInt(state['focus']);
    const mask = typeof state['mask'] === 'bigint' ? state['mask'] : 0n;
    if (part === 'radiogroup') {
      if (name === 'aria-activedescendant') {
        return flavor === 'activedescendant' && focus >= 0
          ? `radio:${focus}`
          : null;
      }
      throw new Unsupported(`attribute ${name} on ${target}`);
    }
    const index = radioIndexOf(target);
    switch (name) {
      case 'aria-checked':
        return checked === index ? 'true' : 'false';
      case 'aria-disabled':
        return bit(mask, index) ? 'true' : 'false';
      case 'tabindex':
        if (flavor !== 'roving') {
          return null;
        }
        return index === tabStop(mask, checked) ? '0' : '-1';
      default:
        throw new Unsupported(`attribute ${name} on ${target}`);
    }
  },
  visible: () => [],
  events: (before: QuintModelValue, after: QuintModelValue) =>
    before['requests'] === after['requests']
      ? []
      : [['onChangeIndex', Number(after['requested'])] as const],
  eventName: canonicalEvent,
};

/** The user-level steps a differential walk draws from. */
export const radioSteps: ReadonlyArray<ActionStep> = [
  { event: 'prop', prop: 'focus' },
  { event: 'prop', prop: 'blur' },
  { event: 'prop', prop: 'key', value: { key: 'ArrowDown' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowUp' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowLeft' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowRight' } },
  { event: 'prop', prop: 'key', value: { key: ' ' } },
  { event: 'prop', prop: 'preselect', value: 0 },
  { event: 'prop', prop: 'preselect', value: 1 },
  { event: 'prop', prop: 'preselect', value: 2 },
  { event: 'prop', prop: 'preselect', value: 3 },
  { event: 'prop', prop: 'disabled', value: 0 },
  { event: 'prop', prop: 'disabled', value: 1 },
  { event: 'prop', prop: 'disabled', value: 6 },
  { event: 'prop', prop: 'disabled', value: 9 },
  { event: 'prop', prop: 'disabled', value: 14 },
  { event: 'prop', prop: 'flavor', value: 'roving' },
  { event: 'prop', prop: 'flavor', value: 'activedescendant' },
  { event: 'prop', prop: 'click', value: 0 },
  { event: 'prop', prop: 'click', value: 1 },
  { event: 'prop', prop: 'click', value: 2 },
  { event: 'prop', prop: 'click', value: 3 },
  { event: 'prop', prop: 'setValue', value: 2 },
];

export const radioProbe: Probe = {
  attrs: [
    ['radiogroup', 'aria-activedescendant'],
    ['radio:0', 'aria-checked'],
    ['radio:1', 'aria-checked'],
    ['radio:2', 'aria-checked'],
    ['radio:3', 'aria-checked'],
    ['radio:0', 'aria-disabled'],
    ['radio:1', 'aria-disabled'],
    ['radio:2', 'aria-disabled'],
    ['radio:3', 'aria-disabled'],
    ['radio:0', 'tabindex'],
    ['radio:1', 'tabindex'],
    ['radio:2', 'tabindex'],
    ['radio:3', 'tabindex'],
  ],
  events: ['onChangeIndex'],
};
