// The Effect-free core of the model interpreter: the evaluator and the
// transition function over a plain-TS definition. Nothing in this file may
// import 'effect' (core-no-effect.test.ts), so it can run in a browser bundle
// without the Effect runtime. The Schema layer (decoding, event schemas) is
// ./runtime.ts. Semantics: apps/portable-ir-spike/contract/OPCODES.md.

export class UnexpectedEventError extends Error {
  readonly _tag = 'UnexpectedEventError';
  readonly tag: string;
  constructor(fields: { readonly tag: string }) {
    super(`unexpected event: ${fields.tag}`);
    this.tag = fields.tag;
  }
}

export class EvaluationError extends Error {
  readonly _tag = 'EvaluationError';
  readonly detail: string;
  constructor(fields: { readonly detail: string }) {
    super(fields.detail);
    this.detail = fields.detail;
  }
}

export class DivisionByZeroError extends Error {
  readonly _tag = 'DivisionByZeroError';
  constructor(fields: { readonly opcode: string }) {
    super(`${fields.opcode} by zero`);
  }
}

export type QuintExprData =
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'str'; readonly value: string }
  | { readonly kind: 'int'; readonly value: string }
  | { readonly kind: 'bool'; readonly value: boolean }
  | {
      readonly kind: 'app';
      readonly opcode: string;
      readonly args: ReadonlyArray<QuintExprData>;
    }
  | {
      readonly kind: 'lambda';
      readonly params: ReadonlyArray<string>;
      readonly expr: QuintExprData;
    };

export interface QuintCoreDefinition {
  readonly generatedFrom: string;
  readonly specHash: string;
  readonly module: string;
  readonly vars: ReadonlyArray<{
    readonly name: string;
    readonly type: 'str' | 'int' | 'bool';
  }>;
  readonly defs: Readonly<
    Record<
      string,
      {
        readonly kind: 'function' | 'invariant';
        readonly params: ReadonlyArray<string>;
        readonly body: QuintExprData;
      }
    >
  >;
  readonly actions: ReadonlyArray<{
    readonly name: string;
    readonly nondet?:
      | {
          readonly name: string;
          readonly kind: 'str' | 'int' | 'bool';
          readonly pool: ReadonlyArray<string | boolean>;
        }
      | undefined;
    readonly assignments: ReadonlyArray<{
      readonly field: string;
      readonly rhs: QuintExprData;
    }>;
  }>;
  readonly step: ReadonlyArray<string>;
}

export type QuintValue = string | boolean | bigint;

export interface QuintModelValue {
  readonly [field: string]: QuintValue;
}

/**
 * One spec event in its decoded form: the action's `_tag` plus its
 * nondeterministic argument, if any.
 *
 * `_tag` is optional so decoded event schemas stay compatible with the
 * `Schema.Codec<Record<string, unknown>>` casts callers use to decode raw
 * event payloads.
 */
export interface QuintEvent {
  readonly _tag?: string;
  readonly [field: string]: QuintValue;
}

const matchesNondetKind = (
  kind: 'str' | 'int' | 'bool',
  value: unknown,
): value is QuintValue => {
  switch (kind) {
    case 'int':
      return typeof value === 'bigint';
    case 'bool':
      return typeof value === 'boolean';
    case 'str':
      return typeof value === 'string';
  }
};

interface Scope {
  readonly model: QuintModelValue;
  readonly locals: Readonly<Record<string, QuintValue>>;
  readonly defs: Readonly<
    Record<
      string,
      { readonly params: readonly string[]; readonly body: QuintExprData }
    >
  >;
}

const CANONICAL_INT = /^(0|-?[1-9][0-9]*)$/;

