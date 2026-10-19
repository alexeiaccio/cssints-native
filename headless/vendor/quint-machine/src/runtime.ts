import { Data, Schema } from 'effect';
import {
  type QuintExprData as ExprData,
  type QuintCore,
  type QuintEvent,
  type QuintModelValue,
  makeCore,
} from './core.js';

export {
  DivisionByZeroError,
  EvaluationError,
  UnexpectedEventError,
  makeCore,
} from './core.js';
export type {
  QuintCore,
  QuintEvent,
  QuintInvariant,
  QuintModelValue,
  QuintValue,
} from './core.js';

export type QuintExprData = ExprData;

// The Schema layer over ./core.ts: decoding of definition documents and the
// event schemas. The evaluator itself (the role Quint's own simulator plays)
// is Effect-free and lives in ./core.ts.

export class DefinitionDecodeError extends Data.TaggedError(
  'DefinitionDecodeError',
)<{
  readonly issue: unknown;
}> {}

// ---------------------------------------------------------------------------
// Model definition document schema (the spec of generated documents)
// ---------------------------------------------------------------------------

export const QuintExprData: Schema.Codec<ExprData> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('name'), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('str'), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('int'), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('bool'), value: Schema.Boolean }),
  Schema.Struct({
    kind: Schema.Literal('app'),
    opcode: Schema.String,
    args: Schema.Array(
      Schema.suspend((): Schema.Codec<ExprData> => QuintExprData),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('lambda'),
    params: Schema.Array(Schema.String),
    expr: Schema.suspend((): Schema.Codec<ExprData> => QuintExprData),
  }),
]);

export const QuintModelDefinition = Schema.Struct({
  generatedFrom: Schema.String,
  specHash: Schema.String,
  module: Schema.String,
  vars: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.Union([
        Schema.Literal('str'),
        Schema.Literal('int'),
        Schema.Literal('bool'),
      ]),
    }),
  ),
  defs: Schema.Record(
    Schema.String,
    Schema.Struct({
      kind: Schema.Union([
        Schema.Literal('function'),
        Schema.Literal('invariant'),
      ]),
      params: Schema.Array(Schema.String),
      body: QuintExprData,
    }),
  ),
  actions: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      nondet: Schema.optional(
        Schema.Struct({
          name: Schema.String,
          kind: Schema.Union([
            Schema.Literal('str'),
            Schema.Literal('int'),
            Schema.Literal('bool'),
          ]),
          // int pool values are decimal strings in the document (JSON has no
          // bigint); the runtime rehydrates them by kind
          pool: Schema.Array(Schema.Union([Schema.String, Schema.Boolean])),
        }),
      ),
      assignments: Schema.Array(
        Schema.Struct({ field: Schema.String, rhs: QuintExprData }),
      ),
    }),
  ),
  step: Schema.Array(Schema.String),
});

export type QuintModelDefinition = typeof QuintModelDefinition.Type;

export const decodeDefinition = <Input>(input: Input): QuintModelDefinition =>
  Schema.decodeUnknownSync(QuintModelDefinition)(input);

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

const NONDET_SCHEMAS = {
  int: Schema.BigInt,
  bool: Schema.Boolean,
  str: Schema.String,
} as const;

// ---------------------------------------------------------------------------
// Reference model
// ---------------------------------------------------------------------------

export interface QuintReferenceModel extends QuintCore {
  /**
   * Effect Schema for one spec event, keyed by spec action name. Present for
   * every non-`init` action, including parameterless ones (a bare `_tag`).
   */
  readonly eventSchemas: Readonly<Record<string, Schema.Schema<QuintEvent>>>;
}

export const makeReferenceModel = (
  definition: QuintModelDefinition,
): QuintReferenceModel => {
  const eventSchemas: Record<string, Schema.Schema<QuintEvent>> = {};
  for (const action of definition.actions) {
    if (action.name === 'init') continue;
    if (action.nondet === undefined) {
      // parameterless action: its event is a bare tag
      eventSchemas[action.name] = Schema.Struct({
        _tag: Schema.Literal(action.name),
      }) as Schema.Schema<QuintEvent>;
      continue;
    }
    eventSchemas[action.name] = Schema.Struct({
      _tag: Schema.Literal(action.name),
      [action.nondet.name]: NONDET_SCHEMAS[action.nondet.kind],
    }) as Schema.Schema<QuintEvent>;
  }
  return { ...makeCore(definition), eventSchemas };
};

/**
 * Names of every spec invariant the given value violates. Pass a machine's
 * state value to check the implementation, not just the model.
 */
export const violatedInvariants = (
  reference: QuintReferenceModel,
  model: QuintModelValue,
): ReadonlyArray<string> =>
  reference.invariants
    .filter((invariant) => !invariant.holds(model))
    .map((invariant) => invariant.name);
