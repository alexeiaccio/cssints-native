import type { Accessor } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createFocusHost, tabKey, whenDisposed } from './focus-host';
import { type PartHandlers, nextId } from './parts';

export interface RadioGroupOptions<T = unknown> {
  /** Radio values, one per radio; the observable `value` is the checked one. */
  readonly values: ReadonlyArray<T>;
  /** Controlled: the host owns the checked value and this is the only thing that changes it. */
  readonly value?: T | undefined;
  /** Uncontrolled starting checked value; ignored while `value` is set. */
  readonly defaultValue?: T | undefined;
  /** Indices that are never focused, checked or the tab stop. */
  readonly disabled?: ReadonlyArray<number>;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly dir?: 'ltr' | 'rtl';
  readonly id?: string;
  readonly describedby?: string | undefined;
  /** The focus manager the radios register with; a private one when omitted. */
  readonly focus?: Focus;
  /**
   * A request to check a radio, called with its value when the intent differs
   * from the current one. Uncontrolled it is accepted; controlled the host may
   * ignore it.
   */
  readonly onValueChange?: (value: T) => void;
  readonly onFocus?: (target: string) => void;
  readonly onBlur?: (target: string) => void;
}

/** The group: `role=radiogroup`. It takes no focus; the radios do. Its `keyDown` is Tab from outside: enter the group. */
export interface RadioGroupPart {
  readonly id: string;
  readonly role: 'radiogroup';
  readonly orientation: 'horizontal' | 'vertical' | undefined;
  readonly keyDown: (key: string) => boolean;
}

/** One radio: `role=radio`, with its own handlers. */
export interface RadioPart extends PartHandlers {
  readonly id: string;
  readonly role: 'radio';
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly focused: boolean;
  /** 0 for the tab stop (the checked radio, else the first enabled one), -1 for the rest. */
  readonly tabIndex: number;
  readonly describedBy: string | undefined;
}

export interface RadioGroup<T = unknown> {
  readonly checked: Accessor<number | null>;
  /** The index of the radio holding focus, or `null`. */
  readonly focused: Accessor<number | null>;
  readonly values: ReadonlyArray<T>;
  readonly value: () => T | null;
  /** Tab into the group: focus the tab stop. */
  readonly focus: () => void;
  readonly blur: () => void;
  /** A key for the focused radio; returns whether it was consumed. */
  readonly keyDown: (key: string) => boolean;
  readonly click: (index: number) => void;
  readonly setDisabled: (indices: ReadonlyArray<number>) => void;
  readonly setPreselect: (index: number | null) => void;
  readonly group: RadioGroupPart;
  readonly radios: ReadonlyArray<RadioPart>;
}

