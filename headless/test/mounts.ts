import { createRoot, createSignal } from 'solid-js';
import type { ButtonConfig } from '../vendor/specs/src/apg/button.bridge';
import type { CheckboxConfig } from '../vendor/specs/src/apg/checkbox.bridge';
import type { CheckboxState } from '../src/checkbox';
import type { DialogModalConfig } from '../vendor/specs/src/apg/dialog-modal.bridge';
import type { DisclosureConfig } from '../vendor/specs/src/apg/disclosure.bridge';
import type { Json } from '../vendor/specs/src/scenario';
import { Unsupported } from '../vendor/specs/src/scenario';
import type { MenuButtonConfig } from '../vendor/specs/src/apg/menu-button.bridge';
import type { MenuCheckableConfig } from '../vendor/specs/src/apg/menu-checkable.bridge';
import type { MenuMenubarConfig } from '../vendor/specs/src/apg/menu-menubar.bridge';
import type { Mounted, NeutralPart } from './neutral-driver';
import type { RadioConfig } from '../vendor/specs/src/apg/radio.bridge';
import type { SliderConfig } from '../vendor/specs/src/apg/slider.bridge';
import type { SwitchConfig } from '../vendor/specs/src/apg/switch.bridge';
import type { TabsConfig } from '../vendor/specs/src/apg/tabs.bridge';
import type { ToolbarConfig } from '../vendor/specs/src/apg/toolbar.bridge';
import type { TreeviewConfig } from '../vendor/specs/src/apg/treeview.bridge';
import { nodeToPath, pathToNode } from '../vendor/specs/src/apg/treeview.bridge';
import type { ToolbarItemKind } from '../src/toolbar';
import { createButton } from '../src/button';
import { createCheckbox } from '../src/checkbox';
import { createDialogModal } from '../src/dialog';
import { createDisclosure } from '../src/disclosure';
import { createMenu } from '../src/menu';
import { createMenubar } from '../src/menubar';
import { createRadioGroup } from '../src/radio';
import { createSlider } from '../src/slider';
import { createSwitch } from '../src/switch';
import { createTabs } from '../src/tabs';
import { createToolbar } from '../src/toolbar';
import { TREE_NODES, createTree } from '../src/tree';
import { createFocus } from '../../focus/src/focus';

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

/** The mask of disabled indices (a bit per index), as the scenarios and the walk spell it. */
const maskToIndices = (mask: number): ReadonlyArray<number> =>
  [0, 1, 2, 3].filter((index) => ((mask >> index) & 1) === 1);

/** The key a `key` prop step carries: `{ key }` (radio) or `{ k }` (toolbar). */
const keyField = (value: Json | undefined, field: 'key' | 'k'): string => {
  const key =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, Json>>)[field]
      : undefined;
  if (typeof key !== 'string') {
    throw new Error(`key needs a string ${field}, got ${JSON.stringify(value)}`);
  }
  return key;
};

/**
 * The radio group, the analogue of `radio.fixture.tsx`: the group's parts, with
 * the radios keyed `radio:N`. Controlled, the mount is the host.
 */
