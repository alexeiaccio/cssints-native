import { describe, expect, it } from 'bun:test';
import { createRoot, flush } from 'solid-js';
import { createFocus } from '../../focus/src/focus';
import { createRadioGroup } from '../src/radio';
import { createSlider } from '../src/slider';
import { createTabs } from '../src/tabs';
import { createToolbar } from '../src/toolbar';

/**
 * What the walks and the scenarios do not reach: the primitives inside one
 * focus manager (a page), activation, embedded controls, and disposal. Every
 * call is followed by `flush()`, as a host's event is its own tick.
 */
const mounted = <T>(make: () => T): T => createRoot(() => make());
const act = (run: () => void): void => {
  run();
  flush();
};

describe('radio group in the focus manager', () => {
  it('arrows move focus and check the radio focused; Space checks', () => {
    const radio = mounted(() =>
      createRadioGroup({ values: ['a', 'b', 'c'], id: 'r' }),
    );
    act(() => radio.focus());
    expect(radio.focused()).toBe(0);
    act(() => {
      radio.keyDown('ArrowDown');
    });
    expect([radio.focused(), radio.checked()]).toEqual([1, 1]);
    act(() => {
      radio.keyDown('ArrowUp');
      radio.keyDown(' ');
    });
    expect([radio.focused(), radio.checked()]).toEqual([0, 0]);
  });

  it('skips disabled radios and wraps', () => {
    const radio = mounted(() =>
      createRadioGroup({ values: ['a', 'b', 'c'], disabled: [1], id: 'r' }),
    );
    act(() => radio.focus());
    act(() => {
      radio.keyDown('ArrowRight');
    });
    expect(radio.focused()).toBe(2);
    act(() => {
      radio.keyDown('ArrowRight');
    });
    expect(radio.focused()).toBe(0);
  });

  it('Tab enters on the checked radio; right-to-left swaps Left and Right', () => {
    const radio = mounted(() =>
      createRadioGroup({ values: ['a', 'b', 'c'], defaultValue: 'c', dir: 'rtl', id: 'r' }),
    );
    act(() => radio.focus());
    expect(radio.focused()).toBe(2);
    act(() => {
      radio.keyDown('ArrowLeft');
    });
    expect(radio.checked()).toBe(0);
  });

  it('Tab leaves the group through the shared manager', () => {
    const focus = createFocus();
    const radio = mounted(() =>
      createRadioGroup({ values: ['a', 'b'], id: 'r', focus }),
    );
    focus.register('after');
    act(() => radio.focus());
    act(() => {
      radio.keyDown('Tab');
    });
    expect(focus.focused()).toBe('after');
    expect(radio.focused()).toBe(null);
  });

  it('reports focus moves through onFocus and onBlur, in that order', () => {
    const calls: string[] = [];
    const radio = mounted(() =>
      createRadioGroup({
        values: ['a', 'b'],
        id: 'r',
        onFocus: (target) => calls.push(`focus ${target}`),
        onBlur: (target) => calls.push(`blur ${target}`),
      }),
    );
    act(() => radio.radios[0]?.focus());
    act(() => {
      radio.keyDown('ArrowRight');
    });
    expect(calls).toEqual(['focus radio:0', 'blur radio:0', 'focus radio:1']);
  });
});

describe('tabs in the focus manager', () => {
  it('automatic activation selects on the arrow; manual waits for Enter', () => {
    const auto = mounted(() => createTabs({ items: 3, id: 'a' }));
    act(() => auto.focusTab(0));
    act(() => {
      auto.keyDown('ArrowRight');
    });
    expect(auto.selected()).toBe(1);

    const manual = mounted(() =>
      createTabs({ items: 3, id: 'm', activation: 'manual' }),
    );
    act(() => manual.focusTab(0));
    act(() => {
      manual.keyDown('ArrowRight');
    });
    expect([manual.focused(), manual.selected()]).toEqual([1, 0]);
    act(() => {
      manual.keyDown('Enter');
    });
    expect(manual.selected()).toBe(1);
  });

  it('Home and End go to the first and last enabled tab; arrows wrap', () => {
    const tabs = mounted(() =>
      createTabs({ items: 4, disabled: [0, 3], id: 't' }),
    );
    act(() => tabs.focusTab(1));
    act(() => {
      tabs.keyDown('End');
    });
    expect(tabs.focused()).toBe(2);
    act(() => {
      tabs.keyDown('ArrowRight');
    });
    expect(tabs.focused()).toBe(1);
  });

  it('Tab into the tablist lands on the selected tab, and Tab leaves to the selected panel', () => {
    const tabs = mounted(() => createTabs({ items: 3, defaultSelected: 2, id: 't' }));
    act(() => {
      tabs.tablist.keyDown?.('Tab');
    });
    expect(tabs.focused()).toBe(2);
    act(() => {
      tabs.keyDown('Tab');
    });
    expect(tabs.focused()).toBe(-1);
    expect(tabs.panels[2]?.focused).toBe(true);
  });
});

