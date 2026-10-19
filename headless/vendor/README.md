# vendor

The spec side of the tests, copied **read-only** from `~/github/effects-of-atmosphere` at commit
`8b7210986cd6924d344a0003369e6577841d2476` (`EOA_COMMIT`). The files are byte for byte the originals, except
`quint-machine/src/index.ts`, which drops the `scxml` re-export. `sync.sh` reads them from git at that commit, so the eoa
checkout may be on another one.

| Here                                          | From (under `packages/`)                                   |
| --------------------------------------------- | ---------------------------------------------------------- |
| `quint-machine/src/{core,runtime,index}.ts`   | `quint-machine/src/`: the model evaluator, `makeReferenceModel`, `decodeDefinition` |
| `specs/src/scenario.ts`                       | `specs/src/scenario.ts`: `replayScenario`, `specDriver`, `differentialWalk`, `parseScenarioFile` |
| `specs/src/apg/<pattern>.bridge.ts`           | `specs/src/apg/`: scenario vocabulary <-> spec events, the walk alphabet and probe |
| `specs/src/apg/<pattern>.model.generated.json`| `specs/src/apg/`: the generated Quint model                |
| `specs/scenarios/apg/<pattern>.*.json`        | `specs/scenarios/apg/`: the ported scenarios (+ its README, the format) |
| `specs/specs/apg/<pattern>.qnt`               | `specs/specs/apg/`: the specs, for reading                 |
| `specs/shared/{aria,focusgroup}.qnt`          | `specs/shared/`: imported by the specs (`../../shared/...`), so kept at the same relative place |

for `button`, `switch`, `checkbox`, `disclosure`, `radio`, `tabs`, `toolbar`, `slider`, `treeview`. `@eoa/quint-machine` resolves here through `paths` in `../tsconfig.json`
(bun reads it); the only dependency is `effect@4.0.0`, the version eoa pins (its `Schema` decodes the scenario files and
the model).

Why a copy and not a link: eoa's packages resolve `effect`, `@eoa/quint-machine` and `@eoa/specs` through its pnpm
workspace, and `@eoa/quint-machine` points `main` at a `dist/` that needs a build. A path import from here would need that
workspace installed and built; a copy needs nothing.

To update: write the new commit to `EOA_COMMIT`, then `sh vendor/sync.sh [path to effects-of-atmosphere]` (it reads the files at that commit), then `bun run test` (the pinned scenario counts in
`test/*.test.ts` change if a scenario file or bridge did).
