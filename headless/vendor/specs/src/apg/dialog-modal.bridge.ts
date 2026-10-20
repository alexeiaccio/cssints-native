import {
  type ActionStep,
  type Probe,
  type ScenarioConfig,
  type SpecBridge,
  Unsupported,
} from '../scenario';
import type { QuintEvent, QuintModelValue } from '@eoa/quint-machine';

// The spec's events are `{ _tag }` records by construction (quint-machine's QuintEvent).
// oxlint-disable-next-line automation/no-manual-tagged-construction
const specEvent = (
  tag: string,
  params: Record<string, boolean | bigint | string> = {},
): QuintEvent => ({ _tag: tag, ...params });

export interface DialogModalConfig {
  readonly modal: boolean;
  readonly role: 'dialog' | 'alertdialog';
  readonly open: boolean;
  readonly dismissable: boolean;
  readonly keyboardDismissDisabled: boolean;
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back as the value. */
  readonly accepts: boolean;
}

const CONFIG_KEYS = new Set([
  'modal',
  'role',
  'open',
  'defaultOpen',
  'isDismissable',
  'isKeyboardDismissDisabled',
  'controlled',
  'accepts',
  'hideOnEscape',
  'hideOnInteractOutside',
]);

/**
 * Scenario `config` -> what both targets are mounted with. `controlled` puts the
 * open state in a host; the host accepts every request unless `accepts: false`.
 * `open` is the initial / pinned value. ariakit's `hideOnEscape: false` is a
 * rejecting host with Escape ignored; `hideOnInteractOutside: false` makes the
 * backdrop inert.
 */