const evaluate = (expr: QuintExprData, scope: Scope): QuintValue => {
  if (expr.kind === 'app') {
    const args = expr.args ?? [];
    const arg = (i: number): QuintValue => {
      const next = args[i];
      if (next === undefined) {
        throw new EvaluationError({ detail: `app argument ${i} missing` });
      }
      return evaluate(next, scope);
    };
    const bool = (i: number): boolean => {
      const value = arg(i);
      if (typeof value !== 'boolean') {
        throw new EvaluationError({
          detail: `${expr.opcode} requires bool operands`,
        });
      }
      return value;
    };
    switch (expr.opcode) {
      case 'ite':
        return bool(0) ? arg(1) : arg(2);
      case 'eq':
        return arg(0) === arg(1);
      case 'neq':
        return arg(0) !== arg(1);
      case 'ilt':
      case 'ilte':
      case 'igt':
      case 'igte': {
        const left = arg(0);
        const right = arg(1);
        if (typeof left !== 'bigint' || typeof right !== 'bigint') {
          throw new EvaluationError({
            detail: `${expr.opcode} requires int operands`,
          });
        }
        switch (expr.opcode) {
          case 'ilt':
            return left < right;
          case 'ilte':
            return left <= right;
          case 'igt':
            return left > right;
          default:
            return left >= right;
        }
      }
      case 'iadd':
      case 'isub':
      case 'imul':
      case 'idiv':
      case 'imod': {
        const left = arg(0);
        const right = arg(1);
        if (typeof left !== 'bigint' || typeof right !== 'bigint') {
          throw new EvaluationError({
            detail: `${expr.opcode} requires int operands`,
          });
        }
        switch (expr.opcode) {
          case 'iadd':
            return left + right;
          case 'isub':
            return left - right;
          case 'imul':
            return left * right;
          case 'idiv':
          case 'imod':
            if (right === 0n) {
              throw new DivisionByZeroError({ opcode: expr.opcode });
            }
            return expr.opcode === 'idiv' ? left / right : left % right;
          default:
            throw new EvaluationError({ detail: 'unreachable int opcode' });
        }
      }
      case 'not': {
        const value = arg(0);
        if (typeof value !== 'boolean') {
          throw new EvaluationError({ detail: 'not requires a bool operand' });
        }
        return !value;
      }
      case 'iuminus': {
        const value = arg(0);
        if (typeof value !== 'bigint') {
          throw new EvaluationError({
            detail: 'iuminus requires an int operand',
          });
        }
        return -value;
      }
      case 'and':
        return args.every((_, i) => bool(i));
      case 'or':
        return args.some((_, i) => bool(i));
      default: {
        const def = scope.defs[expr.opcode];
        if (def === undefined) {
          throw new EvaluationError({
            detail: `unknown operator: ${expr.opcode}`,
          });
        }
        if (args.length !== def.params.length) {
          throw new EvaluationError({
            detail: `${expr.opcode} takes ${def.params.length} arguments, got ${args.length}`,
          });
        }
        const locals: Record<string, QuintValue> = {};
        def.params.forEach((param, i) => {
          locals[param] = arg(i);
        });
        return evaluate(def.body, { ...scope, locals });
      }
    }
  }
  switch (expr.kind) {
    case 'name': {
      const fromLocal = scope.locals[expr.name];
      if (fromLocal !== undefined) return fromLocal;
      const fromModel = scope.model[expr.name];
      if (fromModel !== undefined) return fromModel;
      // a zero-argument def/val referenced as a value (e.g. a shared `none`
      // sentinel); parameterized defs are not first-class values
      const def = scope.defs[expr.name];
      if (def !== undefined && def.params.length === 0) {
        return evaluate(def.body, { ...scope, locals: {} });
      }
      throw new EvaluationError({ detail: `unbound name: ${expr.name}` });
    }
    case 'str':
      return expr.value;
    case 'bool':
      return expr.value;
    case 'int':
      if (!CANONICAL_INT.test(expr.value)) {
        throw new EvaluationError({
          detail: `int literal is not canonical decimal: ${expr.value}`,
        });
      }
      return BigInt(expr.value);
    case 'lambda':
      throw new EvaluationError({
        detail: 'lambda values are not first-class in the evaluator',
      });
  }
};

