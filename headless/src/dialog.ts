import { type Accessor, createEffect } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createControllable } from './controllable';
import { createFocusHost, tabKey, whenDisposed } from './focus-host';
import { type PartHandlers, createPressable, nextId } from './parts';

export type DialogRole = 'dialog' | 'alertdialog';

/** Read lazily: pass an object with getters, never destructured values. */
export interface DialogModalOptions {
  /** Controlled: the host owns the open state and this is the only thing that changes it. */
  readonly value?: boolean | undefined;
  /** Uncontrolled starting state; ignored while `value` is set. */
  readonly defaultOpen?: boolean;
  readonly modal?: boolean;
  readonly role?: DialogRole;
  /** Id of the element naming the dialog. */
  readonly labelledby?: string | undefined;
  /** Id of the element describing the dialog. */
  readonly describedby?: string | undefined;
  /** A press on the backdrop closes the dialog. */
  readonly dismissable?: boolean;
  /** Escape cannot close the dialog. */
  readonly keyboardDismissDisabled?: boolean;
  /** Base for the generated ids (`<id>-trigger`, `<id>-dialog`, ...). */
  readonly id?: string;
  /** The focus manager the trigger and the content controls register with; a private one when omitted. */
  readonly focus?: Focus;
  /** A request to change the open state; uncontrolled it is accepted, controlled the host may ignore it. */
  readonly onOpenChange?: (open: boolean) => void;
}

/** The button that opens the dialog; `role=button` with `aria-haspopup="dialog"`. */
export interface DialogTriggerPart extends PartHandlers {
  readonly id: string;
  readonly role: 'button';
  readonly hasPopup: 'dialog';
  readonly expanded: boolean;
  /** The id of the dialog it controls. */
  readonly controls: string;
  readonly disabled: boolean;
  readonly focused: boolean;
}

/** The dialog itself: a container, not a focus stop (`tabIndex: -1`). */
export interface DialogPanelPart {
  readonly id: string;
  readonly role: DialogRole;
  readonly modal: boolean;
  readonly labelledBy: string | undefined;
  readonly describedBy: string | undefined;
  readonly tabIndex: -1;
  readonly hidden: boolean;
  /** Escape closes; Tab and Shift+Tab cycle the content controls and never leave. */
  readonly keyDown: (key: string) => boolean;
}

/** The backdrop: a press on it closes the dialog only when the dialog is dismissable. */
export interface DialogBackdropPart {
  readonly id: string;
  readonly hidden: boolean;
  readonly press: () => void;
}

/** The close button the dialog recommends; its id is `<base>-dismiss`. */
export interface DialogDismissPart extends PartHandlers {
  readonly id: string;
  readonly role: 'button';
  readonly disabled: boolean;
  readonly focused: boolean;
}

/** A content control: the dialog cycles its Tab stops and hands it back its own keys. */
export interface DialogContentPart {
  readonly id: string;
  readonly role?: string;
  readonly focused?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export interface DialogModal {
  readonly open: Accessor<boolean>;
  /** Requests; `close` and `toggle` are requests too. */
  readonly openDialog: () => void;
  readonly close: () => void;
  readonly toggle: () => void;
  /**
   * Registers a content control in the page's manager (while the dialog is open) and in the dialog's Tab cycle.
   * Returns the part, so the page can spread `input.bind(dialog.add(ok.part))`.
   */
  readonly add: <T extends DialogContentPart>(part: T) => T;
  /** The modal trap: Tab and Shift+Tab cycle the content controls (wrapping), Escape closes. False for other keys. */
  readonly keyDown: (key: string) => boolean;
  /** Moves focus to the first content control (opening the dialog does this). */
  readonly focusFirst: () => void;
  readonly trigger: DialogTriggerPart;
  readonly dialog: DialogPanelPart;
  readonly backdrop: DialogBackdropPart;
  readonly dismiss: DialogDismissPart;
}

const isSpace = (key: string): boolean => key === ' ' || key === 'Space';

/**
 * APG Dialog (Modal) (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): a
 * trigger and a modal dialog with a backdrop. Focus moves into the dialog when
 * it opens (its first content control), Tab and Shift+Tab cycle the content
 * controls and never leave them, Escape closes, and closing returns focus to
 * what held it before (the trigger, when the dialog was opened from it).
 * `role=alertdialog` is the same pattern with a different role. The dialog
 * container itself is not focusable (`tabIndex: -1`, no `focus()`), as the spec
 * says.
 *
 * Request/commit (map ticket `rt1p`): uncontrolled by default (`defaultOpen`);
 * pass `value` + `onOpenChange` to own the state. Opening is what the page's
 * styles read (`hidden` on the dialog and the backdrop).
 *
 * The page wires the trap by giving every key to `keyDown` while the dialog is
 * open (`input.modal` in `solid/src/input.ts`); the conformance mount does the
 * same. Checked against `specs/apg/dialog-modal.qnt` by the scenario bridge.
 */
export const createDialogModal = (
  options: DialogModalOptions = {},
): DialogModal => {
  const [open, request] = createControllable({
    value: () => options.value,
    initial: options.defaultOpen ?? false,
    onChange: () => options.onOpenChange,
  });
  const base = options.id ?? nextId('dialog');
  const host = createFocusHost(options.focus);
  const manager = host.manager;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };
  const modal = (): boolean => options.modal ?? true;
  const role = (): DialogRole => options.role ?? 'dialog';
  const dismissable = (): boolean => options.dismissable ?? true;

