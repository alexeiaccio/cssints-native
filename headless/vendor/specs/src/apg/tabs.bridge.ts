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

/** The generator models four tab slots as a bit mask (`present` is always 15). */
const TABS = 4;

/** Disabled masks the packed `configure` variant can produce (see the spec). */
const DISABLED_MASKS = [0, 1, 2, 5, 14] as const;

type Part = { readonly kind: 'tablist' | 'tab' | 'tabpanel'; index: number };

const partOf = (target: string | undefined): Part => {
  const [name = 'tab', indexText] = (target ?? 'tab').split(':');
  const index = Number(indexText ?? '0');
  if (name === 'tablist') {
    return { kind: 'tablist', index: 0 };
  }
  if (name === 'tab') {
    return { kind: 'tab', index };
  }
  if (name === 'tabpanel') {
    return { kind: 'tabpanel', index };
  }
  throw new Unsupported(`part ${name}`);
};

export interface TabsConfig {
  readonly items: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly activation: 'automatic' | 'manual';
  readonly deletable: boolean;
  /** Bit mask of disabled tabs (only `configure`-reachable masks). */
  readonly disabled: number;
  /** Initial selection (uncontrolled) or the accepting host's starting value. */
  readonly selected: number;
  /** The host owns the selection (`value` prop present). */
  readonly controlled: boolean;
  /** Controlled only: the host writes every request's intent back. */
  readonly accepts: boolean;
  /** Controlled only: a pinned value the host holds (rejects every request). */
  readonly pinned: number | null;
}

const maskOf = (disabled: ReadonlyArray<number>): number =>
  disabled.reduce((mask, index) => mask | (1 << index), 0);

const isDisabled = (mask: number, index: number): boolean =>
  ((mask >> index) & 1) === 1;

const firstEnabled = (mask: number): number => {
  for (let index = 0; index < TABS; index += 1) {
    if (!isDisabled(mask, index)) {
      return index;
    }
  }
  return 0;
};

/**
 * Scenario `config` -> what both targets are mounted with. The spec models a
 * fixed four-tab tablist: RTL (`direction`), non-wrapping (`loopFocus`), forced
 * mount, programmatic labels and tab counts beyond four are not modelled and
 * make the scenario `Unsupported`.
 */
export const tabsConfig = (config: ScenarioConfig): TabsConfig => {
  let items = TABS;
  let orientation: 'horizontal' | 'vertical' = 'horizontal';
  let activation: 'automatic' | 'manual' = 'automatic';
  let deletable = false;
  let mask = 0;
  let explicitSelected: number | undefined;
  let controlled = false;
  let pinned: number | null = null;
  for (const [key, value] of Object.entries(config)) {
    if (key === 'items') {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > TABS
      ) {
        throw new Unsupported(`config items=${JSON.stringify(value)}`);
      }
      items = value;
    } else if (key === 'orientation') {
      if (value !== 'horizontal' && value !== 'vertical') {
        throw new Unsupported(`config orientation=${JSON.stringify(value)}`);
      }
      orientation = value;
    } else if (key === 'activation') {
      if (value !== 'automatic' && value !== 'manual') {
        throw new Unsupported(`config activation=${JSON.stringify(value)}`);
      }
      activation = value;
    } else if (key === 'deletable') {
      if (typeof value !== 'boolean') {
        throw new Unsupported(`config deletable=${JSON.stringify(value)}`);
      }
      deletable = value;
    } else if (key === 'disabled') {
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'number')
      ) {
        throw new Unsupported(`config disabled=${JSON.stringify(value)}`);
      }
      mask = maskOf(value as ReadonlyArray<number>);
    } else if (key === 'selected') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Unsupported(`config selected=${JSON.stringify(value)}`);
      }
      explicitSelected = value;
    } else if (key === 'controlled') {
      if (typeof value !== 'boolean') {
        throw new Unsupported(`config controlled=${JSON.stringify(value)}`);
      }
      controlled ||= value;
    } else if (key === 'value') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Unsupported(`config value=${JSON.stringify(value)}`);
      }
      pinned = value;
      controlled = true;
    } else {
      throw new Unsupported(`config ${key}=${JSON.stringify(value)}`);
    }
  }
  if (!DISABLED_MASKS.includes(mask as (typeof DISABLED_MASKS)[number])) {
    throw new Unsupported(`disabled mask ${mask}`);
  }
  const selected = explicitSelected ?? firstEnabled(mask);
  if (selected < 0 || selected >= items || isDisabled(mask, selected)) {
    throw new Unsupported(`selected ${selected} cannot be selected`);
  }
  if (
    pinned !== null &&
    (pinned < 0 || pinned >= items || isDisabled(mask, pinned))
  ) {
    throw new Unsupported(`value ${pinned} cannot be selected`);
  }
  return {
    items,
    orientation,
    activation,
    deletable,
    disabled: mask,
    selected,
    controlled,
    accepts: controlled && pinned === null,
    pinned,
  };
};

