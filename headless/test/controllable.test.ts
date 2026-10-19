import { describe, expect, it } from 'bun:test';
import { createSignal, flush } from 'solid-js';
import { createButton } from '../src/button';
import { createControllable } from '../src/controllable';
import { createDisclosure } from '../src/disclosure';

describe('Solid build', () => {
  // bun and node resolve solid-js to its server build unless run with
  // `--conditions browser`; there a setter applies at once and nothing below is
  // a test of what the Clay renderer will run.
  it('is the client build: a setter applies on flush', () => {
    const [value, setValue] = createSignal(1);
    setValue(2);
    expect(value()).toBe(1);
    flush();
    expect(value()).toBe(2);
  });
});

describe('createControllable (request vs commit)', () => {
  it('uncontrolled: a request commits at once and calls onChange', () => {
    const calls: boolean[] = [];
    const [value, request] = createControllable<boolean>({
      value: () => undefined,
      initial: false,
      onChange: () => (next) => calls.push(next),
    });
    request(true);
    expect(value()).toBe(true);
    request(true);
    expect(calls).toEqual([true]);
  });

  it('controlled: a request only calls onChange; the value prop is the commit', () => {
    const [host, setHost] = createSignal(false);
    const calls: boolean[] = [];
    const [value, request] = createControllable<boolean>({
      value: host,
      initial: false,
      onChange: () => (next) => calls.push(next),
    });
    request(true);
    flush();
    expect(value()).toBe(false);
    expect(calls).toEqual([true]);
    setHost(true);
    flush();
    expect(value()).toBe(true);
  });
});

describe('parts', () => {
  it('a disclosure part is plain fields and handlers', () => {
    const disclosure = createDisclosure({ id: 'd' });
    const { trigger, panel } = disclosure;
    expect([trigger.id, panel.id, trigger.controls]).toEqual([
      'd-trigger',
      'd-panel',
      'd-panel',
    ]);
    expect(panel.hidden).toBe(true);
    trigger.press();
    flush();
    expect(trigger.expanded).toBe(true);
    expect(panel.hidden).toBe(false);
  });

  it('Space arms on key down, fires on key up, and a blur drops it', () => {
    const clicks: number[] = [];
    const { part } = createButton({ onClick: () => clicks.push(1) });
    expect(part.keyDown(' ')).toBe(true);
    expect(clicks).toEqual([]);
    expect(part.keyUp(' ')).toBe(true);
    expect(clicks).toEqual([1]);
    part.keyDown('Space');
    part.blur();
    expect(part.keyUp('Space')).toBe(false);
    expect(clicks).toEqual([1]);
  });

  it('a key the part does not use is left to the host', () => {
    const { part } = createButton();
    expect(part.key('ArrowDown')).toBe(false);
    expect(part.key('Enter')).toBe(true);
  });
});
