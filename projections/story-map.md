# 用户故事地图：活动、任务与发布切片

> 派生设计提议，不是运行结果。修改来源便签，不手改此文件。

```mermaid
flowchart LR
  n_26582dd5a5a080c7["现金申购确认"]
  n_527efc59ad608e65["现金申购／TA／退款证据"]
  n_949630350a00e464["查看现金申购"]
  n_ba0381aab172195d["提交现金申购"]
  n_ee99b604c1fc2f9a["查看原现金订单"]
  n_899d08ddda8dba97["现金申购与拒绝退款旅程"]
  n_9399f6ea4070563a["选择基金与本金，核对资金路径"]
  n_6a6e7a310f954792["确认并提交唯一现金申购入口"]
  n_20c21afeed91106d["等待实际账户与订单付款证据"]
  n_05f0edb5b072ac20["查看TA受理、确认、拒绝或未知"]
  n_82dc38ed0ed4d2b2["拒绝后跟踪独立退款"]
  n_c77f4a8f16684b7f["申请已记录"]
  n_1ec6c4438e09580e["申请已记录；这不证明扣款、募集账户入账或份额确认。"]
  n_19b4b5c6424782b8["订单付款标记"]
  n_29ca2c9c8af640b7["订单已记录付款标记；完整现金成功仍需关联账户回执与付款结果证据。"]
  n_299d440a969a1a14["现金付款成功证据"]
  n_090f35f4cc76b423["现金付款成功已记录；仍须匹配原交易和三参与者回执，不等于基金份额已确认。"]
  n_653f798b4890317e["付款无效果拒绝"]
  n_a27330960f69f881["现金付款在发生效果前被拒绝；不显示份额确认，也不授权付款后退款。"]
  n_6fde2150d75d3a2c["付款已补偿"]
  n_d60795dc31be4946["现金付款流程已补偿；这不是付款提交后的独立退款成功。"]
  n_5f04990a4864e400["付款待恢复"]
  n_013ed82042fc4cbd["现金付款待恢复；保留原付款身份，核实后才可推进TA，不自动重新扣款。"]
  n_c51e9da7c9aeeeb2["付款结果未知"]
  n_c9d1e7859748566f["现金付款结果未知；等待同一交易核实，不新发付款，不授权退款。"]
  n_a346fbcd57ab6f9d["等待TA结果"]
  n_707b9c5d58f3a2cc["已记录TA提交；请等待受理或最终回执，不要重复付款。"]
  n_0ac52314a50e07fd["TA已受理"]
  n_00ebfc4a0526cc33["TA已受理，不等于份额已确认。"]
  n_ab98736f1226f94c["份额已确认"]
  n_69a2f44902d06b7f["已记录关联TA份额确认；净值和份额是独立演示fixture，不是真实定价。"]
  n_eaec937e19961b2a["TA结果未知"]
  n_aeed7b9b70d73041["TA结果仍待核实；未知不是拒绝，不授权退款或再次扣款。"]
  n_32ab8f48c1e8b55e["TA明确拒绝"]
  n_b3e3b4230f0eefb7["已记录关联TA拒绝；须经原付款证据和授权检查后申请独立退款，这不是已退款。"]
  n_415ed8cf69f0eca7["退款已申请"]
  n_e62307fc24646909["已记录独立退款申请；目标为原投资人账户，金额为原本金，尚不证明到账。"]
  n_45f7dc72b90c3e7a["退款完成证据"]
  n_fd8882cd63847a6c["已记录独立退款成功证据；仅在可信桥核实原交易、退款身份与现金回执后显示。"]
  n_56d8c32d518a4867["退款未启动"]
  n_36cc02c14cd773ba["退款在发生效果前被拒绝；资金未由此证明返还，不自动新发扣款。"]
  n_77be155b02d29622["退款已补偿"]
  n_445def6af1df1aca["本次退款流程已补偿，不等于本金已退回；需要授权核查。"]
  n_0a0183bc909c114c["退款待恢复"]
  n_91fd99f77f5a314b["退款待人工或持久化恢复；保持原退款身份，不创建新退款。"]
  n_668353b00edb76ec["退款结果未知"]
  n_afe73cd32f2897d1["退款结果未知，等待同一退款交易核实；不要显示完成或自动再次扣款。"]
  n_f1f0cd3e5d978bf6["选择基金并确认现金申购"]
  n_b242cb0665579f00["核查TA与退款证据"]
  n_8ecfd1eee7bad71e["ux.cash-v2"]
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
  n_9399f6ea4070563a -->|"提议体验顺序，非运行保证"| n_6a6e7a310f954792
  n_6a6e7a310f954792 -->|"提议体验顺序，非运行保证"| n_20c21afeed91106d
  n_20c21afeed91106d -->|"提议体验顺序，非运行保证"| n_05f0edb5b072ac20
  n_05f0edb5b072ac20 -->|"仅明确拒绝且付款成功；确认份额不走退款"| n_82dc38ed0ed4d2b2
  n_26582dd5a5a080c7 -->|"唯一新现金请求"| n_ba0381aab172195d
  n_26582dd5a5a080c7 -->|"确认后按原订单身份导航，不重提请求"| n_527efc59ad608e65
  n_c77f4a8f16684b7f -->|"有证据的反馈"| n_1ec6c4438e09580e
  n_19b4b5c6424782b8 -->|"有证据的反馈"| n_29ca2c9c8af640b7
  n_299d440a969a1a14 -->|"有证据的反馈"| n_090f35f4cc76b423
  n_653f798b4890317e -->|"有证据的反馈"| n_a27330960f69f881
  n_6fde2150d75d3a2c -->|"有证据的反馈"| n_d60795dc31be4946
  n_5f04990a4864e400 -->|"有证据的反馈"| n_013ed82042fc4cbd
  n_c51e9da7c9aeeeb2 -->|"有证据的反馈"| n_c9d1e7859748566f
  n_a346fbcd57ab6f9d -->|"有证据的反馈"| n_707b9c5d58f3a2cc
  n_0ac52314a50e07fd -->|"有证据的反馈"| n_00ebfc4a0526cc33
  n_ab98736f1226f94c -->|"有证据的反馈"| n_69a2f44902d06b7f
  n_eaec937e19961b2a -->|"有证据的反馈"| n_aeed7b9b70d73041
  n_32ab8f48c1e8b55e -->|"有证据的反馈"| n_b3e3b4230f0eefb7
  n_415ed8cf69f0eca7 -->|"有证据的反馈"| n_e62307fc24646909
  n_45f7dc72b90c3e7a -->|"有证据的反馈"| n_fd8882cd63847a6c
  n_56d8c32d518a4867 -->|"有证据的反馈"| n_36cc02c14cd773ba
  n_77be155b02d29622 -->|"有证据的反馈"| n_445def6af1df1aca
  n_0a0183bc909c114c -->|"有证据的反馈"| n_91fd99f77f5a314b
  n_668353b00edb76ec -->|"有证据的反馈"| n_afe73cd32f2897d1
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
  n_899d08ddda8dba97 -->|"故事 CashFundPurchaseLifecycle"| n_9399f6ea4070563a
  n_9399f6ea4070563a -->|"交互触点"| n_26582dd5a5a080c7
  n_9399f6ea4070563a -->|"参与者 Investor"| n_949630350a00e464
  n_6a6e7a310f954792 -->|"交互触点"| n_26582dd5a5a080c7
  n_6a6e7a310f954792 -->|"参与者 Investor"| n_ba0381aab172195d
  n_20c21afeed91106d -->|"交互触点"| n_527efc59ad608e65
  n_20c21afeed91106d -->|"参与者 Investor"| n_ee99b604c1fc2f9a
  n_05f0edb5b072ac20 -->|"交互触点"| n_527efc59ad608e65
  n_05f0edb5b072ac20 -->|"参与者 Investor"| n_ee99b604c1fc2f9a
  n_82dc38ed0ed4d2b2 -->|"交互触点"| n_527efc59ad608e65
  n_82dc38ed0ed4d2b2 -->|"参与者 Investor"| n_ee99b604c1fc2f9a
```

## 来源

- `ux.cash-v2`：`tree/inbox/storyMapping/relation-sm-cash-purchase-v2-experience-proposal-0.yaml/payload/info/artifact`
- `ux.scope`：`tree/inbox/storyMapping/story-sm-wealth-ux-scope-design-proposal-0.yaml/payload/info/artifact`

## 显式故事映射

| 活动 | 任务 | 故事 | 发布切片 |
|---|---|---|---|
| activity.fund | 选择基金并确认现金申购 | CashFundPurchaseLifecycle | release.truth-preview |
| activity.observe | 核查TA与退款证据 | CashFundPurchaseLifecycle | release.mock-runtime |

## 活动主干顺序

1. `activity.fund`
2. `activity.observe`

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
