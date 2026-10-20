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
 * Menubar vocabulary <-> `specs/apg/menu-menubar.qnt`, shared by the spec
 * driver and the DOM driver. The spec's fixture is fixed:
 *
 *   menubar:  1 File (menu of 3, item 2 has a submenu of 2)  2 Edit (menu of 2)
 *             3 About (no menu)
 *
 * `menuitem:0` is a menubar item; `menuitem:0/1` item 2 of File's menu;
 * `menuitem:0/1/0` item 1 of that submenu; `menu:0` / `submenu:1` are the
 * popups. Config keys other than `items` / `orientation` are unsupported.
 */
export interface MenuMenubarConfig {
  readonly items: ReadonlyArray<string>;
  readonly orientation: 'horizontal' | 'vertical';
  readonly controlled: boolean;
  readonly accepts: boolean;
  /** The controlled open top menu (0..2). */
  readonly value: number;
}

const CONFIG_KEYS = new Set([
  'items',
  'orientation',
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

export const menuMenubarConfig = (
  config: ScenarioConfig,
): MenuMenubarConfig => {
  let items: ReadonlyArray<string> = [];
  let orientation: 'horizontal' | 'vertical' = 'horizontal';
  let controlled = false;
  let accepts = true;
  let value = 0;
  for (const [key, raw] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Unsupported(`config ${key}=${JSON.stringify(raw)}`);
    }
    if (key === 'items') {
      items = toItems(raw);
    } else if (key === 'orientation') {
      if (raw !== 'horizontal' && raw !== 'vertical') {
        throw new Unsupported(`orientation ${JSON.stringify(raw)}`);
      }
      orientation = raw;
    } else if (key === 'controlled') {
      controlled = raw === true;
    } else if (key === 'accepts') {
      controlled = true;
      accepts = raw === true;
    } else if (key === 'value') {
      const top = typeof raw === 'number' ? raw : Number.NaN;
      if (top < 0 || top > 2 || !Number.isInteger(top)) {
        throw new Unsupported(`value ${JSON.stringify(raw)}`);
      }
      controlled = true;
      value = top;
    }
  }
  if (items.length === 0) {
    throw new Unsupported('config has no items');
  }
  return { items, orientation, controlled, accepts, value };
};

/** `menuitem:0/1` -> the numeric path. */
const pathOf = (target: string): ReadonlyArray<number> => {
  const rest = target.replace(/^menuitem:/, '');
  const parts = rest.split('/').filter((part) => part.length > 0);
  return parts.map((part) => {
    const value = Number(part);
    if (!Number.isInteger(value)) {
      throw new Unsupported(`target ${target}`);
    }
    return value;
  });
};

// The bridge only models the spec's fixed tree; a scenario that addresses any
// other part shape is unsupported (skipped) instead of failing on a missing DOM
// part. Paths are 0-based DOM indices into: menubar 3; File menu 3; Edit menu 2;
// the File menu's item 2 has a submenu of 2.
const hasSubDom = (bar: number, item: number): boolean =>
  bar === 0 && item === 1;
const menuSize = (bar: number): number => {
  if (bar === 0) return 3;
  if (bar === 1) return 2;
  return 0;
};

const assertTarget = (target: string | undefined): void => {
  if (target === undefined || target === 'menubar' || target === 'outside') {
    return;
  }
  if (target === 'submenu:1') {
    return;
  }
  const menu = /^menu:(\d+)$/.exec(target);
  if (menu?.[1] !== undefined) {
    if (Number(menu[1]) > 1) {
      throw new Unsupported(`target ${target}`);
    }
    return;
  }
  if (!target.startsWith('menuitem:')) {
    throw new Unsupported(`target ${target}`);
  }
  const path = pathOf(target);
  if (path.length === 1) {
    if ((path[0] ?? 0) > 2) {
      throw new Unsupported(`target ${target}`);
    }
    return;
  }
  if (path.length === 2) {
    const bar = path[0] ?? 0;
    const item = path[1] ?? 0;
    if (bar > 2 || item >= menuSize(bar)) {
      throw new Unsupported(`target ${target}`);
    }
    return;
  }
  if (path.length === 3) {
    if (!hasSubDom(path[0] ?? 0, path[1] ?? 0) || (path[2] ?? 0) > 1) {
      throw new Unsupported(`target ${target}`);
    }
    return;
  }
  throw new Unsupported(`target ${target}`);
};

const keyEvent = (key: string | undefined): QuintEvent => {
  switch (key) {
    case 'Enter':
      return specEvent('activate', { key: 'Enter' });
    case ' ':
    case 'Space':
      return specEvent('activate', { key: 'Space' });
    case 'ArrowRight':
      return specEvent('arrow_right');
    case 'ArrowLeft':
      return specEvent('arrow_left');
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
    case 'Shift+Tab':
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
      const top = typeof step.value === 'number' ? step.value : Number.NaN;
      if (top < 0 || top > 2 || !Number.isInteger(top)) {
        throw new Unsupported(`prop setValue=${JSON.stringify(step.value)}`);
      }
      return [specEvent('setValue', { t: BigInt(top) })];
    }
    case 'hostToggle':
      return [specEvent('hostToggle')];
    default:
      throw new Unsupported(`prop ${step.prop ?? ''}`);
  }
};