type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * APG Radio Group (https://www.w3.org/WAI/ARIA/apg/patterns/radio/): a
 * `radiogroup` of `role=radio` parts. The radios are one group in the focus
 * manager: arrows (all four, wrapping, disabled radios skipped) move focus and
 * check the radio focused; Space checks the focused one; Tab enters on the
 * checked radio (the group's `entry`, read lazily) or the first enabled one.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default (`defaultValue`);
 * pass `value` + `onValueChange` to own the check. `click`, arrows and Space are
 * requests. Checked against `specs/apg/radio.qnt` by the scenario bridge.
 *
 * ponytail: the request/commit split is inlined rather than using
 * `createControllable`, because the config remounts (`setPreselect`,
 * `setDisabled`) must write the uncontrolled local without firing the request
 * callback, which `createControllable` does not expose.
 *
 * Not ported: `flavor: 'activedescendant'` (the group takes focus, and the
 * focused radio is an id, not a focus entry).
 */
export const createRadioGroup = <T = unknown>(
  options: RadioGroupOptions<T>,
): RadioGroup<T> => {
  const values = options.values;
  const count = values.length;
  const base = options.id ?? nextId('radio');
  const groupId = `${base}-group`;
  const rtl = options.dir === 'rtl';
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const idOf = (index: number): string => `${base}-radio-${index}`;
  const indexById = new Map<string, number>(
    values.map((_value, index) => [idOf(index), index]),
  );
  const label = (index: number): string => `radio:${index}`;

  const indexOfValue = (value: T | undefined): number => {
    if (value === undefined) {
      return -1;
    }
    const index = values.indexOf(value);
    return index >= 0 ? index : -1;
  };

  const initial = indexOfValue(options.defaultValue);
  let local = initial >= 0 && initial < count ? initial : -1;
  let disabled = new Set<number>(options.disabled ?? []);

  // the controlled value prop wins; undefined = uncontrolled
  const controlledIndex = (): number | undefined => {
    if (options.value === undefined) {
      return undefined;
    }
    const index = indexOfValue(options.value);
    return index >= 0 ? index : undefined;
  };
  const checkedIndex = (): number => controlledIndex() ?? local;
  const checked = (): number | null => {
    const index = checkedIndex();
    return index >= 0 ? index : null;
  };

  const focusedIndex = (): number => {
    const id = manager.focused();
    return id === null ? -1 : (indexById.get(id) ?? -1);
  };
  const tabStopIndex = (): number => {
    const stop = manager.tabOrder().find((id) => indexById.has(id));
    return stop === undefined ? -1 : (indexById.get(stop) ?? -1);
  };

  /** A request: fires onValueChange when the intent differs, commits only uncontrolled. */
  const request = (next: number): void => {
    if (next === checkedIndex()) {
      return;
    }
    if (controlledIndex() === undefined) {
      local = next;
      host.changed();
    }
    const value = values[next];
    if (value !== undefined) {
      options.onValueChange?.(value);
    }
  };

  /** A config remount writes the uncontrolled local directly (no request). */
  const commitLocal = (index: number): void => {
    local = index;
    host.changed();
  };

  const select = (index: number): void => {
    if (index < 0 || index >= count || disabled.has(index)) {
      return;
    }
    request(index);
  };

  // A focus change the primitive makes itself (a config remount) clears focus
  // without onBlur, as the eoa primitive did.
  let quiet = false;
  const clearFocus = (): void => {
    if (focusedIndex() >= 0) {
      quiet = true;
      manager.blur();
      quiet = false;
    }
  };

  manager.group(groupId, {
    orientation: 'both',
    wrap: true,
    memory: false,
    // read on every Tab, so it follows the checked radio; '' (no member) gives the first enabled one
    get entry() {
      host.version();
      const index = checked();
      return index === null ? '' : idOf(index);
    },
  });
  const register = (): void => {
    for (let index = 0; index < count; index += 1) {
      manager.register(idOf(index), {
        group: groupId,
        disabled: disabled.has(index),
      });
    }
  };
  register();
  whenDisposed(() => {
    for (let index = 0; index < count; index += 1) {
      manager.unregister(idOf(index));
    }
  });

  whenDisposed(
    manager.onChange((next, prev) => {
      if (!quiet && prev !== null && indexById.has(prev)) {
        options.onBlur?.(label(indexById.get(prev) ?? -1));
      }
      if (next !== null && indexById.has(next)) {
        options.onFocus?.(label(indexById.get(next) ?? -1));
      }
    }),
  );

  // Left is forward in RTL; the manager owns all four arrows (the group is `both`).
  const arrowName = (key: string): Arrow | undefined => {
    if (key === 'ArrowLeft') {
      return rtl ? 'ArrowRight' : 'ArrowLeft';
    }
    if (key === 'ArrowRight') {
      return rtl ? 'ArrowLeft' : 'ArrowRight';
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      return key;
    }
    return undefined;
  };

  const keyDown = (key: string): boolean => {
    if (focusedIndex() < 0) {
      return false;
    }
    const tab = tabKey(key);
    if (tab !== undefined) {
      return manager.key(tab);
    }
    if (key === ' ' || key === 'Space') {
      select(focusedIndex());
      return true;
    }
    const name = arrowName(key);
    if (name === undefined) {
      return false;
    }
    manager.key(name);
    select(focusedIndex());
    return true;
  };

  const click = (index: number): void => {
    if (disabled.has(index)) {
      return;
    }
    manager.focus(idOf(index));
    select(index);
  };

  const radios: RadioPart[] = Array.from({ length: count }, (_value, index) => {
    const id = idOf(index);
    return {
      id,
      role: 'radio',
      get checked() {
        return read(() => checked() === index);
      },
      get disabled() {
        return read(() => disabled.has(index));
      },
      get focused() {
        return read(() => manager.focused() === id);
      },
      get tabIndex() {
        return read(() => (tabStopIndex() === index ? 0 : -1));
      },
      get describedBy() {
        return options.describedby;
      },
      press: () => {
        click(index);
      },
      keyDown,
      keyUp: () => false,
      key: keyDown,
      focus: () => {
        manager.focus(id);
      },
      blur: () => {
        if (manager.focused() === id) {
          manager.blur();
        }
      },
    };
  });

  return {
    checked: () => read(checked),
    focused: () =>
      read(() => {
        const index = focusedIndex();
        return index >= 0 ? index : null;
      }),
    values,
    value: () => {
      const index = checked();
      return index === null ? null : (values[index] ?? null);
    },
    focus: () => {
      if (focusedIndex() < 0) {
        manager.focus(idOf(tabStopIndex()));
      }
    },
    blur: () => {
      if (focusedIndex() >= 0) {
        manager.blur();
      }
    },
    keyDown,
    click,
    setDisabled: (indices) => {
      clearFocus();
      disabled = new Set(indices);
      const current = checked();
      if (current !== null && indices.includes(current)) {
        commitLocal(-1);
      }
      register();
      host.changed();
    },
    setPreselect: (index) => {
      clearFocus();
      commitLocal(
        index !== null && index < count && !disabled.has(index) ? index : -1,
      );
    },
    group: {
      id: base,
      role: 'radiogroup',
      orientation: options.orientation,
      // Tab from outside the group enters it at the tab stop
      keyDown: (key) => {
        if (tabKey(key) === undefined || focusedIndex() >= 0) {
          return false;
        }
        manager.focus(idOf(tabStopIndex()));
        return true;
      },
    },
    radios,
  };
};
