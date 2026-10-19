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
 * Slider vocabulary <-> `specs/apg/slider.qnt`, shared by the spec driver and
 * the DOM driver so both gate scenarios identically.
 *
 * Parts: `thumb` (role=slider, the focus holder) and `track` (the spec's
 * `rail`). The spec fixes one concrete configuration — range 0..10, step 1,
 * large step 3, initial value 5 (its constants are `def`s, not events) — so any
 * scenario config that changes the range, step, value or disabled state cannot
 * be translated and is `Unsupported`. Only `orientation` and `dir` are state the
 * spec lets us set (`setOrientation` / `setDir`).
 *
 * Controlled (map ticket rt1p): `controlled` puts the value in a host; a `value`
 * alongside it pins the host (a rejecting host, react-aria's fixed value), a
 * `controlled` alone accepts every request. `setValue` / `hostToggle` are the
 * host writing the value; they are inert while uncontrolled.
 *
 * Pointer input is modelled as the spec's discrete rail press (`pointer`), but
 * the replay DOM driver has no pointerdown/move/up, so those steps are gated
 * `Unsupported`; a `prop: pointer` step (a position) is the walk's pointer
 * alphabet, mapped to the nearest pool raw value.
 */
export interface SliderConfig {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly largeStep: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly dir: 'ltr' | 'rtl';
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
}

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 10;
const DEFAULT_STEP = 1;
const DEFAULT_LARGE_STEP = 3;
const INITIAL_VALUE = 5;

const numberEquals = (
  key: string,
  value: Schema.Json,
  expected: number,
): void => {
  if (typeof value !== 'number' || value !== expected) {
    throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
  }
};

/** Scenario `config` -> what both targets are mounted with. */
export const sliderConfig = (config: ScenarioConfig): SliderConfig => {
  let value = INITIAL_VALUE;
  let min = DEFAULT_MIN;
  let max = DEFAULT_MAX;
  let step = DEFAULT_STEP;
  let largeStep = DEFAULT_LARGE_STEP;
  let orientation: 'horizontal' | 'vertical' = 'horizontal';
  let dir: 'ltr' | 'rtl' = 'ltr';
  let controlled = false;
  let pinned = false;
  for (const [key, raw] of Object.entries(config)) {
    switch (key) {
      case 'thumbs':
        numberEquals(key, raw, 1);
        break;
      case 'value': {
        const number = Number(raw);
        if (number !== INITIAL_VALUE) {
          throw new Unsupported(`config value=${JSON.stringify(raw)}`);
        }
        value = number;
        pinned = true;
        break;
      }
      case 'min':
        numberEquals(key, raw, DEFAULT_MIN);
        min = DEFAULT_MIN;
        break;
      case 'max':
        numberEquals(key, raw, DEFAULT_MAX);
        max = DEFAULT_MAX;
        break;
      case 'step':
        numberEquals(key, raw, DEFAULT_STEP);
        step = DEFAULT_STEP;
        break;
      case 'largeStep':
        numberEquals(key, raw, DEFAULT_LARGE_STEP);
        largeStep = DEFAULT_LARGE_STEP;
        break;
      case 'orientation':
        if (raw !== 'horizontal' && raw !== 'vertical') {
          throw new Unsupported(`config orientation=${JSON.stringify(raw)}`);
        }
        orientation = raw;
        break;
      case 'dir':
        if (raw !== 'ltr' && raw !== 'rtl') {
          throw new Unsupported(`config dir=${JSON.stringify(raw)}`);
        }
        dir = raw;
        break;
      case 'controlled':
        if (typeof raw !== 'boolean') {
          throw new Unsupported(`config controlled=${JSON.stringify(raw)}`);
        }
        controlled = raw;
        break;
      default:
        throw new Unsupported(`config ${key}=${JSON.stringify(raw)}`);
    }
  }
  return {
    value,
    min,
    max,
    step,
    largeStep,
    orientation,
    dir,
    controlled,
    accepts: controlled && !pinned,
  };
};

const partOf = (target: string | undefined): 'thumb' | 'track' => {
  const part = (target ?? 'thumb').replace(/:\d+$/, '');
  if (part === 'thumb') {
    return 'thumb';
  }
  if (part === 'track' || part === 'rail') {
    return 'track';
  }
  throw new Unsupported(`part ${part}`);
};

const onThumb = (step: ActionStep): void => {
  if (partOf(step.target) !== 'thumb') {
    throw new Unsupported(`${step.event} on ${step.target ?? 'track'}`);
  }
};

/** The keys the spec's `keydown` pool carries. */
const KEY_POOL = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Enter',
]);

/** The raw rail-press values the spec's `pointer` action draws from. */
const POINTER_POOL = new Set([-3, 0, 4, 7, 10, 14]);

const valueTextFor = (value: number): string =>
  value <= 3 ? 'low' : value <= 7 ? 'medium' : 'high';

