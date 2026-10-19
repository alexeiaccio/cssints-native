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

/**
 * Scenario `config` -> what both targets are mounted with. `checked` (base-ui)
 * is the controlled value with a host that answers every request (a click
 * commits, an outside write lands); `isSelected` (react-aria) and a boolean
 * `value` pin the value so every request is rejected; `defaultChecked` is an
 * uncontrolled seed. `indeterminate`/`allowMixed` switch on the tri-state
 * display, `mixed` becoming the initial value.
 */
export interface CheckboxConfig {
  /** Initial checkbox state; `mixed` only when `allowMixed`. */
  readonly state: 'true' | 'false' | 'mixed';
  readonly allowMixed: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
}

const CONFIG_KEYS = new Set([
  'part',
  'disabled',
  'isDisabled',
  'allowMixed',
  'indeterminate',
  'isIndeterminate',
  'checked',
  'defaultChecked',
  'isSelected',
  'readOnly',
  'isReadOnly',
  'controlled',
  'value',
]);

/**
 * Checkbox vocabulary <-> `specs/apg/checkbox.qnt`, shared by the spec driver
 * and the DOM driver. Parts: `checkbox` only; `button` folds onto it. Config the
 * spec does not model (groups, native inputs, value plumbing, `role`
 * overrides, ...) throws `Unsupported`, skipping the scenario on every target.
 */
export const checkboxConfig = (config: ScenarioConfig): CheckboxConfig => {
  let checked = false;
  let mixed = false;
  let allowMixed = false;
  let disabled = false;
  let readOnly = false;
  let controlled = false;
  let pinned = false;
  for (const [key, value] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
    switch (key) {
      case 'part':
        if (value !== 'checkbox') {
          throw new Unsupported(`part ${JSON.stringify(value)}`);
        }
        break;
      case 'disabled':
      case 'isDisabled':
        disabled = value === true;
        break;
      case 'allowMixed':
        allowMixed = value === true;
        break;
      case 'indeterminate':
      case 'isIndeterminate':
        allowMixed = true;
        mixed = value === true;
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
      case 'value':
        if (typeof value === 'boolean') {
          checked = value;
          controlled = true;
          pinned = true;
        }
        break;
      case 'readOnly':
      case 'isReadOnly':
        readOnly = value === true;
        break;
      case 'controlled':
        controlled ||= value === true;
        break;
      default:
        break;
    }
  }
  return {
    state: mixed ? 'mixed' : checked ? 'true' : 'false',
    allowMixed: allowMixed || mixed,
    disabled,
    readOnly,
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
  if (part === 'checkbox' || part === 'button') {
    return 'checkbox';
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
    case 'allowMixed':
    case 'indeterminate':
    case 'isIndeterminate':
      return [specEvent('set_allow_mixed', { value: step.value === true })];
    case 'checked':
    case 'isSelected':
    case 'value':
      return [
        specEvent('setValue', {
          incoming: step.value === true ? 'true' : 'false',
        }),
      ];
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
    } else if (
      key === 'allowMixed' ||
      key === 'indeterminate' ||
      key === 'isIndeterminate'
    ) {
      events.push(specEvent('set_allow_mixed', { value: value === true }));
    } else if (key === 'checked' || key === 'isSelected' || key === 'value') {
      events.push(
        specEvent('setValue', { incoming: value === true ? 'true' : 'false' }),
      );
    } else {
      throw new Unsupported(`set ${key}=${JSON.stringify(value)}`);
    }
  }
  return events;
};

/** The extended step fields this bridge honours. */
const stepFields: ReadonlyArray<ExtendedStepField> = ['set', 'phase'];

export const checkboxBridge: SpecBridge = {
  setup: (config) => {
    const { state, allowMixed, disabled, controlled, accepts } =
      checkboxConfig(config);
    return [
      ...(allowMixed ? [specEvent('set_allow_mixed', { value: true })] : []),
      ...(state === 'false' ? [] : [specEvent('seed', { incoming: state })]),
      ...(controlled ? [specEvent('control')] : []),
      ...(controlled && accepts ? [specEvent('acceptRequests')] : []),
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
    state['focused'] === true ? 'checkbox' : null,
  attr: (state: QuintModelValue, target: string, name: string) => {
    partOf(target);
    switch (name) {
      case 'role':
        return 'checkbox';
      case 'aria-checked': {
        const value = state['state'];
        if (value === 'true') {
          return 'true';
        }
        return value === 'mixed' && state['allowMixed'] === true
          ? 'mixed'
          : 'false';
      }
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
export const checkboxSteps: ReadonlyArray<ActionStep> = [
  { event: 'focus', target: 'checkbox' },
  { event: 'blur', target: 'checkbox' },
  { event: 'click', target: 'checkbox' },
  { event: 'key', key: ' ', target: 'checkbox' },
  { event: 'key', key: ' ', phase: 'down', target: 'checkbox' },
  { event: 'key', key: ' ', phase: 'up', target: 'checkbox' },
  { event: 'key', key: 'Enter', target: 'checkbox' },
  { event: 'prop', prop: 'disabled', value: true },
  { event: 'prop', prop: 'disabled', value: false },
  { event: 'prop', prop: 'checked', value: true },
  { event: 'prop', prop: 'checked', value: false },
  { event: 'prop', prop: 'hostToggle' },
];

export const checkboxProbe: Probe = {
  attrs: [
    ['checkbox', 'role'],
    ['checkbox', 'aria-checked'],
    ['checkbox', 'aria-disabled'],
  ],
  events: ['onChange'],
};
