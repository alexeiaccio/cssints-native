import type {
  ActionStep,
  ExtendedStepField,
  Probe,
  ScenarioConfig,
  SpecBridge,
} from '../scenario';
import type { QuintEvent, QuintModelValue } from '@eoa/quint-machine';
import type { Schema } from 'effect';
import { Unsupported } from '../scenario';

// The spec's events are `{ _tag }` records by construction (quint-machine's QuintEvent).
// oxlint-disable-next-line automation/no-manual-tagged-construction
const specEvent = (
  tag: string,
  params: Record<string, boolean | string> = {},
): QuintEvent => ({ _tag: tag, ...params });

/** Scenario `config` -> what both targets are mounted with. */
export interface SwitchConfig {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  /** The APG's optional Enter key. */
  readonly enterToggles: boolean;
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
}

const CONFIG_KEYS = new Set([
  'part',
  'disabled',
  'isDisabled',
  'checked',
  'defaultChecked',
  'isSelected',
  'readOnly',
  'isReadOnly',
  'enterToggles',
  'controlled',
]);

/**
 * Switch vocabulary <-> `specs/apg/switch.qnt`. Part: `switch`.
 *
 * `checked` (base-ui) is the controlled value with a host that answers every
 * request (so a click commits, and an outside write lands); `isSelected`
 * (react-aria) is the controlled value with no answer (every request rejected);
 * `defaultChecked` is an uncontrolled seed. Native-input, label and value
 * plumbing config throws `Unsupported`, so scenarios that need it are skipped.
 */
export const switchConfig = (config: ScenarioConfig): SwitchConfig => {
  let checked = false;
  let disabled = false;
  let readOnly = false;
  let enterToggles = false;
  let controlled = false;
  let pinned = false;
  for (const [key, value] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
    switch (key) {
      case 'part':
        if (value !== 'switch') {
          throw new Unsupported(`part ${JSON.stringify(value)}`);
        }
        break;
      case 'disabled':
      case 'isDisabled':
        disabled = value === true;
        break;
      case 'checked':
        checked = value === true;
        controlled = true;
        break;
      case 'isSelected':
        checked = value === true;
        controlled = true;
        pinned = true;
        break;
      case 'defaultChecked':
        checked = value === true;
        break;
      case 'readOnly':
      case 'isReadOnly':
        readOnly = value === true;
        break;
      case 'enterToggles':
        enterToggles = value === true;
        break;
      case 'controlled':
        controlled ||= value === true;
        break;
      default:
        break;
    }
  }
  return {
    checked,
    disabled,
    readOnly,
    enterToggles,
    controlled,
    accepts: controlled && !pinned,
  };
};

/** `onCheckedChange` (base-ui) and `onChange` (react-aria) are the same callback. */
export const canonicalEvent = (name: string): string =>
  name === 'onCheckedChange' ? 'onChange' : name;

const partOf = (target: string | undefined): string => {
  if (target === undefined) {
    throw new Unsupported('step needs a target');
  }
  const part = target.replace(/:0$/, '');
  if (part === 'switch' || part === 'button') {
    return 'switch';
  }
  throw new Unsupported(`part ${part}`);
};

const keyOf = (key: string | undefined): 'Space' | 'Enter' => {
  if (key === ' ' || key === 'Space') {
    return 'Space';
  }
  if (key === 'Enter') {
    return 'Enter';
  }
  throw new Unsupported(`key ${key ?? ''}`);
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'disabled':
    case 'isDisabled':
      return [specEvent('set_disabled', { value: step.value === true })];
    case 'checked':
    case 'isSelected':
      return [
        specEvent('setValue', {
          incoming: step.value === true ? 'true' : 'false',
        }),
      ];
    case 'enterToggles':
      return [specEvent('set_enter_toggles', { value: step.value === true })];
    case 'hostToggle':
      return [specEvent('hostToggle')];
    case 'focus':
      return [specEvent('focus')];
    case 'blur':
      return [specEvent('blur')];
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
    } else if (key === 'checked' || key === 'isSelected') {
      events.push(
        specEvent('setValue', { incoming: value === true ? 'true' : 'false' }),
      );
    } else if (key === 'enterToggles') {
      events.push(specEvent('set_enter_toggles', { value: value === true }));
    } else {
      throw new Unsupported(`set ${key}=${JSON.stringify(value)}`);
    }
  }
  return events;
};