export const mountRadio = (config: RadioConfig): Mounted => {
  if (config.flavor === 'activedescendant') {
    throw new Unsupported(
      'flavor activedescendant: the group takes focus and names the radio by id, not by a focus entry (not ported)',
    );
  }
  const events = new Map<string, Json[]>();
  const values = config.values;
  const initialIndex = config.pinned ?? config.checked;
  const [host, setHost] = createSignal<Json>(
    initialIndex === null ? null : (values[initialIndex] ?? null),
  );
  const writeHost = (value: Json | undefined): void => {
    if (config.controlled) {
      setHost(value ?? null);
    }
  };

  return createRoot((dispose) => {
    const group = createRadioGroup<Json>({
      values,
      get value() {
        return config.controlled ? (host() ?? undefined) : undefined;
      },
      defaultValue:
        config.checked === null ? undefined : values[config.checked],
      disabled: config.disabled,
      dir: config.direction,
      id: 'radio',
      ...(config.orientation === undefined
        ? {}
        : { orientation: config.orientation }),
      ...(config.describedby === undefined
        ? {}
        : { describedby: config.describedby }),
      onValueChange: (value) => {
        record(events, 'onChange', value);
        record(events, 'onChangeIndex', values.indexOf(value));
        if (config.accepts) {
          setHost(value);
        }
      },
      onFocus: (target) => {
        record(events, 'onFocus', target);
      },
      onBlur: (target) => {
        record(events, 'onBlur', target);
      },
    });
    const parts: Record<string, NeutralPart> = {
      radiogroup: group.group,
    };
    group.radios.forEach((radio, index) => {
      parts[`radio:${index}`] = radio;
    });
    return {
      parts,
      events,
      value: () => group.value(),
      setProp: (name, value) => {
        switch (name) {
          case 'focus':
            group.focus();
            break;
          case 'blur':
            group.blur();
            break;
          case 'key':
            group.keyDown(keyField(value, 'key'));
            break;
          case 'click':
            if (typeof value !== 'number' || !Number.isInteger(value)) {
              throw new Error(`click needs an index, got ${JSON.stringify(value)}`);
            }
            group.click(value);
            break;
          case 'preselect':
            group.setPreselect(typeof value === 'number' ? value : null);
            break;
          case 'disabled':
            group.setDisabled(
              typeof value === 'number' ? maskToIndices(value) : [],
            );
            break;
          case 'setValue':
            writeHost(typeof value === 'number' ? values[value] : undefined);
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/**
 * The tabs, the analogue of `tabs.fixture.tsx`: the tablist, `tab:N` and
 * `tabpanel:N`. The eoa fixture's focusable input in panel 0 is not rendered: no
 * part carries it, so a panel-tabindex scenario fails on what the port has.
 */
export const mountTabs = (config: TabsConfig): Mounted => {
  if (config.deletable) {
    throw new Unsupported(
      'deletable: the Delete key removes a tab, which the port does not do',
    );
  }
  const events = new Map<string, Json[]>();
  const [host, setHost] = createSignal(config.pinned ?? config.selected);
  const writeHost = (next: number): void => {
    if (config.controlled) {
      setHost(next);
    }
  };

  return createRoot((dispose) => {
    const tabs = createTabs({
      items: config.items,
      get value() {
        return config.controlled ? host() : undefined;
      },
      defaultSelected: config.selected,
      orientation: config.orientation,
      activation: config.activation,
      disabled: maskToIndices(config.disabled),
      focusablePanels: [0],
      onValueChange: (index) => {
        record(events, 'onSelectionChange', `tab:${index}`);
        if (config.accepts) {
          setHost(index);
        }
      },
    });
    const parts: Record<string, NeutralPart> = { tablist: tabs.tablist };
    tabs.tabs.forEach((tab, index) => {
      parts[`tab:${index}`] = tab;
    });
    tabs.panels.forEach((panel, index) => {
      parts[`tabpanel:${index}`] = panel;
    });
    return {
      parts,
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'selectedKey':
          case 'selected':
            tabs.setSelected(Number(value));
            break;
          case 'setValue':
            writeHost(Number(value));
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

const kindOfLabel = (label: string): ToolbarItemKind => {
  if (label === 'text' || label === 'textbox') {
    return 'text';
  }
  if (label === 'spin' || label === 'spinbutton') {
    return 'spin';
  }
  return 'button';
};

/**
 * The toolbar, the analogue of `toolbar.fixture.tsx` without the menu. A
 * `menutrigger` item is the spec's menu-button; the menu is not ported, so such
 * a mount is unsupported. The walk uses a plain button there, and its alphabet
 * leaves out the steps that would open the spec's menu (see the toolbar test).
 */
export const mountToolbar = (config: ToolbarConfig): Mounted => {
  if (config.items.some((label) => label.toLowerCase().includes('menutrigger'))) {
    throw new Unsupported(
      'menu-button item: the menu it opens is not ported (eoa menu.ts)',
    );
  }
  const events = new Map<string, Json[]>();
  const kinds = config.items.map(kindOfLabel);

  return createRoot((dispose) => {
    const toolbar = createToolbar({
      items: config.items,
      kinds,
      orientation: config.orientation,
      wrap: config.wrap,
      disabled: config.disabled,
      onActivate: (index) => {
        record(events, 'onActivate', `item:${index}`);
      },
    });
    const parts: Record<string, NeutralPart> = { toolbar: toolbar.toolbar };
    toolbar.items.forEach((item, index) => {
      parts[`item:${index}`] = item;
    });
    return {
      parts,
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'tabIn':
            toolbar.focusIn();
            break;
          case 'leave':
          case 'blur':
            toolbar.leave();
            break;
          case 'tab': {
            const back =
              typeof value === 'object' &&
              value !== null &&
              !Array.isArray(value) &&
              (value as Readonly<Record<string, Json>>)['back'] === true;
            toolbar.tab(back);
            break;
          }
          case 'click':
            toolbar.clickItem(Number(value));
            break;
          case 'key': {
            const key = keyField(value, 'k');
            // the walk spells arrows short (`Left`); the primitive takes the DOM key
            toolbar.keyDown(
              ['Left', 'Right', 'Up', 'Down'].includes(key) ? `Arrow${key}` : key,
            );
            break;
          }
          case 'activate':
            toolbar.activate();
            break;
          case 'toggleDisabled':
            toolbar.toggleDisabled(Number(value));
            break;
          case 'flipOrientation':
            toolbar.setOrientation(
              toolbar.orientation() === 'horizontal' ? 'vertical' : 'horizontal',
            );
            break;
          case 'flipWrap':
            toolbar.setWrap(!toolbar.wrap());
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/**
 * The slider, the analogue of `slider.fixture.tsx`: the thumb, and `pointer`
 * (a rail press at a 0..1 fraction) in place of the rail's DOM pointer event.
 */
export const mountSlider = (config: SliderConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const [orientation, setOrientation] = createSignal(config.orientation);
  const [direction, setDirection] = createSignal(config.dir);
  const [host, setHost] = createSignal(config.value);
  const writeHost = (next: number): void => {
    if (config.controlled) {
      setHost(next);
    }
  };

  return createRoot((dispose) => {
    const slider = createSlider({
      min: config.min,
      max: config.max,
      step: config.step,
      largeStep: config.largeStep,
      defaultValue: config.value,
      get value() {
        return config.controlled ? host() : undefined;
      },
      get orientation() {
        return orientation();
      },
      get direction() {
        return direction();
      },
      onValueChange: (value) => {
        record(events, 'onValueChange', value);
        if (config.accepts) {
          setHost(value);
        }
      },
    });
    return {
      parts: { thumb: slider.thumb },
      events,
      value: () => slider.value(),
      setProp: (name, value) => {
        switch (name) {
          case 'orientation':
            setOrientation(value === 'vertical' ? 'vertical' : 'horizontal');
            break;
          case 'dir':
          case 'direction':
            setDirection(value === 'rtl' ? 'rtl' : 'ltr');
            break;
          case 'pointer':
            slider.pointer(Number(value));
            break;
          case 'setValue':
            writeHost(Number(value));
            break;
          case 'hostToggle':
            writeHost(host() === config.max ? config.min : config.max);
            break;
          case 'focus':
            slider.focus();
            break;
          case 'blur':
            slider.blur();
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/**
 * The tree, the analogue of `treeview.fixture.tsx` without a DOM: the fixed
 * seven-node tree of the spec, parts keyed by the scenario's slash paths
 * (`tree`, `treeitem:0/0`). Controlled, the mount is the host and either writes
 * every request back (`accepts`) or ignores it.
 */
export const mountTreeview = (config: TreeviewConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const ids = TREE_NODES.map((node) => node.id);
  const idsOfMask = (mask: number): ReadonlyArray<number> =>
    ids.filter((id) => (mask & (1 << (id - 1))) !== 0);
  const [host, setHost] = createSignal<ReadonlyArray<number>>(
    idsOfMask(config.selected),
  );
  const writeHost = (next: ReadonlyArray<number>): void => {
    if (config.controlled) {
      setHost([...next].sort((a, b) => a - b));
    }
  };

  return createRoot((dispose) => {
    const tree = createTree({
      nodes: TREE_NODES,
      selection: config.multi ? 'multiple' : 'single',
      defaultExpanded: idsOfMask(config.expanded),
      defaultValue: idsOfMask(config.selected),
      defaultFocus: config.focus,
      get value() {
        return config.controlled ? host() : undefined;
      },
      ...(config.label === undefined ? {} : { label: config.label }),
      ...(config.orientation === undefined
        ? {}
        : { orientation: config.orientation }),
      onValueChange: (selected) => {
        if (config.accepts) {
          setHost([...selected].sort((a, b) => a - b));
        }
      },
      onExpandedChange: (node) => {
        record(events, 'onExpandedChange', nodeToPath(node.id));
      },
      onSelectionChange: (node) => {
        record(events, 'onSelectionChange', nodeToPath(node.id));
      },
      onActivate: (node) => {
        record(events, 'onActivate', nodeToPath(node.id));
      },
    });
    const parts: Record<string, NeutralPart> = {};
    for (const id of tree.nodeIds) {
      parts[nodeToPath(id)] = tree.item(id);
    }
    // The tree part last: the driver reports the first part whose `focused` is
    // true, and that must be the focused item, not the container.
    parts['tree'] = tree.tree;
    return {
      parts,
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'selected':
          case 'setValue':
            if (!Array.isArray(value)) {
              throw new Error(
                `selected needs an array, got ${JSON.stringify(value)}`,
              );
            }
            writeHost(value.map((path) => pathToNode(String(path))));
            break;
          case 'hostToggle':
            writeHost(
              host().includes(1)
                ? host().filter((id) => id !== 1)
                : [...host(), 1],
            );
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/** A key press is Space when a button takes it (the DOM's `key` or the parts' "Space"). */
const spaceKey = (key: string): boolean => key === ' ' || key === 'Space';

/**
 * The dialog, the analogue of eoa's `dialog-modal.fixture.tsx`: the trigger, the
 * hidden-until-open dialog (with a Confirm button and a dismiss), a backdrop and
 * an outside area. The dialog's content controls are registered in the mount's
 * focus manager (`dialog.add`), and each goes through the dialog's trap first,
 * so Tab cycles them while the dialog is open. A click on the outside area
 * closes only when the dialog is dismissable; the backdrop does the same.
 */
export const mountDialogModal = (config: DialogModalConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const [host, setHost] = createSignal(config.open);

  return createRoot((dispose) => {
    const focus = createFocus();
    const dialog = createDialogModal({
      defaultOpen: config.open,
      get value() {
        return config.controlled ? host() : undefined;
      },
      modal: config.modal,
      role: config.role,
      labelledby: 'header',
      dismissable: config.dismissable,
      keyboardDismissDisabled: config.keyboardDismissDisabled,
      focus,
      onOpenChange: (open) => {
        record(events, 'onOpenChange', open);
        if (!open) {
          events.set('onClose', [1]);
        }
        if (config.accepts) {
          setHost(open);
        }
      },
    });

    let armed = false;
    /** A content control: the dialog's trap first, then its own activation. */
    const content = (id: string, activate?: () => void): NeutralPart => ({
      id,
      role: 'button',
      get focused() {
        return focus.focused() === id;
      },
      press: () => {
        activate?.();
      },
      keyDown: (key, repeat) => {
        if (dialog.keyDown(key)) {
          return true;
        }
        if (repeat === true) {
          return false;
        }
        if (key === 'Enter') {
          activate?.();
          return true;
        }
        if (spaceKey(key)) {
          armed = true;
          return true;
        }
        return false;
      },
      keyUp: (key) => {
        if (!spaceKey(key)) {
          return false;
        }
        const was = armed;
        armed = false;
        if (was) {
          activate?.();
        }
        return was;
      },
      focus: () => {
        focus.focus(id);
      },
      blur: () => {
        if (focus.focused() === id) {
          focus.blur();
        }
      },
    });

    // eoa's fixture order: the dialog's Confirm button holds focus when it opens,
    // and the dismiss is its other content control.
    const confirm = dialog.add(content('button'));
    const dismiss = dialog.add(content(dialog.dismiss.id, dialog.dismiss.press));

    return {
      parts: {
        trigger: dialog.trigger,
        dialog: dialog.dialog,
        // a press on the backdrop drops focus (ariakit) and closes when dismissable
        backdrop: {
          id: dialog.backdrop.id,
          get hidden() {
            return dialog.backdrop.hidden;
          },
          press: dialog.backdrop.press,
          focus: () => {
            focus.blur();
          },
        },
        outside: {
          id: 'outside',
          // a press outside drops focus (ariakit), so the close restores nothing
          focus: () => {
            focus.blur();
          },
          press: () => {
            if (config.dismissable) {
              dialog.close();
            }
          },
        },
        dismiss,
        button: confirm,
      },
      events,
      value: () => dialog.open(),
      setProp: (name, value) => {
        switch (name) {
          case 'pressEnter':
            dialog.trigger.keyDown('Enter');
            break;
          case 'pressSpace':
            dialog.trigger.keyDown(' ');
            break;
          case 'escape':
            dialog.dialog.keyDown('Escape');
            break;
          case 'setValue':
            if (config.controlled) {
              setHost(value === true);
            }
            break;
          case 'hostToggle':
            if (config.controlled) {
              setHost(!host());
            }
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/**
 * The plain menu button, the analogue of eoa's `menu-button.fixture.tsx`: the
 * trigger and the flat menu of `menu-button.qnt` (4 items, the mount disables
 * the indices the config names). Focus is the mount's own manager, which the
 * primitive holds while open. The open state is uncontrolled, so the spec's
 * `setValue` / `hostToggle` host writes are inert.
 */
export const mountMenuButton = (config: MenuButtonConfig): Mounted => {
  const events = new Map<string, Json[]>();

  return createRoot((dispose) => {
    const menu = createMenu({
      items: config.items,
      variant: 'plain',
      triggerMode: 'outside',
      disabled: config.disabled,
      id: 'menu',
      onOpenChange: (open) => {
        record(events, 'onOpenChange', [open]);
      },
      onItemClick: (index) => {
        record(events, 'onItemClick', [`menuitem:${index}`]);
      },
    });
    const parts: Record<string, NeutralPart> = {
      trigger: menu.trigger,
      menu: menu.menu,
    };
    config.items.forEach((_label, index) => {
      parts[`menuitem:${index}`] = menu.item(index);
    });
    return {
      parts,
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'focus':
            menu.focusTrigger();
            break;
          case 'leave':
          case 'blur':
            menu.leave();
            break;
          case 'key':
            menu.keyDown(keyField(value, 'key'));
            break;
          case 'typeahead':
            menu.typeaheadCode(Number(value));
            break;
          case 'type':
            menu.type(String(value));
            break;
          case 'setValue':
          case 'hostToggle':
            // uncontrolled open: the spec's host writes are no-ops
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/**
 * The checkable menu, the analogue of eoa's `menu.fixture.tsx`: the `mixed`
 * variant is the spec's fixed shape (item 1 a checkbox, items 2-4 a radio
 * group, item 5 plain); `checkbox-items` and `radio-items` are the ported
 * scenarios' uniform menus. Controlled, the mount is the host of the packed
 * checked state and either writes every request back (`accepts`) or ignores it.
 */
export const mountCheckableMenu = (config: MenuCheckableConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const [host, setHost] = createSignal(config.value);

  return createRoot((dispose) => {
    const menu = createMenu({
      items: config.items,
      variant: config.variant,
      triggerMode: 'held',
      disabled: config.disabled,
      id: 'menu',
      get value() {
        return config.controlled ? host() : undefined;
      },
      onOpenChange: (open) => {
        record(events, 'onOpenChange', open);
      },
      onItemClick: (index) => {
        record(events, 'onItemClick', [`menuitem:${index}`]);
      },
      onCheckedChange: (checked) => {
        // eoa's fixture reports the latest checked value, not every one
        events.set('onCheckedChange', [checked]);
      },
      onValueChange: (index) => {
        record(events, 'onValueChange', index + 1);
      },
      onCheckedValueChange: (value) => {
        if (config.accepts) {
          setHost(value);
        }
      },
    });
    const parts: Record<string, NeutralPart> = {
      trigger: menu.trigger,
      menu: menu.menu,
    };
    config.items.forEach((_label, index) => {
      parts[`menuitem:${index}`] = menu.item(index);
    });
    return {
      parts,
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'focus':
            menu.focusTrigger();
            break;
          case 'key':
            menu.keyDown(keyField(value, 'key'));
            break;
          case 'setValue':
            setHost(Number(value));
            break;
          case 'hostToggle':
            setHost((packed) => (packed >= 5 ? packed - 5 : packed + 5));
            break;
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};

/**
 * The menubar, the analogue of eoa's `menu.fixture.tsx`: the spec's fixed tree
 * (File: New, More with a submenu of One and Two, Close; Edit: Undo, Redo;
 * About with no menu). Targets are full paths (`menuitem:0/1/0`, `submenu:1`),
 * as eoa's fixture labelled them. The menubar has a private focus manager.
 */
export const mountMenubar = (config: MenuMenubarConfig): Mounted => {
  const events = new Map<string, Json[]>();
  const labels = config.items;
  const tree = [
    {
      label: labels[0] ?? 'File',
      menu: [
        { label: 'New' },
        { label: 'More', submenu: [{ label: 'One' }, { label: 'Two' }] },
        { label: 'Close' },
      ],
    },
    {
      label: labels[1] ?? 'Edit',
      menu: [{ label: 'Undo' }, { label: 'Redo' }],
    },
    { label: labels[2] ?? 'About' },
  ];

  return createRoot((dispose) => {
    const menubar = createMenubar({
      id: 'menubar',
      items: tree,
      orientation: config.orientation,
      onActivate: (path) => {
        record(events, 'onActivate', path);
      },
      onOpenChange: (openTop) => {
        record(events, 'onOpenChange', openTop);
      },
    });
    const parts: Record<string, NeutralPart> = { menubar: menubar.menubar };
    menubar.items.forEach((item, bar) => {
      parts[`menuitem:${bar}`] = menubar.item(bar);
      parts[`menu:${bar}`] = menubar.menu(bar);
      item.menu.forEach((menuItem, index) => {
        parts[`menuitem:${bar}/${index}`] = menubar.menuItem(bar, index);
        if (menuItem.submenu.length > 0) {
          parts[`submenu:${bar + 1}`] = menubar.submenu(bar, index);
          menuItem.submenu.forEach((_sub, sub) => {
            parts[`menuitem:${bar}/${index}/${sub}`] = menubar.submenuItem(bar, index, sub);
          });
        }
      });
    });
    return {
      parts,
      events,
      setProp: (name, value) => {
        switch (name) {
          case 'focus':
            menubar.focusIn();
            break;
          case 'leave':
          case 'blur':
            menubar.leave();
            break;
          case 'key':
            menubar.keyDown(keyField(value, 'key'));
            break;
          case 'typeahead':
          case 'type':
            throw new Unsupported('menubar type-ahead is not ported');
          default:
            throw new Error(`mount has no prop ${name}`);
        }
      },
      dispose,
    };
  });
};
