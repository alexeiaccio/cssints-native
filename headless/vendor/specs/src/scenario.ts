/**
 * The scenario bridge: one replay engine, two drivers.
 *
 * A scenario (`scenarios/apg/<pattern>.<source>.json`) is a list of user-level
 * steps and expectations. `replayScenario` runs it against any `Driver`:
 *
 *   - `specDriver`  — steps become spec events (via a per-pattern `SpecBridge`),
 *                     the generated reference model is stepped, every spec
 *                     invariant is checked after every step;
 *   - a DOM driver  — lives next to the implementation (packages/headless) and
 *                     performs the same steps on real elements.
 *
 * `differentialWalk` then drives both with the same seeded random steps and
 * compares their observations after each one, so the implementation is checked
 * far beyond the ported scenarios. Pure TypeScript, no DOM: it loads in both
 * Node and the browser.
 */
import {
  type QuintEvent,
  type QuintModelValue,
  type QuintReferenceModel,
  violatedInvariants,
} from '@eoa/quint-machine';
import { Schema } from 'effect';

// The vocabulary is documented in `scenarios/apg/README.md`. Fields named here
// are decoded and typed. Unknown keys are still kept, never stripped: a field
// the engine does not know must make the scenario unsupported, not silently
// replay as a different step.
const Rest = [Schema.Record(Schema.String, Schema.Json)] as const;

/** Expectation keys the replay engine checks against an `Observer`. */
const CHECKED_EXPECTATION_KEYS = new Set([
  'focus',
  'attrs',
  'visible',
  'value',
  'events',
]);

const Expectation = Schema.StructWithRest(
  Schema.Struct({
    focus: Schema.optionalKey(Schema.NullOr(Schema.String)),
    attrs: Schema.optionalKey(
      Schema.Record(
        Schema.String,
        Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
      ),
    ),
    visible: Schema.optionalKey(Schema.Array(Schema.String)),
    // Decoded but not yet checked: the engine reports them as skipped.
    hidden: Schema.optionalKey(Schema.Array(Schema.String)),
    checked: Schema.optionalKey(Schema.NullOr(Schema.String)),
    value: Schema.optionalKey(Schema.Json),
    events: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.Array(Schema.Json)),
    ),
  }),
  Rest,
);
type Expectation = typeof Expectation.Type;

/** Step fields every bridge understands; `ms` only ever rides on `wait`. */
const CORE_STEP_FIELDS = new Set([
  'event',
  'target',
  'key',
  'text',
  'prop',
  'value',
  'repeat',
  'ms',
]);

/**
 * Typed step fields a bridge must opt into (`SpecBridge.stepFields`): replaying
 * a step while ignoring one of these would test a different step.
 */
export const EXTENDED_STEP_FIELDS = [
  'position',
  'modifiers',
  'phase',
  'button',
  'buttons',
  'pointerType',
  'pointerId',
  'detail',
  'count',
  'canceled',
  'defaultPrevented',
  'isComposing',
  'inputEvent',
  'set',
] as const;
export type ExtendedStepField = (typeof EXTENDED_STEP_FIELDS)[number];

const Modifier = Schema.Literals(['Alt', 'Control', 'Meta', 'Shift']);
const PointerType = Schema.Literals(['mouse', 'pen', 'touch']);
const KeyPhase = Schema.Literals(['down', 'up']);

const ActionStep = Schema.StructWithRest(
  Schema.Struct({
    event: Schema.String,
    target: Schema.optionalKey(Schema.String),
    key: Schema.optionalKey(Schema.String),
    text: Schema.optionalKey(Schema.String),
    prop: Schema.optionalKey(Schema.String),
    value: Schema.optionalKey(Schema.Json),
    // `true`: one auto-repeat keydown; N: the key is held for N repeats.
    repeat: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Number])),
    ms: Schema.optionalKey(Schema.Number),
    position: Schema.optionalKey(Schema.Number),
    modifiers: Schema.optionalKey(Schema.Array(Modifier)),
    phase: Schema.optionalKey(KeyPhase),
    button: Schema.optionalKey(Schema.Number),
    buttons: Schema.optionalKey(Schema.Number),
    pointerType: Schema.optionalKey(PointerType),
    pointerId: Schema.optionalKey(Schema.Number),
    detail: Schema.optionalKey(Schema.Number),
    count: Schema.optionalKey(Schema.Number),
    canceled: Schema.optionalKey(Schema.Boolean),
    defaultPrevented: Schema.optionalKey(Schema.Boolean),
    isComposing: Schema.optionalKey(Schema.Boolean),
    inputEvent: Schema.optionalKey(Schema.String),
    set: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  }),
  Rest,
);
export type ActionStep = typeof ActionStep.Type;