describe('toolbar in the focus manager', () => {
  it('Enter and Space activate a button, not a text item', () => {
    const activated: number[] = [];
    const toolbar = mounted(() =>
      createToolbar({
        items: ['button', 'text'],
        kinds: ['button', 'text'],
        id: 'tb',
        onActivate: (index) => activated.push(index),
      }),
    );
    act(() => toolbar.focusIn());
    act(() => {
      toolbar.keyDown('Enter');
    });
    act(() => {
      toolbar.focusItem(1);
      toolbar.keyDown(' ');
    });
    expect(activated).toEqual([0]);
  });

  it('a text item keeps the arrows of its axis; Tab steps to the neighbour instead of leaving', () => {
    const toolbar = mounted(() =>
      createToolbar({
        items: ['text', 'button', 'button'],
        kinds: ['text', 'button', 'button'],
        id: 'tb',
      }),
    );
    act(() => toolbar.focusIn());
    act(() => {
      toolbar.keyDown('ArrowRight');
    });
    expect(toolbar.focus()).toBe(0);
    act(() => {
      toolbar.tab(false);
    });
    expect(toolbar.focus()).toBe(1);
  });

  it('wraps only when asked; Tab from a plain item leaves the toolbar', () => {
    const toolbar = mounted(() =>
      createToolbar({ items: ['a', 'b'], id: 'tb', wrap: false }),
    );
    act(() => toolbar.focusItem(1));
    act(() => {
      toolbar.keyDown('ArrowRight');
    });
    expect(toolbar.focus()).toBe(1);
    act(() => toolbar.setWrap(true));
    act(() => {
      toolbar.keyDown('ArrowRight');
    });
    expect(toolbar.focus()).toBe(0);
    act(() => {
      toolbar.keyDown('Tab');
    });
    expect(toolbar.focus()).toBe(-1);
  });

  it('a disabled item stays focusable and is not activated', () => {
    const activated: number[] = [];
    const toolbar = mounted(() =>
      createToolbar({
        items: ['a', 'b'],
        id: 'tb',
        disabled: [0],
        onActivate: (index) => activated.push(index),
      }),
    );
    act(() => toolbar.focusIn());
    expect(toolbar.focus()).toBe(0);
    act(() => {
      toolbar.keyDown('Enter');
    });
    expect(activated).toEqual([]);
    expect(toolbar.items[0]?.disabled).toBe(true);
  });

  it('Tab back in lands on the item focused last', () => {
    const toolbar = mounted(() => createToolbar({ items: ['a', 'b', 'c'], id: 'tb' }));
    act(() => toolbar.focusItem(2));
    act(() => toolbar.leave());
    act(() => toolbar.focusIn());
    expect(toolbar.focus()).toBe(2);
  });
});

describe('slider in the focus manager', () => {
  it('PageUp and PageDown move by largeStep; Home and End go to the ends', () => {
    const slider = mounted(() => createSlider({ defaultValue: 5, id: 's' }));
    act(() => slider.focus());
    act(() => {
      slider.keyDown('PageUp');
    });
    expect(slider.value()).toBe(8);
    act(() => {
      slider.keyDown('PageDown');
      slider.keyDown('Home');
    });
    expect(slider.value()).toBe(0);
    act(() => {
      slider.keyDown('End');
    });
    expect(slider.value()).toBe(10);
  });

  it('arrows move by step and a rail press lands on a step; the spec fixes step 1, so this is the only check of it', () => {
    const slider = mounted(() =>
      createSlider({ min: 0, max: 10, step: 2, defaultValue: 4, id: 's' }),
    );
    act(() => slider.focus());
    act(() => {
      slider.keyDown('ArrowRight');
    });
    expect(slider.value()).toBe(6);
    act(() => slider.pointer(0.33));
    expect(slider.value()).toBe(4);
  });

  it('a rail press sets the value at the ratio and focuses the thumb', () => {
    const slider = mounted(() => createSlider({ id: 's' }));
    act(() => slider.pointer(0.5));
    expect([slider.value(), slider.focused()]).toEqual([5, true]);
  });

  it('valueText is the option; the default says low, medium or high', () => {
    const slider = mounted(() =>
      createSlider({ defaultValue: 2, valueText: (value) => `${value} of ten`, id: 's' }),
    );
    expect(slider.thumb.valueText).toBe('2 of ten');
    const plain = mounted(() => createSlider({ defaultValue: 9, id: 'p' }));
    expect(plain.thumb.valueText).toBe('high');
  });

  it('a key only moves the value while the thumb has focus', () => {
    const slider = mounted(() => createSlider({ defaultValue: 5, id: 's' }));
    expect(slider.keyDown('ArrowRight')).toBe(false);
    expect(slider.value()).toBe(5);
  });
});

describe('one focus manager for a page', () => {
  it('Tab crosses from the tabs into the toolbar, and disposing removes the entries', () => {
    const focus = createFocus();
    let dispose = (): void => {};
    const tabs = createRoot((done) => {
      dispose = done;
      return createTabs({ items: 2, id: 't', focus });
    });
    const toolbar = createRoot(() =>
      createToolbar({ items: ['a'], id: 'tb', focus }),
    );
    // the selected panel (0) is the next stop after the tabs; a second Tab from it reaches the toolbar
    act(() => tabs.focusTab(1));
    act(() => {
      tabs.keyDown('Tab');
    });
    expect(focus.focused()).toBe('t-tabpanel-0');
    act(() => {
      tabs.panels[0]?.keyDown('Tab');
    });
    expect(focus.focused()).toBe('tb-item-0');
    expect(toolbar.focus()).toBe(0);
    expect(tabs.focused()).toBe(-1);

    dispose();
    expect(focus.tabOrder()).toEqual(['tb-item-0']);
  });
});
