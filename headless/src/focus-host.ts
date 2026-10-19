import { type Focus, type Key, createFocus } from '../../focus/src/focus';
import { type Accessor, createSignal, getOwner, onCleanup } from 'solid-js';

/** Runs `cleanup` when the primitive's owner is disposed; nothing when it has none. */
export const whenDisposed = (cleanup: () => void): void => {
  if (getOwner() !== null) {
    onCleanup(cleanup);
  }
};

/** The keys the focus manager's Tab and arrows own, and the ones it moves focus with. */
export type MoveKey = Exclude<Key, 'Tab' | 'Shift+Tab'>;

const MOVE_KEYS: ReadonlySet<string> = new Set<MoveKey>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

export const moveKey = (key: string): MoveKey | undefined =>
  MOVE_KEYS.has(key) ? (key as MoveKey) : undefined;

/** Tab or Shift+Tab: a part that has focus hands them to the manager, which leaves its group. */
export const tabKey = (key: string): 'Tab' | 'Shift+Tab' | undefined =>
  key === 'Tab' || key === 'Shift+Tab' ? key : undefined;

export interface FocusHost {
  /** The manager the primitive registers its items with: the host's, shared with other widgets, or a private one. */
  readonly manager: Focus;
  /**
   * Read it inside a getter: it changes whenever focus moves or a registration of the primitive changes. The manager
   * is plain TypeScript, so this is what tells a Solid reader to read again; the reads themselves are fresh.
   */
  readonly version: Accessor<number>;
  /** A change of the primitive's own state the manager does not see (a selection, a disabled item). */
  readonly changed: () => void;
}

/**
 * The seam between a primitive and the focus manager (`focus/`). Logic reads the manager directly (`focused()`,
 * `tabOrder()`), never a signal, because a Solid 2 setter lands on the next flush; `version` only says "read again".
 */
export const createFocusHost = (manager: Focus = createFocus()): FocusHost => {
  const [version, setVersion] = createSignal(0);
  const changed = (): void => {
    setVersion((count) => count + 1);
  };
  whenDisposed(manager.onChange(changed));
  return { manager, version, changed };
};