// ---- the spec's fixed fixture ---------------------------------------------
const hasMenu = (bar: number): boolean => bar === 1 || bar === 2;
const hasSub = (bar: number, item: number): boolean => bar === 1 && item === 2;

export const menuMenubarBridge: SpecBridge = {
  setup: (config) => {
    const mount = menuMenubarConfig(config);
    return [
      ...(mount.controlled ? [specEvent('control')] : []),
      ...(mount.controlled && mount.accepts
        ? [specEvent('acceptRequests')]
        : []),
      ...(mount.controlled && mount.value !== 0
        ? [specEvent('setValue', { t: BigInt(mount.value) })]
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
        return [];
      case 'key':
        return [keyEvent(step.key)];
      case 'type':
        // the DOM driver has no text-input path; type-ahead steps are unsupported
        throw new Unsupported(`type ${step.text ?? ''}`);
      case 'hover':
      case 'unhover':
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
      return `menuitem:${Number(state['barStop']) - 1}`;
    }
    if (level === 2) {
      return `menuitem:${Number(state['openTop']) - 1}/${Number(state['focusIdx']) - 1}`;
    }
    if (level === 3) {
      return `menuitem:${Number(state['openTop']) - 1}/${Number(state['openSub']) - 1}/${Number(state['focusIdx']) - 1}`;
    }
    return null;
  },
  attr: (state: QuintModelValue, target: string, name: string) => {
    if (target === 'menubar') {
      if (name === 'role') {
        return 'menubar';
      }
      if (name === 'aria-orientation') {
        return 'horizontal';
      }
      throw new Unsupported(`attribute ${name} on menubar`);
    }
    if (!target.startsWith('menuitem')) {
      throw new Unsupported(`attribute ${name} on ${target}`);
    }
    const path = pathOf(target);
    const barStop = Number(state['barStop']);
    const openTop = Number(state['openTop']);
    const openSub = Number(state['openSub']);
    if (path.length === 1) {
      const bar = (path[0] ?? 0) + 1;
      if (name === 'aria-haspopup') {
        return hasMenu(bar) ? 'menu' : null;
      }
      if (name === 'aria-expanded') {
        if (!hasMenu(bar)) {
          return null;
        }
        return openTop === bar ? 'true' : 'false';
      }
      if (name === 'tabindex') {
        return barStop === bar ? '0' : '-1';
      }
    } else if (path.length === 2) {
      const bar = (path[0] ?? 0) + 1;
      const item = (path[1] ?? 0) + 1;
      if (name === 'aria-haspopup') {
        return hasSub(bar, item) ? 'menu' : null;
      }
      if (name === 'aria-expanded') {
        if (!hasSub(bar, item)) {
          return null;
        }
        return openTop === bar && openSub === item ? 'true' : 'false';
      }
    }
    throw new Unsupported(`attribute ${name} on ${target}`);
  },
  visible: (state: QuintModelValue) => {
    const openTop = Number(state['openTop']);
    const openSub = Number(state['openSub']);
    return [
      ...(openTop > 0 ? [`menu:${openTop - 1}`] : []),
      ...(openSub > 0 ? ['submenu:1'] : []),
    ];
  },
  events: () => [],
};

/** The user-level steps a differential walk draws from. */
export const menuMenubarSteps: ReadonlyArray<ActionStep> = [
  { event: 'prop', prop: 'focus' },
  { event: 'prop', prop: 'leave' },
  { event: 'prop', prop: 'key', value: { key: 'ArrowRight' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowLeft' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowDown' } },
  { event: 'prop', prop: 'key', value: { key: 'ArrowUp' } },
  { event: 'prop', prop: 'key', value: { key: 'Enter' } },
  { event: 'prop', prop: 'key', value: { key: 'Space' } },
  { event: 'prop', prop: 'key', value: { key: 'Escape' } },
];

export const menuMenubarProbe: Probe = {
  attrs: [
    ['menubar', 'role'],
    ['menuitem:0', 'aria-haspopup'],
    ['menuitem:0', 'aria-expanded'],
    ['menuitem:0', 'tabindex'],
    ['menuitem:1', 'aria-haspopup'],
    ['menuitem:1', 'aria-expanded'],
    ['menuitem:1', 'tabindex'],
    ['menuitem:2', 'aria-haspopup'],
    ['menuitem:2', 'tabindex'],
    ['menu:0', 'hidden'],
    ['menu:1', 'hidden'],
    ['submenu:1', 'hidden'],
  ],
  events: [],
};
