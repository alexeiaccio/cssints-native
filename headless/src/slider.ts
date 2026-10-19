import type { Accessor } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createControllable } from './controllable';
import { createFocusHost, tabKey, whenDisposed } from './focus-host';
import { nextId } from './parts';

export type SliderOrientation = 'horizontal' | 'vertical';
export type SliderDirection = 'ltr' | 'rtl';

export interface SliderOptions {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** The jump distance of PageUp / PageDown. */
  readonly largeStep?: number;
  /** Controlled: the host owns the value and this is the only thing that changes it. */
  readonly value?: number | undefined;
  /** Starting value when uncontrolled; ignored while `value` is set. */
  readonly defaultValue?: number;
  readonly orientation?: SliderOrientation;
  readonly direction?: SliderDirection;
  /** The text a screen reader reads for a value. The default says low, medium or high. */
  readonly valueText?: (value: number) => string;
  /** Base for the generated thumb id. */
  readonly id?: string;
  /** The focus manager the thumb registers with; a private one when omitted. */
  readonly focus?: Focus;
  /**
   * A request to change the value, called when the intent differs from the
   * current value. Uncontrolled it is accepted; controlled the host may ignore it.
   */
  readonly onValueChange?: (value: number) => void;
}

/**
 * The thumb: `role=slider`, the one focusable part. It has no `press`: a press
 * on the rail is `Slider.pointer`, not a press of the thumb.
 */
export interface SliderThumbPart {
  readonly id: string;
  readonly role: 'slider';
  readonly valueNow: number;
  readonly valueMin: number;
  readonly valueMax: number;
  readonly valueText: string;
  readonly orientation: SliderOrientation;
  readonly tabIndex: 0;
  readonly focused: boolean;
  readonly focus: () => void;
  readonly blur: () => void;
  readonly keyDown: (key: string) => boolean;
  readonly keyUp: (key: string) => boolean;
  readonly key: (key: string) => boolean;
}

export interface Slider {
  readonly value: Accessor<number>;
  readonly focused: Accessor<boolean>;
  /** Requests; `setValue` and a rail press are requests too. */
  readonly setValue: (value: number) => void;
  readonly focus: () => void;
  readonly blur: () => void;
  /** Returns whether the key moved the value (the host prevents its default). */
  readonly keyDown: (key: string) => boolean;
  /**
   * A press on the rail at `ratio`, a 0..1 fraction of the track from its start
   * (the bottom of a vertical slider). The host measures the press; the thumb takes focus.
   */
  readonly pointer: (ratio: number) => void;
  readonly thumb: SliderThumbPart;
}

const valueTextFor = (value: number): string =>
  value <= 3 ? 'low' : value <= 7 ? 'medium' : 'high';

/**
 * APG Slider (https://www.w3.org/WAI/ARIA/apg/patterns/slider/): a single
 * `role=slider` thumb. It is one entry in the focus manager, not a group, so a
 * host's Tab reaches it and nothing else does: arrows change the value (Up and
 * Right raise it, mirrored for RTL on a horizontal slider), PageUp and PageDown
 * move by `largeStep`, Home and End go to the ends. Checked against
 * `specs/apg/slider.qnt` by the scenario bridge.
 *
 * Native / polyfill / hybrid / library: **native** — the platform
 * `<input type=range>` already owns this pattern; this primitive is the
 * `role=slider` markup and keyboard contract for hosts that need the ARIA
 * element (styling the native thumb is not shipped).
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default (`defaultValue`);
 * pass `value` + `onValueChange` to own the value. A key or rail press is a
 * request the host may ignore.
 *
 * ponytail: dragging (pointer capture and move) is not modelled — the spec
 * deliberately only fixes a discrete rail press; a host that drags calls
 * `pointer` for each position.
 */
export const createSlider = (options: SliderOptions = {}): Slider => {
  const min = options.min ?? 0;
  const max = options.max ?? 10;
  const step = options.step ?? 1;
  const largeStep = options.largeStep ?? 3;
  const base = options.id ?? nextId('slider');
  const thumbId = `${base}-thumb`;
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const valueText = options.valueText ?? valueTextFor;

  const clamp = (value: number): number => Math.max(min, Math.min(max, value));
  const [value, request] = createControllable({
    value: () => options.value,
    initial: clamp(options.defaultValue ?? 5),
    onChange: () => options.onValueChange,
  });

  manager.register(thumbId);
  whenDisposed(() => {
    manager.unregister(thumbId);
  });

  const orientation = (): SliderOrientation =>
    options.orientation ?? 'horizontal';
  const direction = (): SliderDirection => options.direction ?? 'ltr';
  const flipped = (): boolean =>
    orientation() === 'horizontal' && direction() === 'rtl';
  const focused = (): boolean => manager.focused() === thumbId;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const commit = (next: number): void => request(clamp(next));

  const delta = (key: string): number => {
    switch (key) {
      case 'ArrowUp':
        return step;
      case 'ArrowDown':
        return -step;
      case 'ArrowRight':
        return flipped() ? -step : step;
      case 'ArrowLeft':
        return flipped() ? step : -step;
      case 'PageUp':
        return largeStep;
      case 'PageDown':
        return -largeStep;
      default:
        return 0;
    }
  };

  const keyDown = (key: string): boolean => {
    if (!focused()) {
      return false;
    }
    const tab = tabKey(key);
    if (tab !== undefined) {
      return manager.key(tab);
    }
    if (key === 'Home') {
      commit(min);
      return true;
    }
    if (key === 'End') {
      commit(max);
      return true;
    }
    const change = delta(key);
    if (change === 0) {
      return false;
    }
    commit(value() + change);
    return true;
  };

  const pointer = (ratio: number): void => {
    const steps = Math.round((ratio * (max - min)) / step);
    commit(min + steps * step);
    manager.focus(thumbId);
  };

  return {
    value,
    focused: () => read(focused),
    setValue: commit,
    focus: () => {
      manager.focus(thumbId);
    },
    blur: () => {
      if (focused()) {
        manager.blur();
      }
    },
    keyDown,
    pointer,
    thumb: {
      id: thumbId,
      role: 'slider',
      get valueNow() {
        return value();
      },
      valueMin: min,
      valueMax: max,
      get valueText() {
        return valueText(value());
      },
      get orientation() {
        return orientation();
      },
      tabIndex: 0,
      get focused() {
        return read(focused);
      },
      focus: () => {
        manager.focus(thumbId);
      },
      blur: () => {
        if (focused()) {
          manager.blur();
        }
      },
      keyDown,
      keyUp: () => false,
      key: keyDown,
    },
  };
};
