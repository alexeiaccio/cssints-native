import { describe, expect, it } from 'bun:test';
import { createRoot, flush } from 'solid-js';
import { createFocus } from '../../focus/src/focus';
import { createTree } from '../src/tree';

/**
 * What the walks and the scenarios do not reach: the expand/collapse side
 * effects (hidden subtrees, group membership), Tab in and out, the roving
 * cursor across a blur, and multi-select without a DOM to deliver modifiers.
 * Every call is followed by `flush()`, as a host's event is its own tick.
 */
const mounted = <T>(make: () => T): T => createRoot(() => make());
const act = (run: () => void): void => {
  run();
  flush();
};
const ids = (list: ReadonlyArray<number>): ReadonlyArray<number> =>
  [...list].sort((a, b) => a - b);

describe('tree expansion', () => {
  it('shows and hides the subtree and reports each change once', () => {
    const changed: number[] = [];
    const tree = mounted(() =>
      createTree({ id: 't', onExpandedChange: (node) => changed.push(node.id) }),
    );
    expect(tree.item(1).expanded).toBe(false);
    expect(tree.item(2).hidden).toBe(true);
    expect(tree.item(2).expanded).toBe(false);
    // an end node has no aria-expanded at all
    expect(tree.item(3).expanded).toBeUndefined();

    act(() => tree.expand(1));
    expect(tree.item(1).expanded).toBe(true);
    expect(tree.item(2).hidden).toBe(false);
    // 2 is open, so its children 3 and 4 are still hidden
    expect(tree.item(3).hidden).toBe(true);
    expect(tree.item(3).level).toBe(3);
    expect(tree.item(3).posInSet).toBe(1);
    expect(tree.item(3).setSize).toBe(2);

    act(() => tree.collapse(1));
    expect(tree.item(2).hidden).toBe(true);
    // a second collapse and a collapse of a leaf change nothing
    act(() => tree.collapse(1));
    act(() => tree.collapse(3));
    expect(changed).toEqual([1, 1]);
  });

  it('never opens a leaf', () => {
    const tree = mounted(() => createTree({ id: 't' }));
    act(() => tree.toggleExpanded(3));
    expect(tree.expanded()).toEqual([]);
  });
});

describe('tree in the focus manager', () => {
  it('keeps a collapsed subtree out of the group', () => {
    const focus = createFocus();
    const tree = mounted(() =>
      createTree({ id: 't', defaultExpanded: [1], focus }),
    );
    act(() => tree.item(1).focus());
    act(() => tree.keyDown('ArrowDown'));
    expect(focus.focused()).toBe(tree.item(2).id);
    // 2 is closed, so Down skips Roadmap/Summary and lands on Notes
    act(() => tree.keyDown('ArrowDown'));
    expect(focus.focused()).toBe(tree.item(5).id);
    act(() => tree.keyDown('ArrowUp'));
    expect(focus.focused()).toBe(tree.item(2).id);

    // collapse Projects while it holds focus: Up/Down now skip its children
    act(() => tree.item(1).focus());
    act(() => tree.collapse(1));
    act(() => tree.keyDown('ArrowDown'));
    expect(focus.focused()).toBe(tree.item(6).id);
  });

  it('Right opens, Right again steps in, Left steps out, Left closes', () => {
    const focus = createFocus();
    const tree = mounted(() => createTree({ id: 't', focus }));
    act(() => tree.item(1).focus());
    act(() => tree.keyDown('ArrowRight'));
    expect(tree.item(1).expanded).toBe(true);
    expect(focus.focused()).toBe(tree.item(1).id);
    act(() => tree.keyDown('ArrowRight'));
    expect(focus.focused()).toBe(tree.item(2).id);
    act(() => tree.keyDown('ArrowLeft'));
    expect(focus.focused()).toBe(tree.item(1).id);
    act(() => tree.keyDown('ArrowLeft'));
    expect(tree.item(1).expanded).toBe(false);
    expect(focus.focused()).toBe(tree.item(1).id);
  });

  it('Tab enters on the first selected visible item and leaves the group', () => {
    const focus = createFocus();
    const tree = mounted(() =>
      createTree({
        id: 't',
        defaultExpanded: [1],
        defaultSelected: [2],
        focus,
      }),
    );
    focus.register('after');
    act(() => {
      tree.tree.keyDown('Tab');
    });
    expect(focus.focused()).toBe(tree.item(2).id);
    act(() => {
      tree.item(2).keyDown('Tab');
    });
    expect(focus.focused()).toBe('after');

    // without a selection, the first visible item is the tab stop
    const plain = mounted(() => createTree({ id: 'p', focus }));
    act(() => {
      plain.tree.keyDown('Tab');
    });
    expect(focus.focused()).toBe(plain.item(1).id);
  });

  it('a blur keeps the roving node, which focus() restores (the spec rule)', () => {
    const focus = createFocus();
    const tree = mounted(() =>
      createTree({
        id: 't',
        defaultExpanded: [1],
        defaultSelected: [2],
        focus,
      }),
    );
    act(() => tree.item(6).focus());
    act(() => tree.tree.blur());
    expect(tree.hasFocus()).toBe(false);
    expect(tree.focus()).toBe(6);
    act(() => tree.tree.focus());
    // APG would focus the selected node here; the spec keeps the roving one
    expect(focus.focused()).toBe(tree.item(6).id);
    expect(tree.item(6).tabIndex).toBe(0);
    expect(tree.item(2).tabIndex).toBe(-1);
  });

  it('a hidden item cannot take focus, be clicked, or take a key', () => {
    const tree = mounted(() => createTree({ id: 't' }));
    act(() => tree.item(3).focus());
    expect(tree.hasFocus()).toBe(false);
    act(() => tree.item(3).press());
    expect(tree.selected()).toEqual([]);
    expect(tree.item(3).keyDown('Enter')).toBe(false);
  });

  it('unregisters its items when disposed', () => {
    const focus = createFocus();
    const dispose = createRoot((stop) => {
      createTree({ id: 't', focus });
      return stop;
    });
    expect(focus.focus('t-item-1')).toBe(true);
    act(() => dispose());
    expect(focus.focus('t-item-1')).toBe(false);
  });
});

