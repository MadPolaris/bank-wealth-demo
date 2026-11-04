# Bank current technical bindings

These eight JSON files are explicit implementation choices selected by the root
`truthsrc.project.json`. They replace numbered `*-authored-*` directories as the
current editing surface. Older files remain immutable historical inputs.

- `payment/refund-sagas`: declared implementation authority, codec/resolver and
  phase/query bindings for the existing transaction contract.
- `payment/refund-runtime`: explicit strict runtime representation/API choices.
- Four `*-execution` files: concrete finite pipeline/effect execution bindings.

The complete request is **derived** through the public project/union compiler.
Payment/refund execution files no longer embed duplicate whole Saga bindings.
Business guards, fold rules, participant order, transaction identity semantics,
Saga resilience and effect contracts are owned by the author tree; don't change
these JSON files to override that truth. Any overlapping contract facts are
verified by the compiler, not merged by first/last precedence.

Exact value capacity and codec choices are explicit `exactTypes`/`exactCodecs`
in the root config: precision38 is technical capacity, not a product purchase
limit. Positive CNY policy remains in actual guards. Never put live secrets in
any of these inputs. Runtime artifact supply is a local frozen copy prepared from
the clean1134 archive, not a new publication. Retry/backoff/deadline remains OPEN.

Migration provenance and removed embedded-copy inventory are in
`../../docs/TRUTH-MIGRATION-EVIDENCE.json`.
