# 候选上下文地图

> 派生设计提议，不是运行结果。修改来源便签，不手改此文件。

```mermaid
flowchart LR
  n_4db67ec8001f620b["外部银行/清算边界"]
  n_5a340c1420b40bb3["基金TA边界"]
  n_315e7b68f350fb29["账户记账"]
  n_e52592f6402fe1ec["支付与外部银行指令"]
  n_0395c784725ea198["基金申购与定投"]
  n_cc1ed0a65fec1093["context-map.wealth"]
  n_8fe3f4506370732b["mock-ta.registry"]
  n_4a3433c2bd2800f9["decision.external-bank"]
  n_e4f8ca237ab4b3b8["subdomain.fund"]
  n_325b646a2610fa3f["subdomain.ledger"]
  n_6cedbf5bf34abc20["subdomain.payments"]
  n_e52592f6402fe1ec -->|"proposed anti-corruption boundary: capability and reconciliation pending"| n_4db67ec8001f620b
  n_e52592f6402fe1ec -->|"proposed correlated incoming-credit contract"| n_315e7b68f350fb29
  n_0395c784725ea198 -->|"proposed local fund payment/reservation contract"| n_315e7b68f350fb29
  n_0395c784725ea198 -->|"proposed asynchronous submission/confirmation boundary"| n_5a340c1420b40bb3
  n_5a340c1420b40bb3 -->|"permitted TA fixture proposal; no real integration"| n_8fe3f4506370732b
  n_4db67ec8001f620b -->|"do not infer remote debit/prepare/commit behavior"| n_4a3433c2bd2800f9
  n_0395c784725ea198 -->|"proposed problem-space mapping"| n_e4f8ca237ab4b3b8
  n_315e7b68f350fb29 -->|"proposed problem-space mapping"| n_325b646a2610fa3f
  n_e52592f6402fe1ec -->|"proposed problem-space mapping"| n_6cedbf5bf34abc20
```

## 来源

- `context-map.wealth`：`tree/inbox/contextMapping/relation-cm-wealth-context-map-design-proposal-3.yaml/payload/info/artifact`
- `context.fund`：`tree/inbox/contextMapping/context-cm-wealth-fund-context-design-proposal-2.yaml/payload/info/artifact`
- `context.ledger`：`tree/inbox/contextMapping/context-cm-wealth-ledger-context-design-proposal-0.yaml/payload/info/artifact`
- `context.payments`：`tree/inbox/contextMapping/context-cm-wealth-payments-context-design-proposal-1.yaml/payload/info/artifact`
