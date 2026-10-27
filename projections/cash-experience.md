# 现金申购体验与证据反馈

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

## 反馈状态（历史观测须按关联和水位合并，不直接覆盖终态）

| 状态 | 事件证据 | 文案 |
|---|---|---|
| 申请已记录 | FundOrder.FundPurchaseSettlementRequested | 申请已记录；这不证明扣款、募集账户入账或份额确认。 |
| 订单付款标记 | FundOrder.FundSubscriptionPaymentConfirmed | 订单已记录付款标记；完整现金成功仍需关联账户回执与付款结果证据。 |
| 现金付款成功证据 | FundOrder.FundCashPaymentSucceeded | 现金付款成功已记录；仍须匹配原交易和三参与者回执，不等于基金份额已确认。 |
| 付款无效果拒绝 | FundOrder.FundCashPaymentRejectedBeforeEffects | 现金付款在发生效果前被拒绝；不显示份额确认，也不授权付款后退款。 |
| 付款已补偿 | FundOrder.FundCashPaymentCompensated | 现金付款流程已补偿；这不是付款提交后的独立退款成功。 |
| 付款待恢复 | FundOrder.FundCashPaymentRecoveryRequired | 现金付款待恢复；保留原付款身份，核实后才可推进TA，不自动重新扣款。 |
| 付款结果未知 | FundOrder.FundCashPaymentOutcomeUnknown | 现金付款结果未知；等待同一交易核实，不新发付款，不授权退款。 |
| 等待TA结果 | FundOrder.FundTASubmissionRegistered | 已记录TA提交；请等待受理或最终回执，不要重复付款。 |
| TA已受理 | FundOrder.FundTAAccepted | TA已受理，不等于份额已确认。 |
| 份额已确认 | FundOrder.FundTASharesConfirmed | 已记录关联TA份额确认；净值和份额是独立演示fixture，不是真实定价。 |
| TA结果未知 | FundOrder.FundTAOutcomeUnknownObserved | TA结果仍待核实；未知不是拒绝，不授权退款或再次扣款。 |
| TA明确拒绝 | FundOrder.FundTARejected | 已记录关联TA拒绝；须经原付款证据和授权检查后申请独立退款，这不是已退款。 |
| 退款已申请 | FundOrder.FundPurchaseRefundRequested | 已记录独立退款申请；目标为原投资人账户，金额为原本金，尚不证明到账。 |
| 退款完成证据 | FundOrder.FundRefundCompleted | 已记录独立退款成功证据；仅在可信桥核实原交易、退款身份与现金回执后显示。 |
| 退款未启动 | FundOrder.FundPurchaseRefundRejected | 退款在发生效果前被拒绝；资金未由此证明返还，不自动新发扣款。 |
| 退款已补偿 | FundOrder.FundPurchaseRefundCompensated | 本次退款流程已补偿，不等于本金已退回；需要授权核查。 |
| 退款待恢复 | FundOrder.FundPurchaseRefundRecoveryRequired | 退款待人工或持久化恢复；保持原退款身份，不创建新退款。 |
| 退款结果未知 | FundOrder.FundPurchaseRefundOutcomeUnknownObserved | 退款结果未知，等待同一退款交易核实；不要显示完成或自动再次扣款。 |

## 反馈与无障碍约束

- 付款结果是独立维度：订单PAYMENT_SETTLED标记不单独证明完整付款成功；显示结果须经关联付款桥认证。
- TA未知是观测：恢复到确认/拒绝后，旧unknown记录不覆盖新终态；退款unknown同理。
- 不同身份的TA受理与确认分别展示；同身份同正文去重，同身份异正文显示冲突并停止自动推进。
- 仅TA_REJECTED + 成功付款与原请求证据授权独立退款；无投资者按钮接受自选退款金额/收款人。
- 源码声明不是自动运行；payment/TA/refund trusted bridges and read-model chronology remain pending。
- 状态使用文字与图标，不只靠颜色
- 清晰键盘焦点与逻辑阅读顺序
- 异步变化不抢焦点，礼貌播报等待/未知
- 金额币种、演示fixture与最后核实时间显式展示
- 传输错误保留请求身份，无自动重发金融操作
