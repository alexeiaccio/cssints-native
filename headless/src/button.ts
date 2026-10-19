import { type Accessor, createEffect } from 'solid-js';
import { createControllable } from './controllable';
import { type PartHandlers, createPressable, nextId } from './parts';

/** Read lazily: pass an object with getters, never destructured values. */
export interface ButtonOptions {
  /** A toggle button carries `pressed`; a command button does not. */
  readonly isToggle?: boolean;
  /** Controlled: the host owns the pressed state and this is the only thing that changes it. */
  readonly value?: boolean | undefined;
  /** Uncontrolled starting state for a toggle. */
  readonly defaultValue?: boolean;
  /** The button stays focusable but never activates. */
  readonly disabled?: boolean;
  readonly id?: string;
  /** The activation happened (Enter, Space or pointer). */
  readonly onClick?: () => void;
  /**
   * A request to change the pressed state, called when a toggle activation
   * differs from the current value. Uncontrolled it is accepted; controlled the
   * host may ignore it.
   */
  readonly onValueChange?: (pressed: boolean) => void;
}

/** What the renderer and the accessibility tree read; every field is getter-backed. */
export interface ButtonPart extends PartHandlers {
  readonly id: string;
  readonly role: 'button';
  /** `undefined` on a command button. */
  readonly pressed: boolean | undefined;
  readonly disabled: boolean;
  readonly focused: boolean;
}

export interface Button {
  readonly pressed: Accessor<boolean>;
  readonly focused: Accessor<boolean>;
  /** Programmatic pressed change; a request the host may ignore. */
  readonly setPressed: (pressed: boolean) => void;
  readonly part: ButtonPart;
}

/**
 * APG Button (https://www.w3.org/WAI/ARIA/apg/patterns/button/): a command
 * button and (with `isToggle`) a toggle button. Platform-neutral: no native
 * `<button>` to lean on, so Enter, Space and the pointer release are handled
 * here (see `createPressable`).
 *
 * Request/commit (map ticket `rt1p`): a toggle activation is a request the host
 * may ignore; `value` + `onValueChange` own the state, `defaultValue` is
 * uncontrolled. A command button's activation never carries a value.
 */
export const createButton = (options: ButtonOptions = {}): Button => {
  const [pressed, requestPressed] = createControllable<boolean>({
    value: () => options.value,
    initial: options.defaultValue ?? false,
    onChange: () => options.onValueChange,
  });
  const isToggle = (): boolean => options.isToggle === true;
  const disabled = (): boolean => options.disabled === true;

  const pressable = createPressable({
    blocked: disabled,
    enterActivates: () => true,
    activate: () => {
      options.onClick?.();
      if (isToggle()) {
        requestPressed(!pressed());
      }
    },
  });
  // Disabling drops an armed Space, as it does on the switch and the checkbox.
  // `disabled` is a lazy option (not the button's own signal), so watch it.
  createEffect(
    () => disabled(),
    (isDisabled) => {
      if (isDisabled) {
        pressable.disarm();
      }
    },
  );
  const id = options.id ?? nextId('button');

  return {
    pressed,
    focused: pressable.focused,
    setPressed: (value) => {
      requestPressed(value);
    },
    part: {
      id,
      role: 'button',
      get pressed() {
        return isToggle() ? pressed() : undefined;
      },
      get disabled() {
        return disabled();
      },
      get focused() {
        return pressable.focused();
      },
      ...pressable.handlers,
    },
  };
};
