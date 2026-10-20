import { describe, expect, it } from 'bun:test';
import { createRoot, createSignal, flush } from 'solid-js';
import { createTextField } from '../src/textfield';

/**
 * The text field is not a port, so nothing generated checks it: these are the
 * rules it has. Every handler call is followed by `flush()`, as a host's event
 * is its own tick.
 */
const mounted = <T>(make: () => T): T => createRoot(() => make());
const act = (run: () => void): void => {
  run();
  flush();
};

const field = (options: Parameters<typeof createTextField>[0] = {}) =>
  mounted(() => createTextField({ id: 'f', ...options }));

const typed = (f: ReturnType<typeof field>, text: string) =>
  act(() => {
    f.insert(text);
  });

describe('text field: typing', () => {
  it('inserts at the caret and leaves the caret after what went in', () => {
    const f = field({ defaultValue: 'ac' });
    act(() => f.setCaret(1));
    typed(f, 'b');
    expect([f.value(), f.caret()]).toEqual(['abc', 2]);
    act(() => f.keyDown('End'));
    typed(f, 'd');
    expect([f.value(), f.caret()]).toEqual(['abcd', 4]);
    act(() => f.setCaret(1));
    typed(f, 'X');
    expect([f.value(), f.caret()]).toEqual(['aXbcd', 2]);
  });

  it('inserts a whole run at the caret at once', () => {
    const f = field({ defaultValue: 'ad' });
    act(() => f.setCaret(1));
    typed(f, 'bc');
    expect([f.value(), f.caret()]).toEqual(['abcd', 3]);
  });

  it('calls onValueChange with the new text and nothing when it would not change', () => {
    const seen: string[] = [];
    const f = field({ defaultValue: 'a', onValueChange: (value) => seen.push(value) });
    act(() => f.setCaret(1));
    typed(f, 'b');
    typed(f, '');
    expect(seen).toEqual(['ab']);
  });

  it('clamps to maxLength and keeps the caret at the end of what it took', () => {
    const f = field({ defaultValue: 'abc', maxLength: 4 });
    act(() => f.setCaret(3));
    typed(f, 'def');
    expect([f.value(), f.caret()]).toEqual(['abcd', 4]);
    typed(f, 'z');
    expect(f.value()).toBe('abcd');
  });

  it('counts a maxLength in UTF-16 units and never cuts a surrogate pair', () => {
    const f = field({ maxLength: 2 });
    typed(f, 'ab😀');
    expect(f.value()).toBe('ab');
    typed(f, '😀😀');
    expect(f.value()).toBe('ab');
  });

  it('replaces the selection with what is typed', () => {
    const f = field({ defaultValue: 'hello' });
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
    });
    expect(f.selection()).toEqual({ start: 1, end: 4 });
    typed(f, 'i');
    expect([f.value(), f.caret(), f.selection()]).toEqual(['hio', 2, { start: 2, end: 2 }]);
  });

  it('keeps a read-only field from any edit, and a disabled one from any key', () => {
    const read = field({ defaultValue: 'fixed', readOnly: true });
    act(() => read.setCaret(2));
    expect(read.insert('x')).toBe(false);
    expect(read.keyDown('Backspace')).toBe(false);
    expect(read.keyDown('Delete')).toBe(false);
    expect(read.value()).toBe('fixed');
    typed(read, 'x');
    expect(read.value()).toBe('fixed');
    expect(read.keyDown('ArrowRight')).toBe(true);
    expect(read.caret()).toBe(3);

    const off = field({ defaultValue: 'fixed', disabled: true });
    expect(off.part.editsText).toBe(false);
    expect(off.keyDown('ArrowRight')).toBe(false);
    expect(off.insert('x')).toBe(false);
  });
});

