import {
  menuMenubarBridge,
  menuMenubarConfig,
  menuMenubarProbe,
  menuMenubarSteps,
} from '../vendor/specs/src/apg/menu-menubar.bridge';
import ariakit from '../vendor/specs/scenarios/apg/menubar.ariakit.json';
import baseUi from '../vendor/specs/scenarios/apg/menubar.base-ui.json';
import definition from '../vendor/specs/src/apg/menu-menubar.model.generated.json';
import { createRoot, flush } from 'solid-js';
import { describe, expect, it } from 'bun:test';
import { createFocus } from '../../focus/src/focus';
import { createMenubar } from '../src/menubar';
import { conformance } from './conformance';
import { mountMenubar } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why.
// eoa's list, carried over unchanged: the ported scenarios describe the upstream
// fixtures' own trees and library defaults; the primitive implements the
// APG/Quint contract. eoa's list was written against `document.activeElement`;
// this port's focus manager reports the same parts.
const MENUBAR_TREE =
  'the ported scenario describes the upstream fixture tree (menu sizes / which item owns the submenu / a menu-less bar); the primitive renders the menu-menubar.qnt fixed tree';
const MENUBAR_VERTICAL =
  'menu-menubar.qnt models a horizontal bar; vertical navigation (Up/Down between bar items, the cross-axis key opening a menu) is not modelled';
const MENUBAR_HOVER =
  'store hover-intent opening (APG optional; an ariakit/base-ui extension) is not modelled; menus open on keyboard and click';
const MENUBAR_POPUP_FOCUS =
  'ariakit keeps focus on the popup container; the primitive focuses the first menu item (APG)';
const MENUBAR_CONTAINER_FOCUS =
  'the scenario focuses the menu container; the primitive keeps focus on menu items';
const DIVERGENCES: Readonly<Record<string, string>> = {
  'menubar.ariakit.aria-expanded-reflects-open-menu': MENUBAR_VERTICAL,
  'menubar.ariakit.arrow-down-keeps-focus-on-control-in-vertical-menubar': MENUBAR_VERTICAL,
  'menubar.ariakit.arrow-keys-keep-focus-on-input-in-vertical-menubar': MENUBAR_VERTICAL,
  'menubar.ariakit.vertical-arrow-down-moves-between-items-without-opening': MENUBAR_VERTICAL,
  'menubar.ariakit.vertical-arrow-right-opens-menu': MENUBAR_VERTICAL,
  'menubar.base-ui.vertical-main-axis-arrow-moves-between-triggers': MENUBAR_VERTICAL,
  'menubar.ariakit.hover-switches-open-menu': MENUBAR_HOVER,
  'menubar.base-ui.hover-opens-nested-submenu': MENUBAR_HOVER,
  'menubar.base-ui.hover-switches-open-menu-when-submenu-open': MENUBAR_HOVER,
  'menubar.base-ui.open-new-menu-on-hover-after-click': MENUBAR_HOVER,
  'menubar.ariakit.click-opens-menu-and-focuses-menu': MENUBAR_POPUP_FOCUS,
  'menubar.ariakit.arrow-right-traverses-from-menu-container': MENUBAR_CONTAINER_FOCUS,
  'menubar.ariakit.arrow-up-within-open-menu-moves-to-last-item': MENUBAR_TREE,
  'menubar.ariakit.escape-then-arrow-right-moves-without-opening': MENUBAR_TREE,
  'menubar.ariakit.shift-tab-to-trigger-then-enter-closes': MENUBAR_TREE,
  'menubar.base-ui.arrow-left-right-switch-open-menus': MENUBAR_TREE,
  'menubar.base-ui.arrow-right-closes-submenus-when-navigating-next': MENUBAR_TREE,
  'menubar.base-ui.arrow-right-opens-submenu': MENUBAR_TREE,
};

conformance({
  pattern: 'menu-menubar',
  scenarioFiles: [ariakit, baseUi],
  definition,
  bridge: menuMenubarBridge,
  config: menuMenubarConfig,
  mount: mountMenubar,
  disabledAttr: 'aria-disabled',
  // eoa's parts driver sends a key to whatever holds focus and lets it be a no-op when nothing does; the neutral
  // driver's `focused` mode is that, and a key step never focuses its target first
  keys: 'focused',
  steps: menuMenubarSteps,
  probe: menuMenubarProbe,
  divergences: DIVERGENCES,
  expected: { passed: 26, unsupported: 30 },
  // the spec's fixed fixture, uncontrolled: three bar items, the first menu's second item with a submenu of two
  walks: [{ items: ['File', 'Edit', 'About'] }],
  hideable: ['menu:0', 'menu:1', 'submenu:1'],
});

/**
 * What the walk cannot see: the focus manager's registrations (the roving bar,
 * the open menus as groups), the leaf activation callback and the clicks and
 * open/close notifications the bridge ignores. Every call is followed by a
 * `flush()`, as a host's event is its own tick.
 */
const harness = (options: { disabled?: number[] } = {}) =>
  createRoot((dispose) => {
    const focus = createFocus();
    const activations: number[][] = [];
    const opens: number[] = [];
    const menubar = createMenubar({
      id: 'bar',
      focus,
      items: [
        {
          label: 'File',
          menu: [
            { label: 'New' },
            { label: 'More', submenu: [{ label: 'One' }, { label: 'Two' }] },
          ],
        },
        { label: 'Edit', menu: [{ label: 'Undo' }] },
        { label: 'About' },
      ].map((item, index) => ({
        ...item,
        disabled: options.disabled?.includes(index) === true,
      })),
      onActivate: (path) => activations.push([...path]),
      onOpenChange: (openTop) => opens.push(openTop),
    });
    const act = (run: () => void): void => {
      run();
      flush();
    };
    return { focus, menubar, activations, opens, act, dispose };
  });

