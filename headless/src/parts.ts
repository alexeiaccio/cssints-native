import { type Accessor, createSignal } from 'solid-js';

/**
 * What a host (a Clay page, a test) wires to its own input. A part has no
 * element and no DOM event: the host decides which part holds focus and routes
 * input to it, so the handlers do not check focus themselves. `key*` return
 * whether the part consumed the key, so a host can let the rest (Tab, arrows)
 * fall through.
 */
export interface PartHandlers {
  /** Pointer activation: the pointer was released over the part. */
  readonly press: () => void;
  readonly keyDown: (key: string, repeat?: boolean) => boolean;
  readonly keyUp: (key: string) => boolean;
  /** A whole key press: `keyDown` then `keyUp`. */
  readonly key: (key: string) => boolean;
  readonly focus: () => void;
  readonly blur: () => void;
}

let counter = 0;
/** A stable-per-creation-order id; pass `id` for one that survives a reordering. */
export const nextId = (kind: string): string => {
  counter += 1;
  return `${kind}-${counter}`;
};

const isSpace = (key: string): boolean => key === ' ' || key === 'Space';

export interface PressableOptions {
  /** Nothing activates (disabled, read-only). */
  readonly blocked: () => boolean;
  /** Whether Enter activates (a native button: yes; a checkbox: no). */
  readonly enterActivates: () => boolean;
  /** The part can hold focus; a natively disabled control cannot. */
  readonly focusable?: () => boolean;
  readonly activate: () => void;
}

export interface Pressable {
  readonly focused: Accessor<boolean>;
  readonly handlers: PartHandlers;
  /** Drop a pending Space press (the part got disabled). */
  readonly disarm: () => void;
}

/**
 * The activation contract shared by button, switch and checkbox: Enter fires on
 * key down, Space is armed on key down and fires on key up (the native
 * `<button>` behaviour), a blur or disabling drops an armed Space, a pointer
 * release fires.
 */
export const createPressable = (options: PressableOptions): Pressable => {
  const [focused, setFocused] = createSignal(false);
  let spaceArmed = false;

  const press = (): void => {
    if (!options.blocked()) {
      options.activate();
    }
  };
  const keyDown = (key: string, repeat = false): boolean => {
    if (options.blocked()) {
      return false;
    }
    if (isSpace(key) && !repeat) {
      spaceArmed = true;
      return true;
    }
    if (key === 'Enter' && options.enterActivates()) {
      options.activate();
      return true;
    }
    return false;
  };
  const keyUp = (key: string): boolean => {
    if (!isSpace(key)) {
      return false;
    }
    const armed = spaceArmed;
    spaceArmed = false;
    if (armed && !options.blocked()) {
      options.activate();
    }
    return armed;
  };

  return {
    focused,
    disarm: () => {
      spaceArmed = false;
    },
    handlers: {
      press,
      keyDown,
      keyUp,
      key: (key) => {
        const down = keyDown(key);
        return keyUp(key) || down;
      },
      focus: () => {
        if (options.focusable?.() ?? true) {
          setFocused(true);
        }
      },
      blur: () => {
        setFocused(false);
        spaceArmed = false;
      },
    },
  };
};
