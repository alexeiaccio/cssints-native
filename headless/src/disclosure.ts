import { type Accessor } from 'solid-js';
import { createControllable } from './controllable';
import { type PartHandlers, createPressable, nextId } from './parts';

/** Read lazily: pass an object with getters, never destructured values. */
export interface DisclosureOptions {
  /** Controlled: the host owns the state and this is the only thing that changes it. */
  readonly value?: boolean | undefined;
  /** Uncontrolled starting state; ignored while `value` is set. */
  readonly defaultValue?: boolean;
  readonly disabled?: boolean;
  /** Base for the trigger/panel ids (`<id>-trigger`, `<id>-panel`). */
  readonly id?: string;
  /**
   * A request to change the state, called when the intent differs from the
   * current value. Uncontrolled it is accepted; controlled the host may ignore it.
   */
  readonly onValueChange?: (expanded: boolean) => void;
}

/** The button that shows or hides the panel; every field is getter-backed. */
export interface DisclosureTriggerPart extends PartHandlers {
  readonly id: string;
  readonly role: 'button';
  readonly expanded: boolean;
  /** The id of the panel it controls. */
  readonly controls: string;
  /** Inert like a native disabled button: it cannot take focus or activate. */
  readonly disabled: boolean;
  readonly focused: boolean;
}

export interface DisclosurePanelPart {
  readonly id: string;
  /** The renderer skips the content (and its layout) while hidden. */
  readonly hidden: boolean;
}

export interface Disclosure {
  readonly expanded: Accessor<boolean>;
  readonly focused: Accessor<boolean>;
  /** Requests; `expand`, `collapse` and `toggle` are requests too. */
  readonly setExpanded: (expanded: boolean) => void;
  readonly expand: () => void;
  readonly collapse: () => void;
  readonly toggle: () => void;
  readonly trigger: DisclosureTriggerPart;
  readonly panel: DisclosurePanelPart;
}

/**
 * APG Disclosure (https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/): a
 * trigger and the panel it shows or hides. Enter and Space on the focused
 * trigger and a pointer release toggle. Behaviour is checked against
 * `specs/apg/disclosure.qnt` by the scenario bridge, not by running the
 * generated machine here.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default (`defaultValue`);
 * pass `value` + `onValueChange` to own the state.
 */
export const createDisclosure = (
  options: DisclosureOptions = {},
): Disclosure => {
  const [expanded, request] = createControllable({
    value: () => options.value,
    initial: options.defaultValue ?? false,
    onChange: () => options.onValueChange,
  });
  const base = options.id ?? nextId('disclosure');
  const disabled = (): boolean => options.disabled ?? false;
  const toggle = (): void => {
    request(!expanded());
  };
  const pressable = createPressable({
    blocked: disabled,
    enterActivates: () => true,
    focusable: () => !disabled(),
    activate: toggle,
  });
  const panelId = `${base}-panel`;

  return {
    expanded,
    focused: pressable.focused,
    setExpanded: request,
    expand: () => {
      request(true);
    },
    collapse: () => {
      request(false);
    },
    toggle,
    trigger: {
      id: `${base}-trigger`,
      role: 'button',
      get expanded() {
        return expanded();
      },
      controls: panelId,
      get disabled() {
        return disabled();
      },
      get focused() {
        return pressable.focused();
      },
      ...pressable.handlers,
    },
    panel: {
      id: panelId,
      get hidden() {
        return !expanded();
      },
    },
  };
};