const variantOrientation = (orientation: 'horizontal' | 'vertical'): number =>
  orientation === 'horizontal' ? 0 : 1;

const variantActivation = (activation: 'automatic' | 'manual'): number =>
  activation === 'automatic' ? 0 : 1;

const variantDisabledTier = (mask: number): number =>
  DISABLED_MASKS.indexOf(mask as (typeof DISABLED_MASKS)[number]);

const flavorOf = (config: TabsConfig): number =>
  variantActivation(config.activation) +
  2 * variantOrientation(config.orientation) +
  4 * (config.deletable ? 1 : 0) +
  8 * variantDisabledTier(config.disabled);

const NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Enter',
  ' ',
  'Space',
  'Delete',
]);

const navKey = (key: string | undefined): string => {
  if (key === undefined || !NAV_KEYS.has(key)) {
    throw new Unsupported(`key ${key ?? ''}`);
  }
  return key === 'Space' ? ' ' : key;
};

const programmatic = (step: ActionStep): ReadonlyArray<QuintEvent> => {
  switch (step.prop) {
    case 'selectedKey':
    case 'selected': {
      const index = typeof step.value === 'number' ? step.value : -1;
      if (!Number.isInteger(index) || index < 0 || index >= TABS) {
        throw new Unsupported(`selectedKey ${JSON.stringify(step.value)}`);
      }
      return [specEvent('click', { tab: BigInt(index) })];
    }
    case 'setValue': {
      const index = typeof step.value === 'number' ? step.value : -1;
      if (!Number.isInteger(index) || index < 0 || index >= TABS) {
        throw new Unsupported(`setValue ${JSON.stringify(step.value)}`);
      }
      return [specEvent('setValue', { v: BigInt(index) })];
    }
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

/** Callback names differ per library; the primitive fires `onSelectionChange`. */
export const tabsEventName = (name: string): string =>
  name === 'onValueChange' ? 'onSelectionChange' : name;

/**
 * Tabs vocabulary <-> `specs/apg/tabs.qnt`, shared by the spec driver and the
 * DOM driver so both gate scenarios identically. Parts: `tablist`, `tab:i`,
 * `tabpanel:i`.
 *
 * The spec has no "focus a tab without selecting" event (focus is the
 * keyboard/pointer driven `zone`), so a `focus` step is a no-op here; a
 * differential walk enters the tablist with `click`.
 */
export const tabsBridge: SpecBridge = {
  setup: (config) => {
    const tabs = tabsConfig(config);
    const events: QuintEvent[] = [
      specEvent('configure', { flavor: BigInt(flavorOf(tabs)) }),
    ];
    const first = firstEnabled(tabs.disabled);
    if (tabs.controlled) {
      events.push(specEvent('control'));
      const initial = tabs.pinned ?? tabs.selected;
      if (initial !== first) {
        events.push(specEvent('setValue', { v: BigInt(initial) }));
      }
      if (tabs.accepts) {
        events.push(specEvent('acceptRequests'));
      }
      return events;
    }
    if (tabs.selected !== first) {
      events.push(
        specEvent('click', { tab: BigInt(tabs.selected) }),
        specEvent('tab_key', { shift: false }),
        specEvent('tab_key', { shift: false }),
      );
    }
    return events;
  },
  event: (step) => {
    if (step.event === 'focus' || step.event === 'blur') {
      return [];
    }
    switch (step.event) {
      case 'click': {
        if (step.value !== undefined) {
          throw new Unsupported(
            `click with value ${JSON.stringify(step.value)}`,
          );
        }
        const { kind, index } = partOf(step.target);
        if (kind !== 'tab') {
          throw new Unsupported(`click on ${step.target ?? ''}`);
        }
        return [specEvent('click', { tab: BigInt(index) })];
      }
      case 'key': {
        if (step.value !== undefined) {
          throw new Unsupported(`key with value ${JSON.stringify(step.value)}`);
        }
        if (step.key === 'Tab') {
          return [specEvent('tab_key', { shift: false })];
        }
        if (step.key === 'Shift+Tab') {
          return [specEvent('tab_key', { shift: true })];
        }
        return [specEvent('press', { key: navKey(step.key) })];
      }
      case 'hover':
      case 'unhover':
        return [];
      case 'prop':
        return programmatic(step);
      default:
        throw new Unsupported(`event ${step.event}`);
    }
  },
  focus: (state: QuintModelValue) => {
    const zone = state['zone'];
    if (zone === 'tablist') {
      return `tab:${state['focused']}`;
    }
    if (zone === 'panel') {
      return `tabpanel:${state['selected']}`;
    }
    return null;
  },
  attr: (state: QuintModelValue, target, name) => {
    const { kind, index } = partOf(target);
    const selected = Number(state['selected']);
    const mask = Number(state['disabled']);
    if (kind === 'tablist') {
      if (name === 'aria-orientation') {
        return state['orientation'] === 'vertical' ? 'vertical' : null;
      }
    } else if (kind === 'tab') {
      if (name === 'aria-selected') {
        return selected === index ? 'true' : 'false';
      }
      if (name === 'tabindex') {
        return selected === index ? '0' : '-1';
      }
      if (name === 'aria-controls') {
        return `tabpanel:${index}`;
      }
      if (name === 'aria-disabled') {
        return isDisabled(mask, index) ? 'true' : null;
      }
    } else if (kind === 'tabpanel') {
      if (name === 'aria-labelledby') {
        return `tab:${index}`;
      }
      if (name === 'hidden') {
        return selected === index ? null : 'true';
      }
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state) => [`tabpanel:${state['selected']}`],
  eventName: tabsEventName,
  events: (before: QuintModelValue, after: QuintModelValue) =>
    before['requests'] === after['requests']
      ? []
      : [['onSelectionChange', `tab:${after['requested']}`] as const],
};

/** The user-level steps a differential walk draws from. */
export const tabsSteps: ReadonlyArray<ActionStep> = [
  { event: 'click', target: 'tab:0' },
  { event: 'click', target: 'tab:1' },
  { event: 'click', target: 'tab:2' },
  { event: 'click', target: 'tab:3' },
  { event: 'key', key: 'ArrowRight', target: 'tab:0' },
  { event: 'key', key: 'ArrowLeft', target: 'tab:0' },
  // one alphabet serves both orientations: the off-axis arrows are inert
  { event: 'key', key: 'ArrowDown', target: 'tab:0' },
  { event: 'key', key: 'ArrowUp', target: 'tab:0' },
  { event: 'key', key: 'Home', target: 'tab:0' },
  { event: 'key', key: 'End', target: 'tab:0' },
  { event: 'key', key: 'Enter', target: 'tab:0' },
  { event: 'key', key: ' ', target: 'tab:0' },
  { event: 'prop', prop: 'setValue', value: 2 },
  { event: 'prop', prop: 'setValue', value: 0 },
];

export const tabsProbe: Probe = {
  attrs: [
    ['tablist', 'aria-orientation'],
    ['tab:0', 'aria-selected'],
    ['tab:1', 'aria-selected'],
    ['tab:2', 'aria-selected'],
    ['tab:3', 'aria-selected'],
    ['tab:0', 'tabindex'],
    ['tab:1', 'tabindex'],
    ['tab:2', 'tabindex'],
    ['tab:3', 'tabindex'],
    ['tabpanel:0', 'hidden'],
    ['tabpanel:1', 'hidden'],
    ['tabpanel:2', 'hidden'],
    ['tabpanel:3', 'hidden'],
  ],
  events: ['onSelectionChange'],
};