describe('tree selection', () => {
  it('a single-select request replaces the selection; a repeat is silent', () => {
    const changes: number[][] = [];
    const tree = mounted(() =>
      createTree({
        id: 't',
        defaultExpanded: [1, 2],
        onValueChange: (selected) => changes.push([...selected]),
      }),
    );
    act(() => tree.select(3));
    expect(ids(tree.selected())).toEqual([3]);
    act(() => tree.select(4));
    expect(ids(tree.selected())).toEqual([4]);
    act(() => tree.select(4));
    expect(changes).toEqual([[3], [4]]);
  });

  it('a controlled request reports its intent while the host holds the value', () => {
    const changes: number[][] = [];
    const picked: number[] = [];
    const tree = mounted(() =>
      createTree({
        id: 't',
        value: [],
        onValueChange: (selected) => changes.push([...selected]),
        onSelectionChange: (node) => picked.push(node.id),
      }),
    );
    act(() => tree.select(3));
    expect(tree.selected()).toEqual([]);
    expect(changes).toEqual([[3]]);
    expect(picked).toEqual([3]);
  });

  it('multi-select toggles on Space, Shift+Arrow and Control+A', () => {
    const tree = mounted(() =>
      createTree({ id: 't', selection: 'multiple', defaultExpanded: [1] }),
    );
    act(() => tree.item(1).focus());
    act(() => tree.keyDown('Shift+ArrowDown'));
    expect(ids(tree.selected())).toEqual([2]);
    act(() => tree.keyDown(' '));
    expect(ids(tree.selected())).toEqual([]);
    act(() => tree.keyDown('Control+a'));
    expect(ids(tree.selected())).toEqual([1, 2, 3, 4, 5, 6, 7]);
    act(() => tree.keyDown('Control+a'));
    expect(ids(tree.selected())).toEqual([]);
  });

  it('a single-select tree never accumulates in multi-select keys', () => {
    const tree = mounted(() => createTree({ id: 't', defaultExpanded: [1] }));
    act(() => tree.item(1).focus());
    act(() => tree.keyDown('Shift+ArrowDown'));
    // no selection on the move; Space then Enter replace it
    expect(tree.selected()).toEqual([]);
    act(() => tree.keyDown(' '));
    act(() => tree.keyDown('Enter'));
    expect(tree.selected()).toEqual([2]);
  });
});
