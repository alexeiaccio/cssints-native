import { type Accessor, createSignal } from 'solid-js';
import { createControllable } from './controllable';
import { type PartHandlers, createPressable, nextId } from './parts';

/** `'mixed'` is the tri-state's third value (AccessKit's `Toggled::Mixed`). */
export type CheckboxState = boolean | 'mixed';

export interface CheckboxOptions {
  /** Controlled: the host owns the value and this is the only thing that changes it. */
  readonly value?: CheckboxState | undefined;
  /** Uncontrolled starting value; ignored while `value` is set. */
  readonly defaultValue?: CheckboxState;
  /** Tri-state: the state may be `'mixed'`. */
  readonly allowMixed?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly id?: string;
  /**
   * A request to change the value, called when the intent differs from the
   * current value. Uncontrolled it is accepted; controlled the host may ignore it.
   */
  readonly onValueChange?: (state: CheckboxState) => void;
}

/** What the renderer and the accessibility tree read; every field is getter-backed. */
export interface CheckboxPart extends PartHandlers {
  readonly id: string;
  readonly role: 'checkbox';
  /** `'mixed'` only while `allowMixed`. */
  readonly checked: CheckboxState;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly focused: boolean;
}

export interface Checkbox {
  readonly checked: Accessor<CheckboxState>;
  readonly allowMixed: Accessor<boolean>;
  readonly disabled: Accessor<boolean>;
  readonly readOnly: Accessor<boolean>;
  readonly focused: Accessor<boolean>;
  /** Programmatic state change; a request the host may ignore. */
  readonly setChecked: (state: CheckboxState) => void;
  readonly setAllowMixed: (value: boolean) => void;
  readonly setDisabled: (value: boolean) => void;
  readonly toggle: () => void;
  readonly part: CheckboxPart;
}

/**
 * APG Checkbox (https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/): one
 * dual-state, optionally tri-state, checkbox. Space arms on key down and fires
 * on key up; Enter is a no-op; a pointer release fires. A mixed checkbox
 * activates to checked.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default (`defaultValue`);
 * pass `value` + `onValueChange` to own the state.
 */
export const createCheckbox = (options: CheckboxOptions = {}): Checkbox => {
  // A dual-state control resolving "mixed" is an internal state change, not a
  // user request: it must not fire onValueChange (the spec's `set_allow_mixed`).
  let resolving = false;
  const [state, requestState] = createControllable<CheckboxState>({
    value: () => options.value,
    initial: options.defaultValue ?? false,
    onChange: () => (resolving ? undefined : options.onValueChange),
  });
  const [allowMixed, setAllowMixedState] = createSignal(
    options.allowMixed === true,
  );
  const [disabled, setDisabledState] = createSignal(options.disabled === true);
  const readOnly = (): boolean => options.readOnly === true;

  // "mixed" only shows while allowMixed; resolving is immediate, so this gate is
  // belt-and-suspenders for a controlled host that lags.
  const checked = (): CheckboxState => {
    const current = state();
    return current === 'mixed' && !allowMixed() ? false : current;
  };
  const toggle = (): void => {
    requestState(checked() !== true);
  };
  const pressable = createPressable({
    blocked: () => disabled() || readOnly(),
    enterActivates: () => false,
    activate: toggle,
  });
  const id = options.id ?? nextId('checkbox');

  return {
    checked,
    allowMixed,
    disabled,
    readOnly,
    focused: pressable.focused,
    setChecked: (value) => {
      requestState(value);
    },
    setAllowMixed: (value) => {
      setAllowMixedState(value);
      if (!value && state() === 'mixed' && options.value === undefined) {
        resolving = true;
        requestState(false);
        resolving = false;
      }
    },
    setDisabled: (value) => {
      setDisabledState(value);
      if (value) {
        pressable.disarm();
      }
    },
    toggle: () => {
      if (!disabled() && !readOnly()) {
        toggle();
      }
    },
    part: {
      id,
      role: 'checkbox',
      get checked() {
        return checked();
      },
      get disabled() {
        return disabled();
      },
      get readOnly() {
        return readOnly();
      },
      get focused() {
        return pressable.focused();
      },
      ...pressable.handlers,
    },
  };
};