const ExpectStep = Schema.Struct({ expect: Expectation });
type ExpectStep = typeof ExpectStep.Type;

// An action carries `event`; anything else is an expectation. A step with both
// decodes as an action whose `expect` is an unknown field, so it is unsupported
// instead of having its action dropped.
const Step = Schema.Union([ActionStep, ExpectStep]);
type Step = typeof Step.Type;
const isExpectStep = (step: Step): step is ExpectStep => !('event' in step);

export type Json = Schema.Json;

export interface ScenarioConfig {
  readonly [key: string]: Schema.Json;
}

const Scenario = Schema.Struct({
  id: Schema.String,
  upstream: Schema.optionalKey(Schema.String),
  upstreamTest: Schema.optionalKey(Schema.String),
  apg: Schema.optionalKey(Schema.String),
  config: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  steps: Schema.Array(Step),
  notes: Schema.optionalKey(Schema.String),
});
export type Scenario = typeof Scenario.Type;

/** An upstream behaviour deliberately not ported (`upstream*` when it has a single source). */
const Skipped = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  upstream: Schema.optionalKey(Schema.String),
  upstreamTest: Schema.optionalKey(Schema.String),
  reason: Schema.String,
});
export type Skipped = typeof Skipped.Type;

const ScenarioFile = Schema.Struct({
  pattern: Schema.String,
  source: Schema.String,
  commit: Schema.optionalKey(Schema.NullOr(Schema.String)),
  license: Schema.optionalKey(Schema.String),
  upstream: Schema.optionalKey(Schema.String),
  retrieved: Schema.optionalKey(Schema.String),
  fixture: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  notes: Schema.optionalKey(Schema.String),
  skipped: Schema.optionalKey(Schema.Array(Skipped)),
  scenarios: Schema.Array(Scenario),
});
export type ScenarioFile = typeof ScenarioFile.Type;

/** Decode a scenario JSON document (the trust boundary for ported data). */
export const parseScenarioFile = (input: Schema.Json): ScenarioFile =>
  Schema.decodeUnknownSync(ScenarioFile)(input);

/** A step or observation the target does not model. Skips, never fails. */
export class Unsupported extends Error {}

/** The target disagreed with the scenario (or, in a walk, with the other target). */
export class ScenarioMismatch extends Error {}

export interface Observer {
  /** Part target holding focus (`trigger`, `tab:1`), or `null`. */
  readonly focus: () => string | null;
  /** Attribute value; `null` = absent. Throw `Unsupported` when not modelled. */
  readonly attr: (target: string, name: string) => string | null;
  /** The parts currently visible. */
  readonly visible: () => ReadonlyArray<string>;
  /** Callback payloads fired since mount (setup excluded), in order. */
  readonly events: (name: string) => ReadonlyArray<Schema.Json>;
  /** The pattern's observable value (`expect.value`), when it has one. */
  readonly value?: () => Schema.Json;
}

export interface Driver {
  readonly perform: (step: ActionStep) => void | Promise<void>;
  readonly observer: Observer;
  readonly dispose?: () => void;
}

export type ReplayResult =
  | { readonly status: 'passed'; readonly skipped: ReadonlyArray<string> }
  | { readonly status: 'unsupported'; readonly reason: string };

// `tab:0` and `tab` name the same single part: normalize both sides alike.
const normalize = (target: string | null): string | null =>
  target === null ? null : target.replace(/:0$/, '');

const partName = (target: string): string => target.replace(/:0$/, '');

