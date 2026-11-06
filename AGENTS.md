# Agent contract — bank wealth current authoring

## One current entry

Use root `truthsrc.project.json`. Current knowledge is under
`truth/bank-wealth/contexts/bankwealth/`, with system inbox under
`truth/bank-wealth/inbox/`. The root system/context declarations, current knowledge
and `bindings/implementation/` technical choices are the author inputs.

Do not edit `.truthsrc/` generated canonical/request/compiled/evidence, generated
Scala, ledger or anchors. Do not duplicate guards/folds/Saga bindings into another
complete request. Use the public sibling toolchain, not a bank-only compiler or
writer. Unknown capability must fail rather than infer finance rules from prose.

## Current layout and commands

Use Node >=22.13.0 and the matching complete sibling `metarch-truthsrc` checkout.
Source doctor/validate/compile needs neither JVM nor the clean1134 archive. Full
bank generation still requires frozen supply; a public material delivery channel
has not been established. Do not invent a Release/npm URL or assume main is paired.

Current source roots are `handwritten/scala/` (35 files), `test/scala/` (31 fixed
files) and `third-party/` (14 licence/source records). The exact old-to-new inventory
is `docs/V1-RETIREMENT-MANIFEST.json`; historical inputs are not these current roots.
The handwritten relationship map belongs at
`docs/architecture/HANDWRITTEN-SOURCE-MAP.json`, explained by that directory's README.
Post-migration results are recorded in `docs/V1-RETIREMENT.md`. Directory/source
mapping checks and real service acceptance are separate gates; never infer runtime
success from directory names, static mappings or a documentation update.

```bash
node tools/bank-workshop.mjs doctor --through source --format human
node tools/truthsrc-project.mjs validate
node tools/truthsrc-project.mjs compile
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current" --plan
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current"
node tools/truthsrc-project.mjs status --out "$PWD/generated/current"
node tools/truthsrc-project.mjs query --out "$PWD/generated/current" --knowledge ReserveFunds
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current" --update --plan
```

After a supported change, inspect the update plan and then run with `--update`.
Do not bypass overwrite conflicts. Existing hand-written implementation is
`handwritten/scala/` and remains separate from generated source. Two agents
must own nonoverlapping modules; one integrator owns shared interfaces and apply.
Different output directories still share the project knowledge graph. Plan does
not persist the graph/output, but roundtrip writes disposable system temp files;
apply may already update the graph before a later failure. Do not promise global
rollback or treat repeated zero-source-write update as zero evidence writes.

Every author batch needs validate plus roundtrip (the validate wrapper runs both),
then the relevant explicit test. `npm test` is the current source/14-product
contract test, not whole application acceptance. Full generation/query/change
integration is opt-in:

```bash
BANK_TRUTHSRC_INTEGRATION=1 node --test --test-concurrency=1 test/unified-truth.test.mjs
```

The integration uses its own disposable author/output copy. It does not launch
services or the old domain qualifier. It does not certify full runtime recovery.
See `docs/TRUTH-BUILD.md` for separately isolated offline compile and explicit
`--run-generated-tests` verification. That mode executes only admitted generated
unit suites under the same OS network/write restrictions; it does not mount
`test/scala`, start services, or certify four-flow business and cross-JVM recovery.
`npm run test:build-verifier` tests the verifier contract without starting a JVM.

The separate `--run-actor-tests` mode adds exactly eight read-only frozen business
suite files to the six current generated test files: 41 business assertions plus
23 generated units. It retains the generated forked runner, fixed manifest and
OS network denial; only its new `.local/mock-ta/truthsrc-actors-*` round is writable
for TA journals. Its worker consumes an explicit provenance-labelled historical
fixture, never an implicit old author snapshot. Do not append whole test directories,
change frozen tests, or call this HTTP/database/cross-JVM acceptance.
See `docs/TRUTH-RUNTIME-ACCEPTANCE.md`; `npm run test:actor-verifier` exercises the
Node worker and verifier contracts with owned temporary journals, without a JVM.

## Compatible composition acceptance (2026-11-06)

The user approved task108 compatible migration: generated local repositories and
JDBC readside infrastructure are now consumed through three adjusted handwritten
wiring files (`BankRuntime`, `BankReadside`, `BankReadsideSchema`). Other application
behavior, public carriers/API, PB, PID, frozen tests/runtime and historical release
remain protected. See `docs/TRUTH-COMPATIBLE-COMPOSITION.md`; this is not permission
for arbitrary later handwritten rewrites.

`--run-readside-tests` is an explicit isolated verifier mode, mutually exclusive
with actor/unit/runtime modes. It appends exactly five SHA-pinned frozen suites
(24 tests) to the six generated source files (23 tests), using embedded memory H2
2.2.224 and existing testkit/network denial. It starts no HTTP server, TA worker or
external database. `npm run test:readside-verifier` runs only the Node contracts.
Actual readside47/actor64 successful receipts belong to separate fresh candidates;
never relabel old evidence or change fixed test expectations to accommodate code.

