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

## Current commands

```bash
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
`v1/handwritten/scala/` and remains separate from generated source. Two agents
must own nonoverlapping modules; one integrator owns shared interfaces and apply.

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
`v1/test`, start services, or certify four-flow business and cross-JVM recovery.
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

## Current runtime windows

`--compile-runtime-tests` is compile-only and exclusive with both execution modes.
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
- `tree/`, `v1/tree/`, six root bindings, old formal inputs and frozen1134/P23
  artifacts remain historical byte-preserved inputs. Old commands require explicit
  `--historical`, and frozen complete-request API requires `historical:true`.
  Do not resume editing both old and new author models.
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