const same = (a: Schema.Json, b: Schema.Json): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const mismatch = (
  what: string,
  expected: Schema.Json,
  actual: Schema.Json,
): never => {
  throw new ScenarioMismatch(
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

const check = (
  expectation: Expectation,
  observer: Observer,
  skipped: string[],
): void => {
  const attempt = (label: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      if (!(error instanceof Unsupported)) {
        throw error;
      }
      skipped.push(`${label}: ${error.message}`);
    }
  };
  for (const key of Object.keys(expectation)) {
    if (!CHECKED_EXPECTATION_KEYS.has(key)) {
      skipped.push(`${key}: expectation not supported by the replay engine`);
    }
  }
  if (expectation.focus !== undefined) {
    const { focus } = expectation;
    attempt('focus', () => {
      const actual = normalize(observer.focus());
      if (actual !== normalize(focus)) {
        mismatch('focus', focus, actual);
      }
    });
  }
  for (const [target, attrs] of Object.entries(expectation.attrs ?? {})) {
    for (const [name, expected] of Object.entries(attrs)) {
      attempt(`${target}[${name}]`, () => {
        const actual = observer.attr(target, name);
        if (actual !== expected) {
          mismatch(`${target}[${name}]`, expected, actual);
        }
      });
    }
  }
  if (expectation.visible !== undefined) {
    const { visible } = expectation;
    attempt('visible', () => {
      const expected = visible.map(partName).sort();
      const actual = observer.visible().map(partName).sort();
      if (!same(actual, expected)) {
        mismatch('visible', expected, actual);
      }
    });
  }
  for (const [name, expected] of Object.entries(expectation.events ?? {})) {
    attempt(`events.${name}`, () => {
      const actual = observer.events(name);
      if (!same(actual, expected)) {
        mismatch(`events.${name}`, expected, actual);
      }
    });
  }
  if (expectation.value !== undefined) {
    const { value } = expectation;
    attempt('value', () => {
      if (observer.value === undefined) {
        throw new Unsupported('no observable value');
      }
      const actual = observer.value();
      if (!same(actual, value)) {
        mismatch('value', value, actual);
      }
    });
  }
};

/**
 * Run one scenario against a driver. The bridge is the shared vocabulary gate:
 * a config or step it cannot translate makes the scenario `unsupported` for
 * every target alike, before anything runs. Throws `ScenarioMismatch` on a
 * failed expectation.
 */
export const replayScenario = async (
  scenario: Scenario,
  bridge: Pick<SpecBridge, 'setup' | 'event' | 'stepFields'>,
  makeDriver: (config: ScenarioConfig) => Driver | Promise<Driver>,
): Promise<ReplayResult> => {
  const config = scenario.config ?? {};
  const understood = new Set<string>([
    ...CORE_STEP_FIELDS,
    ...(bridge.stepFields ?? []),
  ]);
  try {
    bridge.setup(config);
    for (const step of scenario.steps) {
      if (!isExpectStep(step)) {
        const unknown = Object.keys(step).find((k) => !understood.has(k));
        if (unknown !== undefined) {
          throw new Unsupported(`step field "${unknown}"`);
        }
        bridge.event(step);
      }
    }
  } catch (error) {
    if (error instanceof Unsupported) {
      return { status: 'unsupported', reason: error.message };
    }
    throw error;
  }
  const driver = await makeDriver(config);
  const skipped: string[] = [];
  try {
    for (const [index, step] of scenario.steps.entries()) {
      try {
        if (isExpectStep(step)) {
          check(step.expect, driver.observer, skipped);
        } else {
          await driver.perform(step);
        }
      } catch (error) {
        if (error instanceof ScenarioMismatch) {
          throw new ScenarioMismatch(
            `${scenario.id} step ${index}: ${error.message}`,
          );
        }
        throw error;
      }
    }
  } finally {
    driver.dispose?.();
  }
  return { status: 'passed', skipped };
};

/** What a pattern teaches the spec driver: scenario vocabulary <-> spec events/state. */
export interface SpecBridge {
  /** Spec events that bring a fresh model to the scenario's `config` (not observed as events). */
  readonly setup: (config: ScenarioConfig) => ReadonlyArray<QuintEvent>;
  /**
   * The spec events for a step (`[]` = no effect on this pattern; throw
   * `Unsupported` otherwise). Convention: `key` / `type` on a target first
   * focuses it, as a user would.
   */
  readonly event: (step: ActionStep) => ReadonlyArray<QuintEvent>;
  /**
   * The `EXTENDED_STEP_FIELDS` this bridge honours in `event`. A step carrying
   * any other typed field is `Unsupported` for every target alike.
   */
  readonly stepFields?: ReadonlyArray<ExtendedStepField>;
  /** Canonical callback name (`onOpenChange` -> `onExpandedChange`). */
  readonly eventName?: (name: string) => string;
  /** `expect.value` over the model state. */
  readonly value?: (state: QuintModelValue) => Schema.Json;
  readonly focus: (state: QuintModelValue) => string | null;
  readonly attr: (
    state: QuintModelValue,
    target: string,
    name: string,
  ) => string | null;
  readonly visible: (state: QuintModelValue) => ReadonlyArray<string>;
  /** Callbacks the implementation would have fired during one transition. */
  readonly events: (
    before: QuintModelValue,
    after: QuintModelValue,
  ) => ReadonlyArray<readonly [name: string, payload: Schema.Json]>;
}

/** A driver over the generated reference model. Checks every invariant after every step. */
export const specDriver = (
  model: QuintReferenceModel,
  bridge: SpecBridge,
  config: ScenarioConfig = {},
): Driver => {
  const apply = (
    state: QuintModelValue,
    event: QuintEvent,
  ): QuintModelValue => {
    const next = model.transition(state, event);
    const violated = violatedInvariants(model, next);
    if (violated.length > 0) {
      throw new ScenarioMismatch(
        `spec invariant violated after ${JSON.stringify(event)}: ${violated.join(', ')}`,
      );
    }
    return next;
  };
  const { value } = bridge;
  let state = bridge.setup(config).reduce(apply, model.initial);
  const fired = new Map<string, Schema.Json[]>();
  return {
    perform: (step) => {
      const before = state;
      state = bridge.event(step).reduce(apply, state);
      for (const [name, payload] of bridge.events(before, state)) {
        fired.set(name, [...(fired.get(name) ?? []), payload]);
      }
    },
    observer: {
      focus: () => bridge.focus(state),
      attr: (target, name) => bridge.attr(state, target, name),
      visible: () => bridge.visible(state),
      events: (name) => fired.get(bridge.eventName?.(name) ?? name) ?? [],
      ...(value === undefined ? {} : { value: () => value(state) }),
    },
  };
};

export interface Probe {
  readonly attrs: ReadonlyArray<readonly [target: string, name: string]>;
  readonly events: ReadonlyArray<string>;
}

// An observation a target declares unmodelled is excluded from the comparison.
const observed = <T>(read: () => T): T | '?' => {
  try {
    return read();
  } catch (error) {
    if (error instanceof Unsupported) {
      return '?';
    }
    throw error;
  }
};

type Entry = readonly [label: string, value: Schema.Json | '?'];

const snapshot = (observer: Observer, probe: Probe): ReadonlyArray<Entry> => [
  ['focus', observed(() => normalize(observer.focus()))],
  ['visible', observer.visible().map(partName).sort()],
  ...probe.attrs.map(([target, name]): Entry => [
    `${target}[${name}]`,
    observed(() => observer.attr(target, name)),
  ]),
  ...probe.events.map((name): Entry => [
    `events.${name}`,
    [...observer.events(name)],
  ]),
];

// Deterministic 32-bit LCG, so a failing seed reproduces exactly.
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;
const UINT32 = 0x1_0000_0000;
const lcg = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / UINT32;
  };
};

