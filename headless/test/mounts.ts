import { createRoot, createSignal } from 'solid-js';
import type { ButtonConfig } from '../vendor/specs/src/apg/button.bridge';
import type { CheckboxConfig } from '../vendor/specs/src/apg/checkbox.bridge';
import type { CheckboxState } from '../src/checkbox';
import type { DisclosureConfig } from '../vendor/specs/src/apg/disclosure.bridge';
import type { Json } from '../vendor/specs/src/scenario';
import type { Mounted } from './neutral-driver';
import type { SwitchConfig } from '../vendor/specs/src/apg/switch.bridge';
import { createButton } from '../src/button';
import { createCheckbox } from '../src/checkbox';
import { createDisclosure } from '../src/disclosure';
import { createSwitch } from '../src/switch';

/**
 * One mount per primitive, the analogue of eoa's `*.fixture.tsx`: it creates
 * the primitive and hands the neutral driver its parts. Controlled, the mount
 * is the host: it keeps the value in a signal, passes it as `value`, and either
 * writes every request back (`accepts`) or ignores the callback.
 */
const record = (events: Map<string, Json[]>, name: string, payload: Json) => {
  events.set(name, [...(events.get(name) ?? []), payload]);
};

export const mountButton = (config: ButtonConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const [isToggle, setIsToggle] = createSignal(config.toggle);
  const [disabled, setDisabled] = createSignal(config.disabled);
  const [host, setHost] = createSignal(config.pressed);
  let activations = 0;
  const writeHost = (next: boolean): void => {
    if (config.controlled) {
      setHost(next);
    }
  };

  return createRoot((dispose) => {
    const button = createButton({
      get isToggle() {
        return isToggle();
      },
      defaultValue: config.pressed,
      get value() {
        return config.controlled ? host() : undefined;
      },
      get disabled() {
        return disabled();
      },
      onClick: () => {
        activations += 1;
        for (const name of ['onClick', 'onPress', 'onClickCapture']) {
          events.set(name, [activations]);
        }
      },
      onValueChange: (value) => {
        record(events, 'onPressedChange', value);
        if (config.accepts) {
          setHost(value);
        }
      },
    });
    return {
      parts: { button: button.part },
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'disabled':
          case 'isDisabled':
            setDisabled(value === true);
            break;
          case 'toggle':
          case 'isToggle':
            setIsToggle(value === true);
            break;
          case 'pressed':
          case 'isSelected':
          case 'value':
            writeHost(value === true);
            break;
          case 'hostToggle':
            writeHost(!host());
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

export const mountSwitch = (config: SwitchConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const [host, setHost] = createSignal(config.checked);
  const writeHost = (next: boolean): void => {
    if (config.controlled) {
      setHost(next);
    }
  };

  return createRoot((dispose) => {
    const control = createSwitch({
      defaultValue: config.checked,
      get value() {
        return config.controlled ? host() : undefined;
      },
      disabled: config.disabled,
      readOnly: config.readOnly,
      enterToggles: config.enterToggles,
      onValueChange: (checked) => {
        record(events, 'onChange', checked);
        if (config.accepts) {
          setHost(checked);
        }
      },
    });
    return {
      parts: { switch: control.part },
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'disabled':
          case 'isDisabled':
            control.setDisabled(value === true);
            break;
          case 'checked':
          case 'isSelected':
            writeHost(value === true);
            break;
          case 'enterToggles':
            control.setEnterToggles(value === true);
            break;
          case 'hostToggle':
            writeHost(!host());
            break;
          case 'focus':
            control.part.focus();
            break;
          case 'blur':
            control.part.blur();
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

export const mountCheckbox = (config: CheckboxConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const initial: CheckboxState =
    config.state === 'mixed' ? 'mixed' : config.state === 'true';
  const [host, setHost] = createSignal<CheckboxState>(initial);
  const writeHost = (state: CheckboxState): void => {
    if (config.controlled) {
      setHost(state);
    }
  };

  return createRoot((dispose) => {
    const box = createCheckbox({
      defaultValue: initial,
      get value() {
        return config.controlled ? host() : undefined;
      },
      allowMixed: config.allowMixed,
      disabled: config.disabled,
      readOnly: config.readOnly,
      onValueChange: (state) => {
        record(events, 'onChange', state === true);
        if (config.accepts) {
          setHost(state);
        }
      },
    });
    return {
      parts: { checkbox: box.part },
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'disabled':
          case 'isDisabled':
            box.setDisabled(value === true);
            break;
          case 'allowMixed':
          case 'indeterminate':
          case 'isIndeterminate':
            box.setAllowMixed(value === true);
            break;
          case 'checked':
          case 'isSelected':
            writeHost(value === true);
            break;
          case 'hostToggle':
            writeHost(host() !== true);
            break;
          case 'focus':
            box.part.focus();
            break;
          case 'blur':
            box.part.blur();
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

export const mountDisclosure = (config: DisclosureConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const [disabled, setDisabled] = createSignal(config.disabled);
  const [host, setHost] = createSignal(config.expanded);
  const writeHost = (next: boolean): void => {
    if (config.controlled) {
      setHost(next);
    }
  };

  return createRoot((dispose) => {
    const disclosure = createDisclosure({
      defaultValue: config.expanded,
      get value() {
        return config.controlled ? host() : undefined;
      },
      get disabled() {
        return disabled();
      },
      onValueChange: (expanded) => {
        record(events, 'onExpandedChange', expanded);
        if (config.accepts) {
          setHost(expanded);
        }
      },
    });
    return {
      parts: {
        trigger: disclosure.trigger,
        panel: disclosure.panel,
        // the host's own outside button: it writes the controlled value, it is not a trigger
        'trigger:1': {
          id: 'outside',
          role: 'button',
          get expanded() {
            return disclosure.expanded();
          },
          controls: disclosure.panel.id,
          press: () => {
            writeHost(!host());
          },
        },
      },
      events,
      value: () => ({ isExpanded: disclosure.expanded() }),
      setProp: (name, value) => {
        switch (name) {
          case 'disabled':
          case 'isDisabled':
            setDisabled(value === true);
            break;
          case 'expand':
            disclosure.expand();
            break;
          case 'collapse':
            disclosure.collapse();
            break;
          case 'toggle':
            disclosure.toggle();
            break;
          case 'isExpanded':
            writeHost(value === true);
            break;
          case 'hostToggle':
            writeHost(!host());
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};