describe('text field: deleting', () => {
  it('Backspace removes the character before the caret', () => {
    const f = field({ defaultValue: 'abc' });
    act(() => f.setCaret(2));
    expect(f.keyDown('Backspace')).toBe(true);
    expect([f.value(), f.caret()]).toEqual(['ac', 1]);
  });

  it('Backspace at the start takes the key and does nothing', () => {
    const f = field({ defaultValue: 'abc' });
    act(() => f.setCaret(0));
    expect(f.keyDown('Backspace')).toBe(true);
    expect([f.value(), f.caret()]).toEqual(['abc', 0]);
  });

  it('Delete removes the character after the caret', () => {
    const f = field({ defaultValue: 'abc' });
    act(() => f.setCaret(1));
    expect(f.keyDown('Delete')).toBe(true);
    expect([f.value(), f.caret()]).toEqual(['ac', 1]);
  });

  it('Delete at the end takes the key and does nothing', () => {
    const f = field({ defaultValue: 'abc' });
    act(() => f.setCaret(3));
    expect(f.keyDown('Delete')).toBe(true);
    expect(f.value()).toBe('abc');
  });

  it('either key removes the whole selection', () => {
    const f = field({ defaultValue: 'abcdef' });
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
    });
    expect(f.keyDown('Delete')).toBe(true);
    expect([f.value(), f.caret(), f.selection()]).toEqual(['aef', 1, { start: 1, end: 1 }]);
  });
});

describe('text field: caret and selection', () => {
  it('Home and End go to the ends, and collapse a selection first', () => {
    const f = field({ defaultValue: 'abc' });
    act(() => f.keyDown('End'));
    expect(f.caret()).toBe(3);
    act(() => f.keyDown('Home'));
    expect([f.caret(), f.selection()]).toEqual([0, { start: 0, end: 0 }]);
    act(() => f.keyDown('ArrowRight'));
    expect(f.caret()).toBe(1);
    act(() => f.keyDown('ArrowLeft'));
    expect(f.caret()).toBe(0);
  });

  it('the arrows stop at the ends', () => {
    const f = field({ defaultValue: 'ab' });
    act(() => {
      f.keyDown('ArrowLeft');
      f.keyDown('ArrowLeft');
    });
    expect(f.caret()).toBe(0);
    act(() => {
      f.keyDown('End');
      f.keyDown('ArrowRight');
    });
    expect(f.caret()).toBe(2);
  });

  it('an arrow collapses a selection to the near end', () => {
    const f = field({ defaultValue: 'abcd' });
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
    });
    expect(f.selection()).toEqual({ start: 1, end: 3 });
    act(() => f.keyDown('ArrowLeft'));
    expect([f.caret(), f.selection()]).toEqual([1, { start: 1, end: 1 }]);
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
      f.keyDown('ArrowRight');
    });
    expect([f.caret(), f.selection()]).toEqual([3, { start: 3, end: 3 }]);
  });

  it('Shift with the arrows extends from the anchor both ways', () => {
    const f = field({ defaultValue: 'abcd' });
    act(() => f.setCaret(2));
    act(() => f.keyDown('Shift+ArrowLeft'));
    expect([f.caret(), f.selection()]).toEqual([1, { start: 1, end: 2 }]);
    act(() => f.keyDown('Shift+ArrowLeft'));
    expect(f.selection()).toEqual({ start: 0, end: 2 });
    act(() => f.keyDown('Shift+ArrowRight'));
    expect(f.selection()).toEqual({ start: 1, end: 2 });
    act(() => f.keyDown('Shift+ArrowRight'));
    expect(f.selection()).toEqual({ start: 2, end: 2 });
    act(() => f.keyDown('Shift+ArrowRight'));
    expect(f.selection()).toEqual({ start: 2, end: 3 });
    act(() => f.keyDown('Shift+End'));
    expect(f.selection()).toEqual({ start: 2, end: 4 });
    act(() => f.keyDown('Shift+Home'));
    expect(f.selection()).toEqual({ start: 0, end: 2 });
  });

  it('reports the selection ordered whichever way it was made', () => {
    const f = field({ defaultValue: 'abcd' });
    act(() => {
      f.setCaret(3);
      f.keyDown('Shift+ArrowLeft');
      f.keyDown('Shift+ArrowLeft');
    });
    expect([f.caret(), f.selection()]).toEqual([1, { start: 1, end: 3 }]);
  });
});

