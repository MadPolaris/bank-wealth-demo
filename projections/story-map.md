# 用户故事地图：活动、任务与发布切片

> 派生设计提议，不是运行结果。修改来源便签，不手改此文件。

```mermaid
flowchart LR
  n_312e95f683bad126["查看账户与资金来源"]
  n_3b39970e3ba8291c["发起充值或申购"]
  n_c91a601af36dc611["配置定投"]
  n_77dc07dec0131751["查看证据与异常"]
  n_bb76bf67f1d9674a["选择资金来源并提交充值申请"]
  n_15da7aa8368f027e["选择基金、填写金额并确认申购"]
  n_67747805ca7e44b6["设置基金、金额和周期并创建定投计划"]
  n_27193a270689446d["查看申购进度与异常处理说明"]
  n_d9c26c1e8b99d342["等待份额确认或跟踪拒绝后的退款进度"]
  n_d6035f5622b8e9af["查看各期扣款、申购和确认结果"]
  n_af1091f7e86594b5["查询外部入金的最终结果并处理异常"]
  n_9cf8a68ddfca416e["查询基金拒绝后的退款到账结果"]
  n_81a6a1ea2911b1e5["现在：真源设计预览"]
  n_fab70d383205ae1e["后续：获准TA模拟运行"]
  n_9effe2241a38a3b8["延后：真实外部集成"]
  n_79964ffd134be20f["ux.scope"]
  n_8fe3f4506370732b["mock-ta.registry"]
  n_4a3433c2bd2800f9["decision.external-bank"]
  n_312e95f683bad126 -->|"proposed story-map task"| n_bb76bf67f1d9674a
  n_3b39970e3ba8291c -->|"proposed story-map task"| n_15da7aa8368f027e
  n_c91a601af36dc611 -->|"proposed story-map task"| n_67747805ca7e44b6
  n_77dc07dec0131751 -->|"proposed story-map task"| n_27193a270689446d
  n_77dc07dec0131751 -->|"proposed story-map task"| n_d9c26c1e8b99d342
  n_77dc07dec0131751 -->|"proposed story-map task"| n_d6035f5622b8e9af
  n_3b39970e3ba8291c -->|"proposed story-map task"| n_af1091f7e86594b5
  n_77dc07dec0131751 -->|"proposed story-map task"| n_9cf8a68ddfca416e
  n_bb76bf67f1d9674a -->|"proposed release allocation"| n_81a6a1ea2911b1e5
  n_15da7aa8368f027e -->|"proposed release allocation"| n_81a6a1ea2911b1e5
  n_67747805ca7e44b6 -->|"proposed release allocation"| n_81a6a1ea2911b1e5
  n_27193a270689446d -->|"proposed release allocation"| n_81a6a1ea2911b1e5
  n_d9c26c1e8b99d342 -->|"proposed release allocation"| n_fab70d383205ae1e
  n_d6035f5622b8e9af -->|"proposed release allocation"| n_fab70d383205ae1e
  n_af1091f7e86594b5 -->|"proposed release allocation"| n_9effe2241a38a3b8
  n_9cf8a68ddfca416e -->|"proposed release allocation"| n_fab70d383205ae1e
  n_fab70d383205ae1e -->|"TA-only permitted mock, not an implemented runtime"| n_8fe3f4506370732b
  n_9effe2241a38a3b8 -->|"external integration deferred pending approval/capability"| n_4a3433c2bd2800f9
```

## 来源

- `ux.scope`：`tree/inbox/storyMapping/story-sm-wealth-ux-scope-design-proposal-0.yaml/payload/info/artifact`

## 显式故事映射

| 活动 | 任务 | 故事 | 发布切片 |
|---|---|---|---|
| activity.prepare | 选择资金来源并提交充值申请 | TopUpFromExternalBank | release.truth-preview |
| activity.fund | 选择基金、填写金额并确认申购 | PurchaseFund | release.truth-preview |
| activity.plan | 设置基金、金额和周期并创建定投计划 | CreateAndRunSipPlan | release.truth-preview |
| activity.observe | 查看申购进度与异常处理说明 | PurchaseFund | release.truth-preview |
| activity.observe | 等待份额确认或跟踪拒绝后的退款进度 | PurchaseFund | release.mock-runtime |
| activity.observe | 查看各期扣款、申购和确认结果 | CreateAndRunSipPlan | release.mock-runtime |
| activity.fund | 查询外部入金的最终结果并处理异常 | TopUpFromExternalBank | release.external-integration |
| activity.observe | 查询基金拒绝后的退款到账结果 | PurchaseFund | release.mock-runtime |

## 活动主干顺序

1. `activity.prepare`
2. `activity.fund`
3. `activity.plan`
4. `activity.observe`
