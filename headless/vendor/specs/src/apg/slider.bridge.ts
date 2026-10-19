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
 * `rail`). The spec fixes the range at 0..10 but now carries a small variant
 * table (`configure`): step 1 / large step 3 / value 5, and step 2 / large
 * step 4 / value 6. A scenario config outside the table is `Unsupported`; only
 * `orientation` and `dir` are state the spec lets us set directly
 * (`setOrientation` / `setDir`).
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
  readonly flavor: number;
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

/**
 * The spec's `configure` variants: step, large step and starting value.
 * `largeStep` is a multiple of `step`, so a page jump stays on the grid. The
 * range is 0..10 in every variant, so one walk alphabet fits all of them.
 */
const VARIANTS = [
  { min: 0, max: 10, step: 1, largeStep: 3, value: 5 },
  { min: 0, max: 10, step: 2, largeStep: 4, value: 6 },
] as const;

const numberIn = (key: string, value: Schema.Json) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
  }
  return value;
};

interface SliderSlice {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly largeStep: number;
  readonly value: number | undefined;
  readonly orientation: 'horizontal' | 'vertical';
  readonly dir: 'ltr' | 'rtl';
  readonly controlled: boolean;
  readonly pinned: boolean;
}

const DEFAULT_SLICE: SliderSlice = {
  min: VARIANTS[0].min,
  max: VARIANTS[0].max,
  step: VARIANTS[0].step,
  largeStep: VARIANTS[0].largeStep,
  value: undefined,
  orientation: 'horizontal',
  dir: 'ltr',
  controlled: false,
  pinned: false,
};

const parseSlice = (slice: SliderSlice, key: string, raw: Schema.Json) => {
  switch (key) {
    case 'thumbs':
      if (numberIn(key, raw) !== 1) {
        throw new Unsupported(`config thumbs=${JSON.stringify(raw)}`);
      }
      return slice;
    case 'value':
      return { ...slice, value: numberIn(key, raw), pinned: true };
    case 'min':
      return { ...slice, min: numberIn(key, raw) };
    case 'max':
      return { ...slice, max: numberIn(key, raw) };
    case 'step':
      return { ...slice, step: numberIn(key, raw) };
    case 'largeStep':
      return { ...slice, largeStep: numberIn(key, raw) };
    case 'orientation':
      switch (raw) {
        case 'horizontal':
        case 'vertical':
          return { ...slice, orientation: raw };
        default:
          throw new Unsupported(`config orientation=${JSON.stringify(raw)}`);
      }
    case 'dir':
      switch (raw) {
        case 'ltr':
        case 'rtl':
          return { ...slice, dir: raw };
        default:
          throw new Unsupported(`config dir=${JSON.stringify(raw)}`);
      }
    case 'controlled':
      if (typeof raw !== 'boolean') {
        throw new Unsupported(`config controlled=${JSON.stringify(raw)}`);
      }
      return { ...slice, controlled: raw };
    default:
      throw new Unsupported(`config ${key}=${JSON.stringify(raw)}`);
  }
};

/** Scenario `config` -> what both targets are mounted with. */
export const sliderConfig = (config: ScenarioConfig) => {
  const {
    min,
    max,
    step,
    largeStep,
    value,
    orientation,
    dir,
    controlled,
    pinned,
  } = Object.entries(config).reduce(
    (slice: SliderSlice, [key, raw]) => parseSlice(slice, key, raw),
    DEFAULT_SLICE,
  );
  const flavor = VARIANTS.findIndex(
    (variant) =>
      variant.min === min &&
      variant.max === max &&
      variant.step === step &&
      variant.largeStep === largeStep,
  );
  if (flavor < 0) {
    throw new Unsupported(
      `config min=${min} max=${max} step=${step} largeStep=${largeStep}`,
    );
  }
  const start = VARIANTS[flavor]?.value ?? VARIANTS[0].value;
  const resolved = value ?? start;
  const onGrid = (resolved - min) % step === 0;
  if (controlled ? !onGrid : resolved !== start) {
    throw new Unsupported(`config value=${JSON.stringify(resolved)}`);
  }
  if (resolved < min || resolved > max) {
    throw new Unsupported(`config value=${JSON.stringify(resolved)}`);
  }
  return {
    flavor,
    value: resolved,
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
      // remount with the scenario's step/large-step/start variant
      specEvent('configure', { variant: BigInt(mount.flavor) }),
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
    const variant = VARIANTS[Number(state['flavor'])] ?? VARIANTS[0];
    switch (name) {
      case 'role':
        return 'slider';
      case 'aria-valuenow':
        return String(value);
      case 'aria-valuemin':
        return String(variant.min);
      case 'aria-valuemax':
        return String(variant.max);
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
  { event: 'prop', prop: 'setValue', value: 2 },
  { event: 'prop', prop: 'setValue', value: 8 },
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