const programmatic = (
  step: ActionStep,
  config: SliderConfig,
): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'orientation':
      if (step.value !== 'horizontal' && step.value !== 'vertical') {
        throw new Unsupported(`prop orientation=${JSON.stringify(step.value)}`);
      }
      return [specEvent('setOrientation', { o: step.value })];
    case 'dir':
      if (step.value !== 'ltr' && step.value !== 'rtl') {
        throw new Unsupported(`prop dir=${JSON.stringify(step.value)}`);
      }
      return [specEvent('setDir', { d: step.value })];
    case 'pointer': {
      if (typeof step.value !== 'number') {
        throw new Unsupported(`prop pointer=${JSON.stringify(step.value)}`);
      }
      const raw =
        config.min + Math.round(step.value * (config.max - config.min));
      if (!POINTER_POOL.has(raw)) {
        throw new Unsupported(`pointer position ${step.value}`);
      }
      return [specEvent('pointer', { raw: BigInt(raw) })];
    }
    case 'setValue': {
      if (typeof step.value !== 'number') {
        throw new Unsupported(`prop setValue=${JSON.stringify(step.value)}`);
      }
      const value = Math.round(step.value);
      if (value !== step.value || value < config.min || value > config.max) {
        throw new Unsupported(`setValue ${JSON.stringify(step.value)}`);
      }
      return [specEvent('setValue', { v: BigInt(value) })];
    }
    case 'hostToggle':
      return [specEvent('hostToggle')];
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

export const sliderBridge: SpecBridge = {
  setup: (config) => {
    const mount = sliderConfig(config);
    return [
      ...(mount.controlled
        ? [
            specEvent('control'),
            ...(mount.accepts ? [specEvent('acceptRequests')] : []),
            ...(mount.accepts
              ? []
              : [specEvent('setValue', { v: BigInt(mount.value) })]),
          ]
        : []),
      ...(mount.orientation === 'vertical'
        ? [specEvent('setOrientation', { o: 'vertical' })]
        : []),
      ...(mount.dir === 'rtl' ? [specEvent('setDir', { d: 'rtl' })] : []),
    ];
  },
  event: (step) => {
    switch (step.event) {
      case 'focus':
        onThumb(step);
        return [specEvent('focus')];
      case 'blur':
        onThumb(step);
        return [specEvent('blur')];
      case 'key': {
        onThumb(step);
        const key = step.key ?? '';
        if (!KEY_POOL.has(key) || step.repeat === true) {
          throw new Unsupported(`key ${key}`);
        }
        // convention: a key first focuses its target, as a user would
        return [specEvent('focus'), specEvent('keydown', { key })];
      }
      case 'hover':
      case 'unhover':
        return [];
      case 'prop': {
        const config = sliderConfig({});
        return programmatic(step, config);
      }
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  value: (state: QuintModelValue) => Number(state['value']),
  focus: (state: QuintModelValue) =>
    state['focused'] === true ? 'thumb:0' : null,
  attr: (state: QuintModelValue, target: string, name: string) => {
    if (partOf(target) !== 'thumb') {
      throw new Unsupported(`attribute ${name} on ${target}`);
    }
    const value = Number(state['value']);
    switch (name) {
      case 'role':
        return 'slider';
      case 'aria-valuenow':
        return String(value);
      case 'aria-valuemin':
        return String(DEFAULT_MIN);
      case 'aria-valuemax':
        return String(DEFAULT_MAX);
      case 'aria-valuetext':
        return valueTextFor(value);
      case 'aria-orientation':
        return String(state['orientation']);
      case 'tabindex':
        return '0';
      default:
        throw new Unsupported(`attribute ${name} on ${target}`);
    }
  },
  visible: () => [],
  events: (before: QuintModelValue, after: QuintModelValue) =>
    before['requests'] === after['requests']
      ? []
      : [['onValueChange', Number(after['requested'])] as const],
};

/** The user-level steps a differential walk draws from. */
export const sliderSteps: ReadonlyArray<ActionStep> = [
  { event: 'focus', target: 'thumb:0' },
  { event: 'blur', target: 'thumb:0' },
  { event: 'key', target: 'thumb:0', key: 'ArrowRight' },
  { event: 'key', target: 'thumb:0', key: 'ArrowLeft' },
  { event: 'key', target: 'thumb:0', key: 'ArrowUp' },
  { event: 'key', target: 'thumb:0', key: 'ArrowDown' },
  { event: 'key', target: 'thumb:0', key: 'Home' },
  { event: 'key', target: 'thumb:0', key: 'End' },
  { event: 'key', target: 'thumb:0', key: 'PageUp' },
  { event: 'key', target: 'thumb:0', key: 'PageDown' },
  { event: 'key', target: 'thumb:0', key: 'Enter' },
  { event: 'prop', prop: 'orientation', value: 'vertical' },
  { event: 'prop', prop: 'orientation', value: 'horizontal' },
  { event: 'prop', prop: 'dir', value: 'rtl' },
  { event: 'prop', prop: 'dir', value: 'ltr' },
  { event: 'prop', prop: 'pointer', value: 0 },
  { event: 'prop', prop: 'pointer', value: 0.4 },
  { event: 'prop', prop: 'pointer', value: 0.7 },
  { event: 'prop', prop: 'pointer', value: 1 },
  { event: 'prop', prop: 'setValue', value: 0 },
  { event: 'prop', prop: 'setValue', value: 3 },
  { event: 'prop', prop: 'setValue', value: 7 },
  { event: 'prop', prop: 'setValue', value: 10 },
  { event: 'prop', prop: 'hostToggle' },
];

export const sliderProbe: Probe = {
  attrs: [
    ['thumb:0', 'role'],
    ['thumb:0', 'aria-valuenow'],
    ['thumb:0', 'aria-valuemin'],
    ['thumb:0', 'aria-valuemax'],
    ['thumb:0', 'aria-valuetext'],
    ['thumb:0', 'aria-orientation'],
    ['thumb:0', 'tabindex'],
  ],
  events: ['onValueChange'],
};