export const dialogModalConfig = (
  config: ScenarioConfig,
): DialogModalConfig => {
  let modal = true;
  let role: 'dialog' | 'alertdialog' = 'dialog';
  let open = false;
  let dismissable = true;
  let keyboardDismissDisabled = false;
  let controlled = false;
  let accepts = true;
  for (const [key, raw] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(raw)}`);
    }
    if ((key === 'open' || key === 'defaultOpen') && typeof raw === 'boolean') {
      open = raw;
    } else if (key === 'controlled' && typeof raw === 'boolean') {
      controlled ||= raw;
    } else if (key === 'accepts' && typeof raw === 'boolean') {
      accepts = raw;
    } else if (key === 'hideOnEscape' && raw === false) {
      // ariakit: the dialog ignores Escape entirely, so the host never commits
      controlled = true;
      accepts = false;
      keyboardDismissDisabled = true;
    } else if (key === 'hideOnInteractOutside' && raw === false) {
      dismissable = false;
    } else if (key === 'modal' && typeof raw === 'boolean') {
      if (!raw) {
        throw new Unsupported('config modal=false');
      }
      modal = raw;
    } else if (key === 'role' && (raw === 'dialog' || raw === 'alertdialog')) {
      role = raw;
    } else if (key === 'isDismissable' && typeof raw === 'boolean') {
      dismissable = raw;
    } else if (
      key === 'isKeyboardDismissDisabled' &&
      typeof raw === 'boolean'
    ) {
      keyboardDismissDisabled = raw;
    } else {
      throw new Unsupported(`config ${key}=${JSON.stringify(raw)}`);
    }
  }
  return {
    modal,
    role,
    open,
    dismissable,
    keyboardDismissDisabled,
    controlled,
    accepts: controlled && accepts,
  };
};

const PARTS = new Set([
  'trigger',
  'dialog',
  'dismiss',
  'button',
  'outside',
  'backdrop',
]);

const part = (target: string | undefined): string => {
  const name = (target ?? '').replace(/:0$/, '');
  if (!PARTS.has(name)) {
    throw new Unsupported(`part ${name}`);
  }
  return name;
};

const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Space']);

/**
 * Dialog (Modal) vocabulary <-> `specs/apg/dialog-modal.qnt`. The spec models a
 * four-dialog stack with a fixed page; this bridge only maps the single-dialog
 * open/close behaviour the ported scenarios share. `open` lands on the spec's
 * page invoker (position 1); `dismiss` and Escape on its top-dialog Escape;
 * a click on the inert content is the spec's no-op `pointer_outside`.
 *
 * `controlled` puts the open state in a host; `setValue` / `hostToggle` are the
 * host writing it (inert while uncontrolled).
 */
export const dialogModalBridge: SpecBridge = {
  setup: (config) => {
    const { open, controlled, accepts } = dialogModalConfig(config);
    if (controlled) {
      return [
        specEvent('control'),
        ...(accepts ? [specEvent('acceptRequests')] : []),
        ...(open ? [specEvent('setValue', { v: true })] : []),
      ];
    }
    return open
      ? [specEvent('focus_attempt', { target: 1n }), specEvent('activate')]
      : [];
  },
  event: (step: ActionStep) => {
    switch (step.event) {
      case 'click': {
        const name = part(step.target);
        if (name === 'outside' || name === 'backdrop') {
          return [specEvent('pointer_outside')];
        }
        if (name === 'dismiss') {
          return [specEvent('escape')];
        }
        return [
          specEvent('focus_attempt', { target: 1n }),
          specEvent('activate'),
        ];
      }
      case 'key': {
        const name = part(step.target);
        if (step.key === 'Escape') {
          return [specEvent('escape')];
        }
        if (name === 'trigger' && ACTIVATION_KEYS.has(step.key ?? '')) {
          return [
            specEvent('focus_attempt', { target: 1n }),
            specEvent('activate'),
          ];
        }
        if (name !== 'trigger' && ACTIVATION_KEYS.has(step.key ?? '')) {
          return [specEvent('escape')];
        }
        throw new Unsupported(`key ${step.key ?? ''}`);
      }
      case 'focus': {
        const name = part(step.target);
        return name === 'trigger'
          ? [specEvent('focus_attempt', { target: 1n })]
          : [];
      }
      case 'blur':
      case 'hover':
      case 'unhover':
        return [];
      case 'prop':
        switch (step.prop) {
          case 'pressEnter':
          case 'pressSpace':
            return [
              specEvent('focus_attempt', { target: 1n }),
              specEvent('activate'),
            ];
          case 'escape':
            return [specEvent('escape')];
          case 'setValue':
            return [specEvent('setValue', { v: step.value === true })];
          case 'hostToggle':
            return [specEvent('hostToggle')];
          default:
            throw new Unsupported(`prop ${step.prop ?? ''}`);
        }
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  value: (state: QuintModelValue) => Number(state['depth']) > 0,
  focus: () => {
    throw new Unsupported(
      'the reference model encodes focus as an example-specific target',
    );
  },
  attr: (state: QuintModelValue, target: string, name: string) => {
    if (part(target) === 'dialog') {
      if (name === 'role') {
        return 'dialog';
      }
      if (name === 'aria-modal') {
        return Number(state['depth']) > 0 ? 'true' : null;
      }
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state: QuintModelValue) =>
    Number(state['depth']) > 0 ? ['dialog'] : [],
  events: (before, after) =>
    before['requests'] === after['requests']
      ? []
      : [['onOpenChange', after['requested'] === true] as const],
};

/** The user-level steps a differential walk draws from. */
export const dialogModalSteps: ReadonlyArray<ActionStep> = [
  { event: 'click', target: 'trigger' },
  { event: 'click', target: 'dismiss' },
  { event: 'prop', prop: 'pressEnter' },
  { event: 'prop', prop: 'pressSpace' },
  { event: 'prop', prop: 'escape' },
  { event: 'prop', prop: 'setValue', value: true },
  { event: 'prop', prop: 'setValue', value: false },
  { event: 'prop', prop: 'hostToggle' },
];

export const dialogModalProbe: Probe = {
  attrs: [
    ['dialog', 'role'],
    ['dialog', 'aria-modal'],
  ],
  events: ['onOpenChange'],
};