describe('text field: focus, submit and the pointer', () => {
  it('focuses and blurs through the manager, and Escape blurs', () => {
    const f = field();
    expect(f.focused()).toBe(false);
    act(() => f.focus());
    expect([f.focused(), f.part.focused]).toEqual([true, true]);
    act(() => f.keyDown('Escape'));
    expect(f.focused()).toBe(false);
    act(() => f.focus());
    act(() => f.keyDown('Escape'));
    expect(f.focused()).toBe(false);
  });

  it('Enter submits the text once, and a key repeat does not submit again', () => {
    const sent: string[] = [];
    const f = field({ defaultValue: 'Ada', onSubmit: (value) => sent.push(value) });
    act(() => f.keyDown('Enter'));
    act(() => f.keyDown('Enter', true));
    expect(sent).toEqual(['Ada']);
  });

  it('places the caret from a press and clamps it to the text', () => {
    const f = field({ defaultValue: 'abcd' });
    act(() => f.press(0, 10));
    expect(f.caret()).toBe(0);
    act(() => f.press(14, 10));
    expect(f.caret()).toBe(1);
    act(() => f.press(16, 10));
    expect(f.caret()).toBe(2);
    act(() => f.press(400, 10));
    expect(f.caret()).toBe(4);
    act(() => f.press(-40, 10));
    expect(f.caret()).toBe(0);
    expect(f.focused()).toBe(true);
  });

  it('a press on an empty field stays at 0 and a press drops the selection', () => {
    const empty = field();
    act(() => empty.press(60, 10));
    expect(empty.caret()).toBe(0);

    const f = field({ defaultValue: 'abcd' });
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+End');
    });
    expect(f.selection()).toEqual({ start: 1, end: 4 });
    act(() => f.press(20, 10));
    expect(f.selection()).toEqual({ start: 2, end: 2 });
  });
});

describe('text field: clipboard and the controlled host', () => {
  it('copies and cuts the selection, and pastes at the caret', () => {
    const f = field({ defaultValue: 'hello' });
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+ArrowRight');
      f.keyDown('Shift+ArrowRight');
    });
    expect(f.clipboard('copy', '')).toBe('el');
    expect(f.value()).toBe('hello');
    expect(f.clipboard('cut', '')).toBe('el');
    expect([f.value(), f.caret()]).toEqual(['hlo', 1]);
    expect(f.clipboard('paste', 'ey')).toBe(null);
    expect([f.value(), f.caret()]).toEqual(['heylo', 3]);
    expect(f.clipboard('copy', '')).toBe(null);
  });

  it('a read-only field copies but does not cut or paste', () => {
    const f = field({ defaultValue: 'hello', readOnly: true });
    act(() => {
      f.setCaret(0);
      f.keyDown('Shift+End');
    });
    expect(f.clipboard('copy', '')).toBe('hello');
    expect(f.clipboard('cut', '')).toBe(null);
    expect(f.clipboard('paste', 'x')).toBe(null);
    expect(f.value()).toBe('hello');
  });

  it('a controlled host owns the text: the request arrives, the text stays until it is written', () => {
    const [value, setValue] = createSignal('ab');
    const asked: string[] = [];
    const f = mounted(() =>
      createTextField({
        id: 'c',
        get value() {
          return value();
        },
        onValueChange: (next) => {
          asked.push(next);
        },
      }),
    );
    act(() => f.setCaret(2));
    typed(f, 'c');
    expect(asked).toEqual(['abc']);
    expect(f.value()).toBe('ab');
    // the caret is at the end of what the host will show, once it writes the text it was asked for
    expect(f.caret()).toBe(2);
    act(() => setValue('abc'));
    expect([f.value(), f.caret()]).toEqual(['abc', 3]);
    act(() => setValue('a'));
    expect([f.caret(), f.selection()]).toEqual([1, { start: 1, end: 1 }]);
  });
});

describe('text field: the part', () => {
  it('carries role, the text, the caret, the selection and the text-field marker', () => {
    const f = field({ defaultValue: 'Ada' });
    act(() => {
      f.setCaret(1);
      f.keyDown('Shift+ArrowRight');
    });
    expect(f.part.role).toBe('textbox');
    expect(f.part.value).toBe('Ada');
    expect(f.part.valueText).toBe('Ada');
    expect(f.part.caret).toBe(2);
    expect(f.part.selection).toEqual({ start: 1, end: 2 });
    expect([f.part.tabIndex, f.part.editsText, f.part.disabled]).toEqual([0, true, false]);
  });

  it('marks a read-only field as one that takes no typed text', () => {
    const f = field({ readOnly: true });
    expect([f.part.readOnly, f.part.editsText]).toEqual([true, false]);
  });
});
