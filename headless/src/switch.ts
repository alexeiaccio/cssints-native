import { type Accessor, createSignal } from 'solid-js';
import { createControllable } from './controllable';
import { type PartHandlers, createPressable, nextId } from './parts';

export interface SwitchOptions {
  /** Controlled: the host owns the state and this is the only thing that changes it. */
  readonly value?: boolean | undefined;
  /** Uncontrolled starting state; ignored while `value` is set. */
  readonly defaultValue?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  /** The APG's optional Enter key also flips the switch. */
  readonly enterToggles?: boolean;
  readonly id?: string;
  /**
   * A request to change the state, called when the intent differs from the
   * current value. Uncontrolled it is accepted; controlled the host may ignore it.
   */
  readonly onValueChange?: (checked: boolean) => void;
}

/** What the renderer and the accessibility tree read; every field is getter-backed. */
export interface SwitchPart extends PartHandlers {
  readonly id: string;
  readonly role: 'switch';
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly focused: boolean;
}

export interface Switch {
  readonly checked: Accessor<boolean>;
  readonly disabled: Accessor<boolean>;
  readonly readOnly: Accessor<boolean>;
  readonly enterToggles: Accessor<boolean>;
  readonly focused: Accessor<boolean>;
  /** Programmatic state change; a request the host may ignore. */
  readonly setChecked: (checked: boolean) => void;
  readonly setDisabled: (value: boolean) => void;
  readonly setEnterToggles: (value: boolean) => void;
  readonly toggle: () => void;
  readonly part: SwitchPart;
}

/**
 * APG Switch (https://www.w3.org/WAI/ARIA/apg/patterns/switch/): a binary on/off
 * input. Space arms on key down and flips on key up; Enter flips only when
 * `enterToggles`; a pointer release flips.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default (`defaultValue`);
 * pass `value` + `onValueChange` to own the state.
 */
export const createSwitch = (options: SwitchOptions = {}): Switch => {
  const [checked, requestChecked] = createControllable<boolean>({
    value: () => options.value,
    initial: options.defaultValue ?? false,
    onChange: () => options.onValueChange,
  });
  const [disabled, setDisabledState] = createSignal(options.disabled === true);
  const readOnly = (): boolean => options.readOnly === true;
  const [enterToggles, setEnterToggles] = createSignal(
    options.enterToggles === true,
  );

  const toggle = (): void => {
    requestChecked(!checked());
  };
  const pressable = createPressable({
    blocked: () => disabled() || readOnly(),
    enterActivates: enterToggles,
    activate: toggle,
  });
  const id = options.id ?? nextId('switch');

  return {
    checked,
    disabled,
    readOnly,
    enterToggles,
    focused: pressable.focused,
    setChecked: (value) => {
      requestChecked(value);
    },
    setDisabled: (value) => {
      setDisabledState(value);
      if (value) {
        pressable.disarm();
      }
    },
    setEnterToggles: (value) => {
      setEnterToggles(value);
    },
    toggle: () => {
      if (!disabled() && !readOnly()) {
        toggle();
      }
    },
    part: {
      id,
      role: 'switch',
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
