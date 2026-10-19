import {
  type ActionStep,
  type ExtendedStepField,
  type Probe,
  type ScenarioConfig,
  type SpecBridge,
  Unsupported,
} from '../scenario';
import type { QuintEvent } from '@eoa/quint-machine';
import type { Schema } from 'effect';

// The spec's events are `{ _tag }` records by construction (quint-machine's QuintEvent).
// oxlint-disable-next-line automation/no-manual-tagged-construction
const specEvent = (
  tag: string,
  params: Record<string, bigint | string | boolean> = {},
): QuintEvent => ({ _tag: tag, ...params });

/**
 * Scenario `config` -> what both targets are mounted with. `toggle` (or a
 * `pressed`/`defaultPressed` value) makes it a toggle button; `disabled` uses
 * `aria-disabled` (the button stays focusable, per the APG text).
 *
 * `pressed` (base-ui) and `isSelected` (react-aria) are the controlled value
 * with a host that answers every request (a click commits, an outside write
 * lands); `defaultPressed` is an uncontrolled seed; `value` pins the value so
 * every request is rejected.
 */
export interface ButtonConfig {
  readonly toggle: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
}

const NEUTRAL_KEYS = new Set(['part', 'type', 'nativeButton']);

export const buttonConfig = (config: ScenarioConfig): ButtonConfig => {
  let toggle = false;
  let pressed = false;
  let disabled = false;
  let controlled = false;
  let pinned = false;
  for (const [key, value] of Object.entries(config)) {
    if (key === 'toggle' || key === 'isToggle') {
      toggle = value === true;
    } else if (key === 'pressed' || key === 'isSelected') {
      pressed = value === true;
      toggle = true;
      controlled = true;
    } else if (key === 'defaultPressed') {
      pressed = value === true;
      toggle = true;
    } else if (key === 'value' && typeof value === 'boolean') {
      pressed = value;
      toggle = true;
      controlled = true;
      pinned = true;
    } else if (key === 'disabled' || key === 'isDisabled') {
      disabled = value === true;
    } else if (key === 'controlled') {
      controlled ||= value === true;
    } else if (!NEUTRAL_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
  }
  return {
    toggle,
    pressed,
    disabled,
    controlled,
    accepts: controlled && !pinned,
  };
};

const partOf = (target: string | undefined): string =>
  (target ?? 'button').replace(/:0$/, '');

/** react-aria calls the toggle callback `onChange`; base-ui `onPressedChange`. */
export const canonicalEvent = (name: string): string =>
  name === 'onChange' ? 'onPressedChange' : name;

const keyTag = (key: string | undefined): string | undefined => {
  switch (key) {
    case 'Enter':
      return 'Enter';
    case ' ':
    case 'Space':
      return 'Space';
    default:
      return undefined;
  }
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'disabled':
    case 'isDisabled':
      return [specEvent('set_disabled', { value: step.value === true })];
    case 'toggle':
    case 'isToggle':
      return [specEvent('set_toggle', { value: step.value === true })];
    case 'pressed':
    case 'isSelected':
    case 'value':
      return [specEvent('setValue', { v: step.value === true })];
    case 'hostToggle':
      return [specEvent('hostToggle')];
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

const setEvents = (
  set: Readonly<Record<string, Schema.Json>>,
): ReadonlyArray<QuintEvent> => {
  const events: QuintEvent[] = [];
  for (const [key, value] of Object.entries(set)) {
    if (key === 'disabled' || key === 'isDisabled') {
      events.push(specEvent('set_disabled', { value: value === true }));
    } else if (key === 'toggle' || key === 'isToggle') {
      events.push(specEvent('set_toggle', { value: value === true }));
    } else if (key === 'pressed' || key === 'isSelected' || key === 'value') {
      events.push(specEvent('setValue', { v: value === true }));
    } else {
      throw new Unsupported(`set ${key}=${JSON.stringify(value)}`);
    }
  }
  return events;
};

/** The extended step fields this bridge honours. */
const stepFields: ReadonlyArray<ExtendedStepField> = ['set', 'phase'];

/**
 * Button vocabulary <-> `specs/apg/button.qnt`. Parts: `button`. `click` is a
 * pointer down + up; `key` focuses first (as a user would) then presses. The
 * spec's `set_disabled`/`set_toggle` take the new value, so an absolute `set`
 * step maps directly. A toggle's activation is a request the host may ignore;
 * `setValue` is the host writing the controlled value.
 */
export const buttonBridge: SpecBridge = {
  setup: (config) => {
    const { toggle, pressed, disabled, controlled, accepts } =
      buttonConfig(config);
    return [
      ...(toggle ? [specEvent('set_toggle', { value: true })] : []),
      ...(toggle && pressed ? [specEvent('seed', { v: true })] : []),
      ...(controlled ? [specEvent('control')] : []),
      ...(controlled && accepts ? [specEvent('acceptRequests')] : []),
      ...(disabled ? [specEvent('set_disabled', { value: true })] : []),
    ];
  },
  event: (step: ActionStep) => {
    switch (step.event) {
      case 'focus':
        if (partOf(step.target) !== 'button') {
          throw new Unsupported(`focus on ${step.target ?? ''}`);
        }
        return [specEvent('focus')];
      case 'blur':
        return [specEvent('blur')];
      case 'click':
        if (partOf(step.target) !== 'button') {
          throw new Unsupported(`click on ${step.target ?? ''}`);
        }
        return [specEvent('pointer_down'), specEvent('pointer_up')];
      case 'pointerdown':
        return [specEvent('pointer_down')];
      case 'pointerup':
        return [specEvent('pointer_up')];
      case 'pointercancel':
        return [specEvent('pointer_cancel')];
      case 'key': {
        if (partOf(step.target) !== 'button') {
          throw new Unsupported(`key on ${step.target ?? ''}`);
        }
        const tag = keyTag(step.key);
        if (tag === undefined) {
          throw new Unsupported(`key ${step.key ?? ''}`);
        }
        // `phase` walks a half press: keydown Space, blur, keyup Space (bean ci3i)
        if (step.phase === 'up') {
          return [specEvent('key_up', { key: tag })];
        }
        if (step.phase === 'down') {
          return [specEvent('focus'), specEvent('key_down', { key: tag })];
        }
        return [
          specEvent('focus'),
          specEvent('key_down', { key: tag }),
          specEvent('key_up', { key: tag }),
        ];
      }
      case 'hover':
      case 'unhover':
        return [];
      case 'prop':
        return step.set === undefined
          ? programmatic(step)
          : setEvents(step.set);
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  stepFields,
  eventName: canonicalEvent,
  focus: (state) => (state['focused'] === true ? 'button' : null),
  attr: (state, target, name) => {
    if (partOf(target) !== 'button') {
      throw new Unsupported(`attribute ${name} on ${target}`);
    }
    if (name === 'role') {
      return 'button';
    }
    if (name === 'aria-pressed') {
      if (state['isToggle'] !== true) {
        return null;
      }
      return state['pressed'] === true ? 'true' : 'false';
    }
    if (name === 'aria-disabled') {
      return state['disabled'] === true ? 'true' : null;
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: () => [],
  events: (before, after) =>
    before['requests'] === after['requests']
      ? []
      : [['onPressedChange', after['requested'] === true] as const],
};

/** The user-level steps a differential walk draws from. */
export const buttonSteps: ReadonlyArray<ActionStep> = [
  { event: 'focus', target: 'button' },
  { event: 'blur', target: 'button' },
  { event: 'click', target: 'button' },
  { event: 'key', key: 'Enter', target: 'button' },
  { event: 'key', key: ' ', target: 'button' },
  // the halves of a Space press, so keydown -> blur -> keyup is walked
  { event: 'key', key: ' ', phase: 'down', target: 'button' },
  { event: 'key', key: ' ', phase: 'up', target: 'button' },
  { event: 'prop', prop: 'disabled', value: true },
  { event: 'prop', prop: 'disabled', value: false },
  { event: 'prop', prop: 'pressed', value: true },
  { event: 'prop', prop: 'pressed', value: false },
  { event: 'prop', prop: 'hostToggle' },
];

export const buttonProbe: Probe = {
  attrs: [
    ['button', 'role'],
    ['button', 'aria-pressed'],
    ['button', 'aria-disabled'],
  ],
  events: ['onPressedChange'],
};