/**
 * A spec-owned invariant: `val <name>: bool = <expr>` from the Quint spec,
 * evaluable against any model value (including a machine's state value).
 */
export interface QuintInvariant {
  readonly name: string;
  readonly holds: (model: QuintModelValue) => boolean;
}

export interface QuintCore {
  readonly module: string;
  readonly specHash: string;
  /** Spec variable names, in declaration order. */
  readonly vars: ReadonlyArray<string>;
  readonly initial: QuintModelValue;
  /** Invariants declared in the spec (`val <name>: bool`). */
  readonly invariants: ReadonlyArray<QuintInvariant>;
  readonly transition: <Event extends Readonly<Record<string, unknown>>>(
    model: QuintModelValue,
    event: Event,
  ) => QuintModelValue;
  readonly pools: Readonly<
    Record<string, Readonly<Record<string, readonly (string | boolean)[]>>>
  >;
  /**
   * The nondet payload descriptor per action (`pools` holds the raw values).
   * Used to rehydrate a pool value to the kind the event schema expects.
   */
  readonly eventPayloads: Readonly<
    Record<
      string,
      { readonly name: string; readonly kind: 'str' | 'int' | 'bool' }
    >
  >;
}

export const makeCore = (definition: QuintCoreDefinition): QuintCore => {
  const defs = definition.defs;
  const actionsByName = new Map(
    definition.actions.map((action) => [action.name, action]),
  );

  const initialScope: Scope = { model: {}, locals: {}, defs };
  const initial: QuintModelValue = Object.fromEntries(
    (actionsByName.get('init')?.assignments ?? []).map(({ field, rhs }) => [
      field,
      evaluate(rhs, initialScope),
    ]),
  );

  const transition = <Event extends Readonly<Record<string, unknown>>>(
    model: QuintModelValue,
    event: Event,
  ): QuintModelValue => {
    const tag = event['_tag'];
    if (typeof tag !== 'string') {
      throw new UnexpectedEventError({ tag: String(tag) });
    }
    if (tag === 'init') {
      return { ...initial };
    }
    const action = actionsByName.get(tag);
    if (action === undefined) {
      throw new UnexpectedEventError({ tag });
    }
    // evaluate every assignment against the OLD model (Quint's simultaneous
    // assignment semantics), then merge once
    const locals: Record<string, QuintValue> = {};
    if (action.nondet !== undefined) {
      const picked = event[action.nondet.name];
      if (!matchesNondetKind(action.nondet.kind, picked)) {
        throw new UnexpectedEventError({ tag });
      }
      locals[action.nondet.name] = picked;
    }
    const scope: Scope = { model, locals, defs };
    const assignments = Object.fromEntries(
      action.assignments.map(({ field, rhs }) => [field, evaluate(rhs, scope)]),
    );
    return { ...model, ...assignments };
  };

  const pools: Record<
    string,
    Record<string, readonly (string | boolean)[]>
  > = {};
  const eventPayloads: Record<
    string,
    { readonly name: string; readonly kind: 'str' | 'int' | 'bool' }
  > = {};
  for (const action of definition.actions) {
    if (action.name === 'init' || action.nondet === undefined) continue;
    pools[action.name] = { [action.nondet.name]: action.nondet.pool };
    eventPayloads[action.name] = {
      name: action.nondet.name,
      kind: action.nondet.kind,
    };
  }

  const invariants: QuintInvariant[] = Object.entries(definition.defs)
    .filter(([, def]) => def.kind === 'invariant')
    .map(([name, def]) => ({
      name,
      holds: (model: QuintModelValue) =>
        evaluate(def.body, { model, locals: {}, defs }) === true,
    }));

  return {
    module: definition.module,
    specHash: definition.specHash,
    vars: definition.vars.map((v) => v.name),
    initial,
    invariants,
    transition,
    pools,
    eventPayloads,
  };
};