/** The extended step fields this bridge honours. */
const stepFields: ReadonlyArray<ExtendedStepField> = ['set', 'phase'];

export const switchBridge: SpecBridge = {
  setup: (config) => {
    const { checked, disabled, enterToggles, controlled, accepts } =
      switchConfig(config);
    return [
      ...(checked ? [specEvent('seed', { incoming: 'true' })] : []),
      ...(controlled ? [specEvent('control')] : []),
      ...(controlled && accepts ? [specEvent('acceptRequests')] : []),
      ...(enterToggles
        ? [specEvent('set_enter_toggles', { value: true })]
        : []),
      ...(disabled ? [specEvent('set_disabled', { value: true })] : []),
    ];
  },
  event: (step) => {
    switch (step.event) {
      case 'focus':
        partOf(step.target);
        return [specEvent('focus')];
      case 'blur':
        partOf(step.target);
        return [specEvent('blur')];
      case 'click':
        partOf(step.target);
        return [specEvent('pointer_down'), specEvent('pointer_up')];
      case 'key': {
        partOf(step.target);
        if (step.repeat === true) {
          throw new Unsupported('key repeat');
        }
        const key = keyOf(step.key);
        // `phase` walks a half press: keydown Space, blur, keyup Space (bean ci3i)
        if (step.phase === 'up') {
          return [specEvent('key_up', { key })];
        }
        if (step.phase === 'down') {
          return [specEvent('focus'), specEvent('key_down', { key })];
        }
        return [
          specEvent('focus'),
          specEvent('key_down', { key }),
          specEvent('key_up', { key }),
        ];
      }
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
  focus: (state: QuintModelValue) =>
    state['focused'] === true ? 'switch' : null,
  attr: (state: QuintModelValue, target: string, name: string) => {
    partOf(target);
    switch (name) {
      case 'role':
        return 'switch';
      case 'aria-checked':
        return state['checked'] === 'true' ? 'true' : 'false';
      case 'aria-disabled':
        return state['disabled'] === true ? 'true' : null;
      default:
        throw new Unsupported(`attribute ${name} on ${target}`);
    }
  },
  visible: () => [],
  events: (before: QuintModelValue, after: QuintModelValue) =>
    before['requests'] === after['requests']
      ? []
      : [['onChange', after['requested'] === 'true'] as const],
};

/** The user-level steps a differential walk draws from. */
export const switchSteps: ReadonlyArray<ActionStep> = [
  { event: 'focus', target: 'switch' },
  { event: 'blur', target: 'switch' },
  { event: 'click', target: 'switch' },
  { event: 'key', key: ' ', target: 'switch' },
  { event: 'key', key: ' ', phase: 'down', target: 'switch' },
  { event: 'key', key: ' ', phase: 'up', target: 'switch' },
  { event: 'key', key: 'Enter', target: 'switch' },
  { event: 'prop', prop: 'disabled', value: true },
  { event: 'prop', prop: 'disabled', value: false },
  { event: 'prop', prop: 'enterToggles', value: true },
  { event: 'prop', prop: 'enterToggles', value: false },
  { event: 'prop', prop: 'checked', value: true },
  { event: 'prop', prop: 'checked', value: false },
  { event: 'prop', prop: 'hostToggle' },
];

export const switchProbe: Probe = {
  attrs: [
    ['switch', 'role'],
    ['switch', 'aria-checked'],
    ['switch', 'aria-disabled'],
  ],
  events: ['onChange'],
};
