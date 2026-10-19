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
  params: Record<string, boolean> = {},
): QuintEvent => ({ _tag: tag, ...params });

/**
 * Disclosure vocabulary <-> `specs/apg/disclosure.qnt`, shared by the spec
 * driver and the DOM driver so both gate scenarios identically.
 *
 * Parts: `trigger` (role=button) and `panel`; `button` / `content` fold onto
 * them. `trigger:1` is the host's own outside button: it writes the controlled
 * value (`hostToggle`), it is not a trigger. Anything else (groups, nesting,
 * `beforematch`, ...) throws `Unsupported`, which skips the scenario on every
 * target.
 */
const partOf = (target: string | undefined): 'trigger' | 'panel' => {
  const part = (target ?? 'trigger').replace(/:0$/, '');
  if (part === 'trigger' || part === 'button') {
    return 'trigger';
  }
  if (part === 'panel' || part === 'content' || part === 'region') {
    return 'panel';
  }
  throw new Unsupported(`part ${part}`);
};

export interface DisclosureConfig {
  /** `defaultValue` when uncontrolled, the initial `value` prop when controlled. */
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
}

const OPEN_KEYS = new Set(['initialOpen', 'defaultOpen', 'defaultExpanded']);
// no effect on a primitive whose panel is always mounted and has no pointer sniffing
const NEUTRAL_KEYS = new Set(['component', 'pointerType', 'keepMounted']);
const HOOKS = new Set(['useDisclosure', 'useDisclosureState']);

/**
 * Scenario `config` -> what both targets are mounted with. `controlled` puts the
 * value in a host; the host accepts every request (a page that keeps the state
 * in a signal) unless the scenario pins the value with `expanded` (react-aria's
 * `isExpanded`: a fixed prop, so every request is rejected). `expanded` alone
 * also means controlled.
 */
export const disclosureConfig = (config: ScenarioConfig): DisclosureConfig => {
  let expanded = false;
  let disabled = false;
  let controlled = false;
  let pinned = false;
  for (const [key, value] of Object.entries(config)) {
    if (OPEN_KEYS.has(key) && typeof value === 'boolean') {
      expanded ||= value;
    } else if (key === 'expanded' && typeof value === 'boolean') {
      expanded = value;
      controlled = true;
      pinned = true;
    } else if (key === 'controlled' && typeof value === 'boolean') {
      controlled ||= value;
    } else if (key === 'disabled' && typeof value === 'boolean') {
      disabled = value;
    } else if (
      NEUTRAL_KEYS.has(key) &&
      (key !== 'component' || (typeof value === 'string' && HOOKS.has(value)))
    ) {
      continue;
    } else if (key === 'nativeButton' && value === true) {
      continue;
    } else {
      throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
  }
  return { expanded, disabled, controlled, accepts: controlled && !pinned };
};

/** Callback names differ per library; scenarios call the primitive's `onValueChange` `onExpandedChange`. */
export const canonicalEvent = (name: string): string =>
  name === 'onOpenChange' ? 'onExpandedChange' : name;

const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Space']);

const onTrigger = (step: ActionStep): void => {
  if (partOf(step.target) !== 'trigger') {
    throw new Unsupported(`${step.event} on ${step.target ?? 'panel'}`);
  }
};

const programmatic = (
  prop: string | undefined,
  value: Schema.Json | undefined,
): ReadonlyArray<QuintEvent> => {
  switch (prop) {
    case 'disabled':
    case 'isDisabled':
      return [specEvent(value === true ? 'disable' : 'enable')];
    case 'expand':
    case 'collapse':
    case 'toggle':
    case 'hostToggle':
      return [specEvent(prop)];
    case 'isExpanded':
      return [specEvent('setValue', { v: value === true })];
    default:
      throw new Unsupported(`prop ${prop ?? ''}`);
  }
};

export const disclosureBridge: SpecBridge = {
  setup: (config) => {
    const { expanded, disabled, controlled, accepts } =
      disclosureConfig(config);
    return [
      ...(controlled
        ? [
            specEvent('control'),
            ...(accepts ? [specEvent('acceptRequests')] : []),
            ...(expanded ? [specEvent('setValue', { v: true })] : []),
          ]
        : expanded
          ? [specEvent('expand')]
          : []),
      ...(disabled ? [specEvent('disable')] : []),
    ];
  },
  event: (step) => {
    switch (step.event) {
      case 'focus':
        onTrigger(step);
        return [specEvent('focusTrigger')];
      case 'blur':
        onTrigger(step);
        return [specEvent('blurTrigger')];
      case 'click':
        if (step.target === 'trigger:1') {
          return [specEvent('hostToggle')];
        }
        onTrigger(step);
        return [specEvent('click')];
      case 'key':
        onTrigger(step);
        if (
          step.repeat !== true &&
          step.key !== undefined &&
          ACTIVATION_KEYS.has(step.key)
        ) {
          return [specEvent('focusTrigger'), specEvent('press')];
        }
        throw new Unsupported(
          `key ${step.key ?? ''}${step.repeat === true ? ' (repeat)' : ''}`,
        );
      case 'hover':
      case 'unhover':
        return [];
      case 'prop':
        return programmatic(step.prop, step.value);
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  eventName: canonicalEvent,
  value: (state) => ({ isExpanded: state['expanded'] === true }),
  focus: (state) => {
    if (state['focus'] === 'unknown') {
      throw new Unsupported(
        'focus after disabling a focused trigger is browser-defined',
      );
    }
    return state['focus'] === 'trigger' ? 'trigger' : null;
  },
  attr: (state, target, name) => {
    if (partOf(target) === 'trigger') {
      if (name === 'aria-expanded') {
        return String(state['ariaExpanded']);
      }
      if (name === 'disabled') {
        return state['disabled'] === true ? 'true' : null;
      }
    } else if (name === 'hidden') {
      return state['panelHidden'] === true ? 'true' : null;
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state) => (state['panelHidden'] === true ? [] : ['panel']),
  events: (before: QuintModelValue, after: QuintModelValue) =>
    before['requests'] === after['requests']
      ? []
      : [['onExpandedChange', after['requested'] === true] as const],
};

/** The user-level steps a differential walk draws from. */
export const disclosureSteps: ReadonlyArray<ActionStep> = [
  { event: 'focus', target: 'trigger' },
  { event: 'blur', target: 'trigger' },
  { event: 'click', target: 'trigger' },
  { event: 'key', key: 'Enter', target: 'trigger' },
  { event: 'key', key: ' ', target: 'trigger' },
  { event: 'prop', prop: 'disabled', value: true },
  { event: 'prop', prop: 'disabled', value: false },
  { event: 'prop', prop: 'expand' },
  { event: 'prop', prop: 'collapse' },
  { event: 'prop', prop: 'toggle' },
  { event: 'prop', prop: 'isExpanded', value: true },
  { event: 'prop', prop: 'isExpanded', value: false },
  { event: 'prop', prop: 'hostToggle' },
];

export const disclosureProbe: Probe = {
  attrs: [
    ['trigger', 'aria-expanded'],
    ['trigger', 'disabled'],
    ['panel', 'hidden'],
  ],
  events: ['onExpandedChange'],
};
