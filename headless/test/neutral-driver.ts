import {
  type ActionStep,
  type Driver,
  type Json,
  Unsupported,
} from '../vendor/specs/src/scenario';
import { flush } from 'solid-js';

/**
 * The neutral side of the scenario bridge, the analogue of eoa's `dom-driver`.
 * A pattern's mount returns the primitive's parts keyed by scenario target
 * (`switch`, `trigger`, `panel`, `trigger:1`); this turns scenario steps into
 * handler calls and reads the probe (aria-like attributes, focus, visibility)
 * back from the parts' plain fields. No document, no events, no elements.
 */
export interface NeutralPart {
  readonly id: string;
  readonly role?: string;
  readonly label?: string | undefined;
  readonly checked?: boolean | 'mixed' | undefined;
  readonly pressed?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  /** `aria-haspopup`: the kind of popup a button opens (`"dialog"`, `"menu"`). */
  readonly hasPopup?: string | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly multiSelectable?: boolean | undefined;
  readonly level?: number | undefined;
  readonly posInSet?: number | undefined;
  readonly setSize?: number | undefined;
  readonly controls?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly hidden?: boolean | undefined;
  readonly focused?: boolean | undefined;
  /** `tabindex`: 0 in the tab order, -1 out of it; absent when the part has none. */
  readonly tabIndex?: number | undefined;
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
  readonly valueNow?: number | undefined;
  readonly valueMin?: number | undefined;
  readonly valueMax?: number | undefined;
  readonly valueText?: string | undefined;
  readonly press?: () => void;
  readonly keyDown?: (key: string, repeat?: boolean) => boolean;
  readonly keyUp?: (key: string) => boolean;
  readonly focus?: () => void;
  readonly blur?: () => void;
}

export interface Mounted {
  readonly parts: Readonly<Record<string, NeutralPart>>;
  /** Apply a scenario `prop` step (programmatic input) to the mounted widget. */
  readonly setProp: (name: string, value: Json | undefined) => void;
  /** Callback payloads, recorded under their canonical name. */
  readonly events: ReadonlyMap<string, ReadonlyArray<Json>>;
  readonly value?: () => Json;
  readonly dispose: () => void;
}

export interface NeutralDriverOptions {
  readonly eventName?: (name: string) => string;
  /**
   * A part has one `disabled` flag; the attribute that spells it is the
   * platform's. The probe reads it under this name only, as the eoa primitives
   * did: aria-disabled for button, switch and checkbox, the native `disabled`
   * for the disclosure trigger.
   */
  readonly disabledAttr: 'aria-disabled' | 'disabled';
  /**
   * `flag` (default): the attribute is `true` or absent. `token`: it is `true` or `false`, as eoa's radio wrote it.
   */
  readonly disabledReads?: 'flag' | 'token';
  /**
   * Where a `key` step goes. `target` (default): the target part, focused first, as a user's press on it would.
   * `focused`: to whichever part holds focus, the target only when none does; the tabs spec routes keys through
   * its own focus cursor, so a key step's target names nothing it acts on (as eoa's tabs driver does).
   */
  readonly keys?: 'target' | 'focused';
  /**
   * `cumulative` (default): `events(name)` is everything since mount, as the spec driver reports it. `consumed`:
   * only what is new since the previous read, as eoa's DOM driver reported it (the treeview scenarios were
   * written against that).
   */
  readonly readEvents?: 'cumulative' | 'consumed';
  /**
   * The parts that can be shown and hidden, as eoa's DOM driver named them (`hideableParts`). `visible` lists these
   * that are not hidden; every other part is content whose presence is not the pattern's visible state (a dialog's
   * backdrop, an outside button). Absent: every part that carries `hidden`.
   */
  readonly hideable?: ReadonlyArray<string>;
}

const flag = (value: boolean | undefined): string | null =>
  value === true ? 'true' : null;
const token = (value: boolean | 'mixed' | undefined): string | null =>
  value === undefined ? null : String(value);
const number = (value: number | undefined): string | null =>
  value === undefined ? null : String(value);

