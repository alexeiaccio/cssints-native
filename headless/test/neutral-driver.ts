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
  readonly checked?: boolean | 'mixed';
  readonly pressed?: boolean | undefined;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly controls?: string;
  readonly hidden?: boolean;
  readonly focused?: boolean;
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
}

const flag = (value: boolean | undefined): string | null =>
  value === true ? 'true' : null;
const token = (value: boolean | 'mixed' | undefined): string | null =>
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
          const part = partOf(step.target);
          const key = step.key ?? '';
          if (part.focused !== true) {
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
        switch (name) {
          case 'role':
            return part.role ?? null;
          case 'aria-checked':
            return token(part.checked);
          case 'aria-pressed':
            return token(part.pressed);
          case 'aria-expanded':
            return token(part.expanded);
          case options.disabledAttr:
            return flag(part.disabled);
          case 'aria-readonly':
            return flag(part.readOnly);
          case 'hidden':
            return flag(part.hidden);
          case 'aria-controls': {
            const controlled = Object.keys(mounted.parts).find(
              (key) => mounted.parts[key]?.id === part.controls,
            );
            // a reference reads back as the part it names, `name:index`
            return controlled === undefined
              ? (part.controls ?? null)
              : controlled.includes(':')
                ? controlled
                : `${controlled}:0`;
          }
          default:
            return null;
        }
      },
      visible: () =>
        Object.keys(mounted.parts).filter(
          (name) => mounted.parts[name]?.hidden === false,
        ),
      events: (name) => mounted.events.get(canonical(name)) ?? [],
      ...(mounted.value === undefined ? {} : { value: mounted.value }),
    },
    dispose: mounted.dispose,
  };
};