  const dialogId = `${base}-dialog`;
  const backdropId = `${base}-backdrop`;
  const triggerId = `${base}-trigger`;
  const dismissId = `${base}-dismiss`;

  /**
   * The content controls, in the order the page declares them (its document order). They stay known across closes
   * (`add` is called once per control, not per open), and only registration is per open.
   */
  const contents: DialogContentPart[] = [];
  const registered = new Set<string>();
  let restorePushed = false;
  // the first effect run reports the state at mount; the controls the page adds
  // before the first frame must not be dropped by it
  let firstRun = true;

  const registerContents = (): void => {
    for (const part of contents) {
      if (!registered.has(part.id)) {
        manager.register(part.id, {
          ...(part.disabled === undefined ? {} : { disabled: part.disabled }),
        });
        registered.add(part.id);
      }
    }
  };
  const unregisterContents = (): void => {
    for (const id of registered) {
      manager.unregister(id);
    }
    registered.clear();
  };

  const openDialog = (): void => {
    request(true);
  };
  const close = (): void => {
    request(false);
  };

  manager.register(triggerId);
  whenDisposed(() => {
    unregisterContents();
    manager.unregister(triggerId);
  });

  const focusFirst = (): void => {
    const first = contents[0];
    // don't pull focus back if it is already on one of ours (a later add)
    if (open() && first !== undefined && !contents.some((part) => part.id === manager.focused())) {
      manager.focus(first.id);
    }
  };

  // The committed open state moves focus: in on the first control, back to
  // whatever held focus before on close. The trigger is the fallback target.
  createEffect(
    () => open(),
    (isOpen) => {
      if (isOpen) {
        if (!restorePushed) {
          const prev = manager.focused();
          const inside = contents.some((part) => part.id === prev);
          manager.push(prev === null || inside ? triggerId : prev);
          restorePushed = true;
        }
        registerContents();
        focusFirst();
      } else if (!firstRun) {
        const held = registered.has(manager.focused() ?? '');
        unregisterContents();
        if (held) {
          manager.pop();
        }
        restorePushed = false;
      }
      firstRun = false;
    },
  );

  const keyDown = (key: string): boolean => {
    if (key === 'Escape') {
      if (!(options.keyboardDismissDisabled ?? false)) {
        close();
      }
      return true;
    }
    const tab = tabKey(key);
    if (tab === undefined || contents.length === 0) {
      return false;
    }
    const at = contents.findIndex((part) => manager.focused() === part.id);
    const step = tab === 'Shift+Tab' ? -1 : 1;
    const next =
      at < 0 ? (step > 0 ? 0 : contents.length - 1) : (at + step + contents.length) % contents.length;
    const target = contents[next];
    if (target !== undefined) {
      manager.focus(target.id);
    }
    return true;
  };

  const add = <T extends DialogContentPart>(part: T): T => {
    if (!contents.some((other) => other.id === part.id)) {
      contents.push(part);
    }
    if (open()) {
      registerContents();
      focusFirst();
    }
    return part;
  };

  const dismissPress = createPressable({
    blocked: () => false,
    enterActivates: () => true,
    activate: close,
  });

  return {
    open,
    openDialog,
    close,
    toggle: () => {
      request(!open());
    },
    add,
    keyDown,
    focusFirst,
    trigger: {
      id: triggerId,
      role: 'button',
      hasPopup: 'dialog',
      get expanded() {
        return open();
      },
      controls: dialogId,
      disabled: false,
      get focused() {
        return read(() => manager.focused() === triggerId);
      },
      press: openDialog,
      // the trigger is a plain button: Enter and Space both open on key down,
      // as the dialog example and the spec's `pressSpace` prop do
      keyDown: (key) => {
        if (key === 'Escape') {
          // the spec sends an Escape anywhere to the top dialog
          if (open()) {
            close();
          }
          return true;
        }
        if (key === 'Enter' || isSpace(key)) {
          openDialog();
          return true;
        }
        return false;
      },
      keyUp: () => false,
      key: (key) => {
        if (key === 'Enter' || isSpace(key)) {
          openDialog();
          return true;
        }
        return false;
      },
      focus: () => {
        manager.focus(triggerId);
      },
      blur: () => {
        if (manager.focused() === triggerId) {
          manager.blur();
        }
      },
    },
    dialog: {
      id: dialogId,
      get role() {
        return role();
      },
      get modal() {
        return modal();
      },
      labelledBy: options.labelledby,
      describedBy:
        options.describedby ?? (role() === 'alertdialog' ? 'description' : undefined),
      tabIndex: -1,
      get hidden() {
        return !open();
      },
      keyDown,
    },
    backdrop: {
      id: backdropId,
      get hidden() {
        return !open();
      },
      press: () => {
        if (dismissable()) {
          close();
        }
      },
    },
    dismiss: {
      id: dismissId,
      role: 'button',
      disabled: false,
      get focused() {
        return read(() => dismissPress.focused() || manager.focused() === dismissId);
      },
      ...dismissPress.handlers,
    },
  };
};