export const neutralDriver = (
  mounted: Mounted,
  options: NeutralDriverOptions,
): Driver => {
  const canonical = options.eventName ?? ((name: string) => name);

  const targetOf = (target: string): string | undefined => {
    const stripped = target.replace(/:0$/, '');
    return [target, stripped, `${stripped}:0`].find(
      (name) => mounted.parts[name] !== undefined,
    );
  };
  const partOf = (target: string | undefined): NeutralPart => {
    const found = targetOf(target ?? '');
    const part = found === undefined ? undefined : mounted.parts[found];
    if (part === undefined) {
      throw new Unsupported(`part ${target ?? ''}`);
    }
    return part;
  };

  // Solid applies setters on the next flush; every handler call is its own
  // tick, as every input event of a real host would be.
  const call = (run: () => void): void => {
    run();
    flush();
  };
  const focus = (part: NeutralPart): void => {
    call(() => part.focus?.());
  };
  const click = (part: NeutralPart): void => {
    focus(part);
    call(() => part.press?.());
  };
  const consumed = new Map<string, number>();

  return {
    perform: (step: ActionStep) => {
      switch (step.event) {
        case 'focus':
          focus(partOf(step.target));
          break;
        case 'blur':
          call(() => partOf(step.target).blur?.());
          break;
        case 'click':
          click(partOf(step.target));
          break;
        case 'pointerdown':
          focus(partOf(step.target));
          break;
        case 'pointerup':
          call(() => partOf(step.target).press?.());
          break;
        case 'pointercancel':
        case 'hover':
        case 'unhover':
          break;
        case 'key': {
          const key = step.key ?? '';
          const holder =
            options.keys === 'focused'
              ? Object.keys(mounted.parts)
                  .map((name) => mounted.parts[name])
                  .find((part) => part?.focused === true)
              : undefined;
          // A half press is one event only: `down` focuses and keyDowns, `up`
          // keyUps wherever focus is now and deliberately does not re-focus, so
          // a keydown -> blur -> keyup walk reaches the part after the blur.
          if (step.phase === 'down') {
            const part = holder ?? partOf(step.target);
            if (part.focused !== true) {
              focus(part);
            }
            call(() => part.keyDown?.(key));
            break;
          }
          if (step.phase === 'up') {
            const part = holder ?? partOf(step.target);
            call(() => part.keyUp?.(key));
            break;
          }
          const part = holder ?? partOf(step.target);
          if (options.keys !== 'focused' && part.focused !== true) {
            focus(part);
          }
          call(() => part.keyDown?.(key));
          call(() => part.keyUp?.(key));
          break;
        }
        case 'prop':
          if (step.set !== undefined) {
            for (const [name, value] of Object.entries(step.set)) {
              mounted.setProp(name, value);
            }
          } else {
            mounted.setProp(step.prop ?? '', step.value);
          }
          flush();
          break;
        default:
          throw new Unsupported(`event ${step.event}`);
      }
    },
    observer: {
      focus: () =>
        Object.keys(mounted.parts).find(
          (name) => mounted.parts[name]?.focused === true,
        ) ?? null,
      // The fields an aria-* attribute carried; what a part has no field for is
      // absent, like an attribute never set.
      attr: (target, name) => {
        if (name.startsWith('data-')) {
          throw new Unsupported(`styling hook ${name}`);
        }
        const part = partOf(target);
        // an id reference reads back as the part it names, `name:index`
        const ref = (id: string | undefined): string | null => {
          const named = Object.keys(mounted.parts).find(
            (key) => mounted.parts[key]?.id === id,
          );
          if (named === undefined) {
            return id ?? null;
          }
          return named.includes(':') ? named : `${named}:0`;
        };
        switch (name) {
          case 'role':
            return part.role ?? null;
          case 'aria-label':
            return part.label ?? null;
          case 'aria-checked':
            return token(part.checked);
          case 'aria-pressed':
            return token(part.pressed);
          case 'aria-expanded':
            return token(part.expanded);
          case 'aria-haspopup':
            return part.hasPopup ?? null;
          case 'aria-selected':
            return token(part.selected);
          case 'aria-multiselectable':
            return token(part.multiSelectable);
          case 'aria-level':
            return number(part.level);
          case 'aria-posinset':
            return number(part.posInSet);
          case 'aria-setsize':
            return number(part.setSize);
          case options.disabledAttr:
            return options.disabledReads === 'token'
              ? token(part.disabled)
              : flag(part.disabled);
          case 'aria-readonly':
            return flag(part.readOnly);
          case 'hidden':
            return flag(part.hidden);
          case 'tabindex':
            return number(part.tabIndex);
          case 'aria-orientation':
            return part.orientation ?? null;
          case 'aria-valuenow':
            return number(part.valueNow);
          case 'aria-valuemin':
            return number(part.valueMin);
          case 'aria-valuemax':
            return number(part.valueMax);
          case 'aria-valuetext':
            return part.valueText ?? null;
          case 'aria-controls':
            return ref(part.controls);
          case 'aria-labelledby':
            return ref(part.labelledBy);
          case 'aria-describedby':
            return part.describedBy ?? null;
          default:
            return null;
        }
      },
      visible: () => {
        const names = options.hideable ?? Object.keys(mounted.parts);
        return names.filter((name) => mounted.parts[name]?.hidden === false);
      },
      events: (name) => {
        const fired = mounted.events.get(canonical(name)) ?? [];
        if (options.readEvents !== 'consumed') {
          return fired;
        }
        const seen = consumed.get(name) ?? 0;
        consumed.set(name, fired.length);
        return fired.slice(seen);
      },
      ...(mounted.value === undefined ? {} : { value: mounted.value }),
    },
    dispose: mounted.dispose,
  };
};
