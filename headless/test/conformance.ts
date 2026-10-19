import {
  type ActionStep,
  type Probe,
  type ScenarioConfig,
  ScenarioMismatch,
  type SpecBridge,
  differentialWalk,
  parseScenarioFile,
  replayScenario,
  specDriver,
} from '../vendor/specs/src/scenario';
import {
  type Mounted,
  type NeutralDriverOptions,
  neutralDriver,
} from './neutral-driver';
import { decodeDefinition, makeReferenceModel } from '@eoa/quint-machine';
import { describe, expect, it } from 'bun:test';

export interface Conformance<Config> {
  readonly pattern: string;
  /** Parsed-able scenario documents (`vendor/specs/scenarios/apg/<pattern>.*.json`). */
  readonly scenarioFiles: ReadonlyArray<unknown>;
  readonly definition: unknown;
  readonly bridge: SpecBridge;
  readonly config: (scenarioConfig: ScenarioConfig) => Config;
  readonly mount: (config: Config) => Mounted;
  readonly disabledAttr: NeutralDriverOptions['disabledAttr'];
  readonly steps: ReadonlyArray<ActionStep>;
  readonly probe: Probe;
  /** Scenarios whose expectations the primitive deliberately does not meet, with the reason. */
  readonly divergences: Readonly<Record<string, string>>;
  /** Pinned so a bridge or scenario change that skips more shows up here. */
  readonly expected: {
    readonly passed: number;
    readonly unsupported: number;
  };
  /** Walk configs (scenario-config vocabulary): uncontrolled, controlled accepting, controlled holding. */
  readonly walks: ReadonlyArray<ScenarioConfig>;
}

/**
 * The two checks of eoa's `<pattern>.browser.test.tsx`, on the neutral driver:
 * replay every ported scenario, and walk seeded random steps through the
 * generated Quint model and the primitive, comparing the probe after each.
 */
export const conformance = <Config>(spec: Conformance<Config>): void => {
  const model = makeReferenceModel(decodeDefinition(spec.definition));
  const neutral = (config: ScenarioConfig) =>
    neutralDriver(spec.mount(spec.config(config)), {
      disabledAttr: spec.disabledAttr,
      ...(spec.bridge.eventName === undefined
        ? {}
        : { eventName: spec.bridge.eventName }),
    });

  describe(`${spec.pattern} x ported scenarios (neutral parts)`, () => {
    let passed = 0;
    let unsupported = 0;
    for (const source of spec.scenarioFiles) {
      const file = parseScenarioFile(source as never);
      for (const scenario of file.scenarios) {
        it(scenario.id, async () => {
          const run = replayScenario(scenario, spec.bridge, neutral);
          if (spec.divergences[scenario.id] !== undefined) {
            // must still fail, so closing the gap forces removing the entry
            await expect(run).rejects.toBeInstanceOf(ScenarioMismatch);
            return;
          }
          const result = await run;
          if (result.status === 'unsupported') {
            unsupported += 1;
          } else {
            passed += 1;
          }
        });
      }
    }
    it('replays what it should', () => {
      expect({ passed, unsupported }).toEqual(spec.expected);
    });
  });

  describe(`${spec.pattern} x spec (differential walk)`, () => {
    for (const config of spec.walks) {
      it(`matches the generated model for ${JSON.stringify(config)}`, async () => {
        await differentialWalk({
          alphabet: spec.steps,
          probe: spec.probe,
          makePair: () =>
            Promise.resolve([
              specDriver(model, spec.bridge, config),
              neutral(config),
            ]),
          runs: 15,
          steps: 25,
          seed: 7,
        });
      });
    }
  });
};