## Current runtime windows

`--compile-runtime-tests` is compile-only and exclusive with all execution modes.
It adds five SHA-pinned frozen integration mains to the six generated test sources,
then seals the actual staged sources and ordered classpath. Its successful receipt
is consumed only by `tools/verify-truthsrc-runtime.mjs`; old build/release receipts
cannot be relabelled. `npm run test:runtime-verifier` runs the explicit Node contracts,
not JVM/database acceptance or whole-repository discovery.

Runtime evidence and TA roots must be new and disjoint from build evidence. Fixed
24-case crash recovery remains OS deny-all; production HTTP/database uses the
separate `host-local-reserved-ports` policy and reserved ports. Seatbelt localhost
also matches local interfaces/wildcard: never claim exact-IP hostile-code isolation.
The source-pinned server/config and actual listener checks separately require IPv4
127.0.0.1. New database containers/networks/data and credentials are owned by the
current window; no shared services, downloads, old credentials, data deletion or
runtime publication. Stop only recorded owner-labelled containers/current process
groups; retain data and failed evidence. See `docs/TRUTH-RUNTIME-WINDOW-20261105.md`.

Current runtime result (2026-11-06): service02 uses the P23 artifacts, not the new
Monarch R2 candidate. Code and 24 recovery cases passed; real database initial,
restart and refund passed, but a fresh readside replay missed the 90s caught-up
readiness gate. Full service remains failed and the manual session was not run.
Owned resources were stopped and leases released; shared `metarch-mongo` was not
touched. See `docs/V1-RETIREMENT.md` and `docs/MONARCH-R2-DOWNSTREAM.md`. Do not
rewrite the failed receipts, silently increase deadlines or replace frozen JARs.

## Semantics and protected history

- Preserve payment, TA, independent refund and finite SIP. Saga transactions and
  pipeline orchestration are not interchangeable. Payment success is not investment
  success; independent refund is not compensation of a committed payment.
- Three-failure automatic pause is not a current accepted policy. Retry/backoff/
  deadline debt **remains OPEN**, not an accepted profile exemption; do not repair
  or republish runtime as part of source work.
- Roles/read-model narratives cite actual existing behavior. They are not a new
  executable authorization/SQL projection engine; five-layer design proposals keep
  their approval status. Do not invent workshop history or approvals.
- `tree/` and `v1/tree/` were retired after exact 430-file and full-product checks.
  Historical source reads use revision `675a9366cf270995ef714e505e42c19652f0e4f0`
  through `tools/historical-source.mjs`; see `docs/TRUTH-LEGACY-BASELINE.json`.
  Old formal inputs and integration/release records are preserved as exact Git
  objects at `4515b6b97d91714116b451b4e930dc81e112e528`, not current disk inputs.
  See `docs/HISTORY.md` and the retirement manifest. Old commands require
  `--historical`; frozen complete requests require `historical:true`. Missing Git
  objects must fail explicitly, not fall back to current source or trigger fetching.
  Never reconstruct a second current author tree. A historical archive/checkout
  may still use `v1/handwritten/scala` and `v1/test/scala`; do not confuse its paths
  with the new current source roots or rewrite frozen archive bytes.
- Preserve the explicitly inventoried historical protection sets and their baselines, six root bindings,
  frozen1134/P23 evidence, `compiled/`, `isolation-zone/`, `qualification/`, old
  journals and failed candidates. This bounded retirement is not permission to
  delete or re-sign them. The 1128 decision keeps all 13 drafts tracked, at their
  original paths and bytes, paused and excluded from accepted V1 work; preserve
  licence/provenance records as well. Fixed historical entries are in `docs/HISTORY.md`.
- Do not run `tools/qualify-domain.mjs`, `test/domain-runner.test.mjs`, or clean
  qualification/isolation/compiled/history to make a gate green. No global test
  discovery in this bank repository.
- Do not read secrets or old process args/env, reuse prior leaked credentials,
  modify journals, overwrite exclusive receipts, or recursively repackage `dist/v1`.
  Only the signed clean1134 archive is a portable source of frozen dependencies.
- No runtime/source publication, shared-app writes, new worktrees, stash/reset,
  cleanup or Git commit/push without the relevant explicit authorization.

Read `TRUTH.md`, `docs/TRUTH-TUTORIAL.md`, `docs/TRUTH-MIGRATION.md`,
`docs/TRUTH-ENTRYPOINTS.md` and `docs/TRUTHSRC-CONTINUATION.md` for boundaries.
The sibling tool's `AGENTS.md`/`AUTHORING.md` defines atom grammar and identity.