describe('createMenubar: the focus manager and the callbacks', () => {
  it('the bar is one Tab stop on the roving item; Right and Left move it and wrap', () => {
    const { focus, menubar, act } = harness();
    act(() => menubar.focusIn());
    expect(focus.tabOrder()).toEqual(['bar-bar-0']);
    expect(focus.focused()).toBe('bar-bar-0');
    act(() => menubar.keyDown('ArrowRight'));
    expect([focus.focused(), menubar.barStop()]).toEqual(['bar-bar-1', 1]);
    expect(focus.tabOrder()).toEqual(['bar-bar-1']);
    act(() => menubar.keyDown('ArrowRight'));
    act(() => menubar.keyDown('ArrowRight'));
    expect(menubar.barStop()).toBe(0); // wraps
    act(() => menubar.keyDown('ArrowLeft'));
    expect(menubar.barStop()).toBe(2);
  });

  it('a disabled bar item carries disabled but stays reachable (aria-disabled)', () => {
    const { focus, menubar, act } = harness({ disabled: [1] });
    expect(menubar.item(1).disabled).toBe(true);
    act(() => menubar.focusIn());
    act(() => menubar.keyDown('ArrowRight'));
    expect([focus.focused(), menubar.barStop()]).toEqual(['bar-bar-1', 1]);
  });

  it('Escape closes the menu and returns focus to the bar item that owns it', () => {
    const { focus, menubar, act } = harness();
    act(() => menubar.focusIn());
    act(() => menubar.keyDown('ArrowRight')); // Edit
    act(() => menubar.keyDown('ArrowDown')); // Edit's menu, first item
    expect([focus.focused(), menubar.focusLevel(), menubar.openTop()]).toEqual([
      'bar-menu-1-0',
      2,
      1,
    ]);
    act(() => menubar.keyDown('Escape'));
    expect([focus.focused(), menubar.focusLevel(), menubar.openTop()]).toEqual([
      'bar-bar-1',
      1,
      -1,
    ]);
  });

  it('Escape from a submenu returns focus to its parent item, not the bar', () => {
    const { focus, menubar, act } = harness();
    act(() => menubar.focusIn());
    act(() => menubar.keyDown('ArrowDown')); // File's menu, New
    act(() => menubar.keyDown('ArrowDown')); // More
    act(() => menubar.keyDown('ArrowRight')); // its submenu, One
    expect([focus.focused(), menubar.focusLevel(), menubar.openSub()]).toEqual([
      'bar-menu-0-1-sub-0',
      3,
      1,
    ]);
    act(() => menubar.keyDown('Escape'));
    expect([focus.focused(), menubar.focusLevel(), menubar.openSub()]).toEqual([
      'bar-menu-0-1',
      2,
      -1,
    ]);
  });

  it('Enter on a parent opens its submenu, on a leaf activates it and closes to the bar', () => {
    const { focus, menubar, activations, act } = harness();
    act(() => menubar.focusIn());
    act(() => menubar.keyDown('ArrowDown'));
    act(() => menubar.keyDown('ArrowDown'));
    act(() => menubar.keyDown('Enter')); // More opens its submenu
    expect([focus.focused(), menubar.focusLevel()]).toEqual(['bar-menu-0-1-sub-0', 3]);
    act(() => menubar.keyDown('Enter')); // One is a leaf
    expect(activations).toEqual([[0, 1, 0]]);
    expect([focus.focused(), menubar.focusLevel(), menubar.openTop()]).toEqual(['bar-bar-0', 1, -1]);
  });

  it('a click on a bar item toggles its menu; a menu-less item is inert; a leaf click activates', () => {
    const { focus, menubar, activations, opens, act } = harness();
    act(() => menubar.item(0).press());
    expect([menubar.openTop(), focus.focused(), menubar.menu(0).hidden]).toEqual([0, 'bar-bar-0', false]);
    act(() => menubar.item(0).press());
    expect([menubar.openTop(), menubar.menu(0).hidden]).toEqual([-1, true]);
    act(() => menubar.item(2).press()); // About has no menu: no menu, no focus (a plain link is the host's)
    expect([menubar.openTop(), focus.focused()]).toEqual([-1, 'bar-bar-0']);
    act(() => menubar.item(0).press());
    act(() => menubar.menuItem(0, 0).press());
    expect(activations).toEqual([[0, 0]]);
    expect([menubar.openTop(), focus.focused()]).toEqual([-1, 'bar-bar-0']);
    expect(opens).toEqual([0, -1, 0, -1]);
  });

  it('the open menu and submenu register only while open, and leave() releases focus', () => {
    const { focus, menubar, act } = harness();
    act(() => menubar.focusIn());
    expect(menubar.menu(0).hidden).toBe(true);
    act(() => menubar.keyDown('ArrowDown'));
    expect(focus.tabOrder()).toEqual(['bar-bar-0', 'bar-menu-0-0']);
    act(() => menubar.keyDown('ArrowDown'));
    act(() => menubar.keyDown('ArrowRight'));
    expect(menubar.submenu(0, 1).hidden).toBe(false);
    act(() => menubar.leave());
    expect([focus.focused(), menubar.openTop(), menubar.openSub(), menubar.focusLevel()]).toEqual([
      null,
      -1,
      -1,
      0,
    ]);
    expect(focus.tabOrder()).toEqual(['bar-bar-0']);
  });

  it('a key repeat does not move', () => {
    const { menubar } = harness();
    menubar.focusIn();
    flush();
    expect(menubar.item(0).keyDown('ArrowRight', true)).toBe(false);
    expect(menubar.focusIndex()).toBe(0);
  });
});