export interface WalkOptions {
  /** Steps the walk draws from (a pattern's user-level alphabet). */
  readonly alphabet: ReadonlyArray<ActionStep>;
  readonly probe: Probe;
  /** A fresh [reference, candidate] pair per run, both at the same `config`. */
  readonly makePair: () => Promise<readonly [Driver, Driver]>;
  readonly runs?: number;
  readonly steps?: number;
  readonly seed?: number;
}

/**
 * Differential test: the same random steps into the reference and the
 * candidate; every probed observation must agree after every step.
 */
export const differentialWalk = async (options: WalkOptions): Promise<void> => {
  const rand = lcg(options.seed ?? 0);
  for (let run = 0; run < (options.runs ?? 20); run += 1) {
    const [reference, candidate] = await options.makePair();
    const path: ActionStep[] = [];
    try {
      for (let index = 0; index < (options.steps ?? 30); index += 1) {
        const step =
          options.alphabet[Math.floor(rand() * options.alphabet.length)];
        if (step === undefined) {
          return;
        }
        path.push(step);
        await reference.perform(step);
        await candidate.perform(step);
        const expected = snapshot(reference.observer, options.probe);
        const actual = snapshot(candidate.observer, options.probe);
        const differing = expected.flatMap(([label, value], position) => {
          const other = actual[position]?.[1] ?? '?';
          return value !== '?' && other !== '?' && !same(value, other)
            ? [label]
            : [];
        });
        if (differing.length > 0) {
          throw new ScenarioMismatch(
            `${differing.join(', ')} differ: spec ${JSON.stringify(expected)} vs implementation ${JSON.stringify(actual)} after ${JSON.stringify(path)}`,
          );
        }
      }
    } finally {
      reference.dispose?.();
      candidate.dispose?.();
    }
  }
};
