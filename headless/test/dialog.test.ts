import { createRoot, flush } from 'solid-js';
import { createFocus } from '../../focus/src/focus';
import { describe, expect, it } from 'bun:test';
import { createDialogModal } from '../src/dialog';

// What the ported scenarios and the walk do not reach: the modal trap itself.
// The dialog bridge gates a `key Tab` step, so no scenario draws one; these are
// the checks the Dialog page's test repeats on the real tree.
const harness = (options: { defaultOpen?: boolean } = {}) =>
  createRoot((dispose) => {
    const focus = createFocus();
    const dialog = createDialogModal({
      id: 'settings',
      focus,
      ...(options.defaultOpen === undefined ? {} : { defaultOpen: options.defaultOpen }),
    });
    const content = (id: string) => ({
      id,
      role: 'button',
      get focused() {
        return focus.focused() === id;
      },
      press: () => {},
      keyDown: (key: string) => dialog.keyDown(key),
      keyUp: () => false,
      key: (key: string) => dialog.keyDown(key),
      focus: () => {
        focus.focus(id);
      },
      blur: () => {
        if (focus.focused() === id) {
          focus.blur();
        }
      },
    });
    const cancel = dialog.add(content('cancel'));
    const ok = dialog.add(content('ok'));
    return { focus, dialog, cancel, ok, dispose };
  });

describe('createDialogModal: the modal trap', () => {
  it('opening moves focus to the first control, Tab and Shift+Tab wrap inside the dialog', () => {
    const h = harness();
    h.dialog.trigger.focus();
    expect(h.focus.focused()).toBe('settings-trigger');
    h.dialog.trigger.keyDown('Enter');
    flush(); // the open effect moves the focus, as the host does on its next tick
    expect(h.dialog.open()).toBe(true);
    expect(h.focus.focused()).toBe('cancel');

    expect(h.dialog.keyDown('Tab')).toBe(true);
    expect(h.focus.focused()).toBe('ok');
    expect(h.cancel.keyDown('Tab')).toBe(true);
    expect(h.focus.focused()).toBe('cancel');
    expect(h.dialog.keyDown('Shift+Tab')).toBe(true);
    expect(h.focus.focused()).toBe('ok');
    h.dispose();
  });

  it('Escape closes and returns focus to what held it', () => {
    const h = harness();
    h.dialog.trigger.focus();
    h.dialog.trigger.keyDown('Enter');
    expect(h.dialog.keyDown('Escape')).toBe(true);
    flush();
    expect(h.dialog.open()).toBe(false);
    expect(h.dialog.dialog.hidden).toBe(true);
    expect(h.focus.focused()).toBe('settings-trigger');
    h.dispose();
  });

  it('a dismiss and the backdrop close; the trigger opens with Space on key down', () => {
    const h = harness();
    h.dialog.trigger.focus();
    h.dialog.trigger.keyDown(' ');
    expect(h.dialog.open()).toBe(true);
    h.dialog.dismiss.press();
    flush();
    expect(h.dialog.open()).toBe(false);
    h.dialog.trigger.press();
    expect(h.dialog.open()).toBe(true);
    h.dialog.backdrop.press();
    flush();
    expect(h.dialog.open()).toBe(false);
    h.dispose();
  });

  it('a host that ignores the request keeps the dialog open', () => {
    const h = harness({ defaultOpen: true });
    const controlled = createRoot((dispose) => {
      let open = true;
      const dialog = createDialogModal({
        id: 'held',
        get value() {
          return open;
        },
        onOpenChange: () => {
          // pinned: the request is ignored
        },
      });
      return { dialog, dispose };
    });
    expect(controlled.dialog.open()).toBe(true);
    controlled.dialog.keyDown('Escape');
    expect(controlled.dialog.open()).toBe(true);
    expect(h.dialog.dialog.modal).toBe(true);
    controlled.dispose();
    h.dispose();
  });
});
