# Bank Wealth Workshop

## One purchase, every step’s origin — from a truth tree

A customer submits a 100-yuan fund purchase. The money is debited — does that
mean the investment succeeded? When the fund company rejects it, why does a
*separate* refund exist? How does every installment of a savings plan reuse the
exact same rules?

This repo answers those questions the way the [co-arising](https://co-arising.github.io)
family answers everything: **author a truth tree → compile it strictly → build
the local knowledge graph → generate code → anchor every line back → verify in
layers.** The bank is the payload; the truth tree is the point.

> 中文版说明见[下方](#中文速览)。 This is a local teaching demo: no real money,
> not a production banking system, not a Palantir-compatible implementation.

| The loop | Command (from repo root) |
|---|---|
| 1 · Gate the tree | `node tools/truthsrc-project.mjs validate` — 0 hard, roundtrip byte-identical |
| 2 · Compile | `node tools/truthsrc-project.mjs compile` |
| 3 · Graph | `truthsrc graph --tree truth/bank-wealth --out <db>` — 389 nodes / 413 edges |
| 4 · Generate | `npm run project` — 235-file Play/CQRS Scala project into `generated/current/` |
| 5 · Build & test | `cd generated/current && sbt compile && sbt test` — 0 errors / 23 tests |
| 6 · Prove lineage | `truthsrc verify-project` — 792 anchors re-verified against file bytes |

Numbers verified 2026-11-11; re-verify with the commands — trust your terminal.
Full walkthrough with Docker variants: [hands-on guide](https://co-arising.github.io/guide/).
Explore the compiled graph in your browser: [the explorer](https://co-arising.github.io/explorer/).

## Four business lines, four coordination shapes

The teaching point: each line is a different *shape* of coordination, so each
is declared as a different truth atom. **Sagas own transaction boundaries;
pipelines own flow order. They are not interchangeable** — the tree refuses to
blur them.

| Line | The trap it defuses | Declared in truth as |
|---|---|---|
| Cash purchase payment | Payment succeeded ≠ investment succeeded | `bank-cash-payment-v1` **saga**: investor debit → collection credit → order commit, one `Money`, pinned IDs |
| Mock TA confirmation | TA accepted ≠ shares confirmed; unknown stays unknown | FundOrder slices + formal products: TA effect ports with explicit outcome mappings |
| Independent refund | A refund is its own business fact, not a disguised compensation | `bank-independent-refund-v1` **saga** + pipeline |
| Bounded installment plan (SIP) | Each installment reuses the cash rules — no new money path | `bank-sip-dispatch-v1` **pipeline** with explicit skip/terminal semantics |

Three aggregates: `CreditBalance`, `FundOrder`, `SipPlan`. Money/NAV/shares use
exact decimal types; the TA is a simulator — no real financial institution.

## How the truth tree solves distributed transactions: sagas as knowledge

Cross-aggregate consistency is declared once, in the tree, as a saga atom —
participants, TCC phases, command bindings and transaction identity. The
compiler turns it into saga IR for
[saga-core](https://github.com/MadPolaris/saga-core) (an Akka Typed,
event-sourced TCC coordinator). From `truth/.../sagas/bank-independent-refund-v1.saga.yaml`:

```yaml
kind: saga
id: bank-independent-refund-v1
payload:
  {
    "invariants": [
      "Refund amount equals the original positive CNY principal; refund
       never compensates an already-Commit-ed payment leg."
    ],
    "transactionIdType": "TxId",
    "steps": [
      {
        "id": "debit-fund-collection",
        "participant": "collectionCreditBalance",
        "group": 1,
        "phases": {
          "prepare": {
            "kind": "command",
            "commandRef": { "aggregate": "CreditBalance", "name": "ReserveFunds" },
            "bindings": [
              "txid <- txid : TxId",
              "resource <- \"args:fundCollectionAccountId\" : AccountId",
              "amount <- \"args:amount\" : Money"
            ]
          }
        }
        # … confirm/cancel phases and further steps follow
      }
    ]
  }
```

Prepare binds `ReserveFunds` on the collection account; the coordinator drives
Try/Confirm/Cancel across participants; crash recovery, retries and manual
intervention live in the engine — but *what must hold* lives in the tree, where
domain experts can read it and the compiler can check it.

## Flow orchestration as knowledge: pipelines for batch/stream steps

Sequencing — “this step, then that step, each executing a slice” — is likewise
a first-class atom, compiled to a plan for
[monarch-core](https://github.com/MadPolaris/monarch-core) (a recoverable
stage-queue engine; journaling via
[monarch-persistence](https://github.com/MadPolaris/monarch-persistence)).
From `truth/.../pipelines/bank-cash-payment-v1.pipeline.yaml`:

```yaml
kind: pipeline
id: bank-cash-payment-v1
steps:
  [
    {
      "id": "pay-cash-purchase",
      "name": "Cash fund purchase: investor debit, collection credit, then order payment confirmation",
      "execution": {
        "invokeSaga": {
          "ref": { "sagaId": "bank-cash-payment-v1", "version": "bank-v1-1" },
          "transactionIdentity": {
            "type": "TxId",
            "derivation": "durable-source-stage",
            "scope": "saga-version",
            "conflict": "reject-different-args"
          },
          "start": "durable-intent-before-start",
          "completionMode": "await-terminal"
        }
      }
    }
  ]
```

Note what the truth layer adds over a raw orchestration graph: the pipeline
step *invokes the saga with a durable identity* — replaying the step can never
accidentally start a second transaction (`reject-different-args`), and the
intent is journaled before start. Batch/stream flows become auditable
knowledge, not opaque runtime configuration.

## What you get out: code with receipts, and a queryable domain

- **A compiling Play/CQRS project** — 235 generated files (aggregates,
  commands, events, guards compiled from 149 named `@rule` invariants, proto
  schemas, ports), `sbt compile` clean across 534 sources, 23/23 tests green.
- **A handwritten zone that generation never touches** — 35 complete
  implementation files (TA client, refund application, recovery loops, HTTP
  pages) mounted via `unmanagedSourceDirectories`. No `BEGIN MANUAL` markers;
  the filesystem is the boundary. The generated code must satisfy the
  handwritten tests — never the reverse.
- **A knowledge graph you can interrogate** — every compile produces a SQLite
  graph store: `blast_radius` (what does an installment failure touch? 55
  nodes), `lineage` (which event field feeds this displayed number?),
  `orphans` (which concepts have no origin?), via CLI, MCP, or
  [in your browser](https://co-arising.github.io/explorer/).
- **Seven design projections** — journeys, screen flow, context map, event
  flow, cash experience/lifecycle, story map: derived, regenerable design
  views ([projections/](projections/)).

Application scenarios this enables: compliance-grade lineage (“where did this
number come from” as a query, not archaeology); agent-assisted change planning
(blast radius before any code is written — [the MCP exercise](https://co-arising.github.io/guide/#l3));
and onboarding that reads the domain instead of grepping the codebase.

## Layered acceptance & honest limits

**First success verifies the truth source only.** Requires Node ≥ 22.13.0 and
an adjacent, paired `metarch-truthsrc` checkout ([tool install](../metarch-truthsrc/README.md#install)).
Cloning this repo alone does not bring the tool; do not assume both repos’
`main` are the paired state. No JVM, Docker or the 1134 archive is needed for
the truth layers.

| Layer | Extra prerequisites | Does not substitute for |
|---|---|---|
| source | Node + paired tool checkout | does not prove the generated app runs |
| anchors | six frozen JAR/POMs; prepare verifies extraction, runs no JVM | file/span linkage is not financial-semantic proof |
| code | frozen build supply, native Darwin x64, JDK 11, Python, macOS sandbox tooling | actor/readside tests ≠ HTTP or real-DB acceptance |
| service | fresh owner lease, exclusive ports/storage, Docker, pinned Mongo/MySQL images | the acceptance window ≠ arbitrary failure recovery or production certification |

**The full generation still depends on frozen artifacts whose public
distribution channel is not yet established** — no fabricated Release/npm
links, no repacking from a previously-run `dist/v1`. Current runtime limits
(Mongo 4.4 EOL, platform) are in [BANK-WORKSHOP.md](docs/BANK-WORKSHOP.md) and
[history](docs/HISTORY.md#release-1134).

Existing evidence, read by candidate and timestamp:

- [Compat-migration acceptance](docs/TRUTH-COMPATIBLE-COMPOSITION.md): generated Repository and JDBC read-side **actually consumed**; bank owner/query DTOs still handwritten. actor64 and readside47 share 23 generated tests — they do not add up to independent coverage.
- [Nov-6 newcomer acceptance receipt](docs/ONBOARDING-ACCEPTANCE.md): code, graph and fixed recovery measured; not a full-service sign-off.
- **Latest run (2026-11-06):** service02 completed new code/runtime compilation, the 24 recovery windows and real-DB initial/restart/refund, **but a fresh read-side replay missed the 90-second caught-up gate — the full service remains failed**; resources were returned. It consumed the older P23 artifacts — it is **not** the [Monarch R2 downstream acceptance](docs/MONARCH-R2-DOWNSTREAM.md). (`sbt run` + HTTP smoke has likewise not been executed — [DEF-07](https://co-arising.github.io/status/#DEF-07).)
- [Directory-slimming acceptance](docs/V1-RETIREMENT.md): the migrated candidate and per-layer results; it does not inherit passes from the original 1134 or earlier code windows.

Root `npm test` covers only the explicitly listed source/14-product and
history-read contracts. No repo-wide test discovery, no paused
qualification/domain-runner, no credential reuse, no journal wipes, no
receipt-editing to clear reds. **retry/backoff/deadline remains a real OPEN
debt** — see [continuation status](docs/TRUTHSRC-CONTINUATION.md).

## The only author surface & the directory contract

**Enter only via root `truthsrc.project.json` into `truth/bank-wealth/`.**
Business lives in the author tree; named technical choices in
`bindings/implementation/`. Never hand-edit canonical, complete requests,
SQLite stores, ledgers, anchors or generated code.

| Location | Responsibility |
|---|---|
| [`truth/bank-wealth/`](truth/bank-wealth/) | system/context declarations, four-flow knowledge, structure sharing, stories & provenance |
| [`truthsrc.project.json`](truthsrc.project.json) · [`bindings/implementation/`](bindings/implementation/) | project config & explicit technical choices |
| [`handwritten/scala/`](handwritten/scala/) | bank ports, owner/DTOs, TA/refund/SIP adapters, pages, runtime assembly |
| [`test/scala/`](test/scala/) | fixed business/readside/HTTP/recovery expectations, run only by explicit manifest |
| [`third-party/`](third-party/) | licenses and provenance materials that must stay |
| `generated/<owned>/` · `.truthsrc/` | owned generated project & derived knowledge/evidence — not a second author surface |
| [`tools/`](tools/) · [`test/`](test/) | orchestration tooling & explicit Node/Python contract tests; no `npm start` |
| `target/` · `.local/` · `dist/` | local candidates, supplies, run data; not in a fresh clone; do not clean or hand off wholesale |

35 handwritten files, 31 fixed tests and 14 licenses migrated byte-identical;
the old 497-file `v1/` material is preserved as fixed Git objects, retired
from the working tree ([V1 retirement](docs/V1-RETIREMENT.md)). Old trees,
the original README and the 1134 handover are read via the
[history index](docs/HISTORY.md) — no second author tree is restored, and
`/api/v1`-style business/protocol versions are not renamed to V2.

## 中文速览

本仓以**真源动作**为主线：`validate`（0 hard + roundtrip 字节等价）→ `compile` →
`graph`（389 节点/413 边）→ `generate`（235 文件 Play/CQRS 工程）→ `sbt compile/test`
（0 错误/23 通过）→ `verify-project`（792 锚）。四条业务线各对应一种协作形状：付款与
独立退款是 **saga**（跨聚合 TCC 事务，参与者/相位/绑定都在真源声明）；定投调度是
**pipeline**（步骤编排，显式调用 saga 并绑定持久事务身份）；TA 确认是外部系统观测。
完整中文文档与命令表：[TRUTH.md](TRUTH.md)、[银行工作坊](docs/BANK-WORKSHOP.md)、
[真源教程](docs/TRUTH-TUTORIAL.md)。分层验收与真实限制见上节，**完整服务尚未通过**。

## Keep reading

- **What came from where, what to build first:** [BUILD-RECIPE.md](docs/BUILD-RECIPE.md)
- **Learn the tool from zero:** the [Counter tutorial](../metarch-truthsrc/TUTORIAL.md) in an isolated project
- **Business + code in depth:** [TRUTH-TUTORIAL.md](docs/TRUTH-TUTORIAL.md) — generation, offline graph, span-exact reverse lookup, safe updates
- **Layer-by-layer verification:** [BANK-WORKSHOP.md](docs/BANK-WORKSHOP.md) — source / anchors / code / service reported separately
- **Command read/write surface:** [TRUTH-ENTRYPOINTS.md](docs/TRUTH-ENTRYPOINTS.md); the author contract: [TRUTH.md](TRUTH.md)
- **Tooling & extension points** (generator templates, product registry, query/MCP) start from the [truthsrc README](../metarch-truthsrc/README.md); adjacent checkouts required for those links.
- **The org site:** [co-arising.github.io](https://co-arising.github.io) — philosophy, the language spec, the live graph explorer, and the honest [status ledger](https://co-arising.github.io/status/).
