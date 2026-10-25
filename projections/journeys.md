# 用户旅程与信息架构

> 派生设计提议，不是运行结果。修改来源便签，不手改此文件。

```mermaid
flowchart LR
  n_a7437a442b6c219b["充值证据旅程"]
  n_f2fc3d9ccd4f8043["申购与交割证据旅程"]
  n_cc11a4c9b31a3aac["计划与本期执行证据旅程"]
  n_d454aa531f08d224["了解关联账户与外部能力边界"]
  n_ccfc2604c4873ebb["提交已声明的充值申请契约"]
  n_afbf87c341f8da70["等待可核实入账证据"]
  n_7ddf0167ed2bce29["查看基金与金额输入框架"]
  n_b04883c86abda987["提交申购申请契约"]
  n_9fa50c1f777820e7["查看本地付款结算证据"]
  n_71fb154b2b8b93d2["查看TA份额证据或未知异常"]
  n_92899c225603f591["授权核查异常状态契约"]
  n_9c8cd65f113bebf3["了解计划输入与日历缺口"]
  n_d815be42ad1b5c54["提交计划创建契约"]
  n_21541b5921d38215["系统触发本期，不是投资者按钮"]
  n_8b2124ad3129a11b["查看计划与本期执行证据"]
  n_e409f378e317f588["提交既有暂停契约"]
  n_e05cc21a3033962a["财富入口"]
  n_4ce0e2e9901233c5["充值入口"]
  n_b2ae75113ebda94a["申购入口"]
  n_3379fa5a6ee1330c["订单证据入口"]
  n_ba65817b044ae8c4["计划建立入口"]
  n_2a6983ed18acdfae["计划执行入口"]
  n_426becc55da4ad8d["投资者真源预览"]
  n_4321494e05df38b3["授权运营核查"]
  n_3ffa76f70f34874b["系统调度边界"]
  n_d0835fd542d12779["ux.structure"]
  n_79964ffd134be20f["ux.scope"]
  n_b67678e238ad1fae["screen.wealth"]
  n_8b0364858c5f5b76["screen.top-up"]
  n_d409f3e000251a31["screen.purchase"]
  n_27f2ebab1162527e["screen.fund-order"]
  n_12c56cf7f56d1c57["screen.sip-create"]
  n_d46f831e6f30be49["screen.sip-detail"]
  n_77252c6540fa6a68["timer.sip-due"]
  n_9a225c22a9fccb53["action.inspect-order"]
  n_38c4122f1033a409["action.open-top-up"]
  n_74cfe4e46219f93f["action.request-top-up"]
  n_76699b574b7560ac["action.open-purchase"]
  n_503ab97880494330["action.request-fund"]
  n_e23ba6490173c5b8["action.open-fund-order"]
  n_74b195e60ee8f8b9["action.open-sip-create"]
  n_bad9fb4c751b6055["action.create-sip"]
  n_e383716561937968["action.open-sip-detail"]
  n_41562372b9799d75["action.pause-sip"]
  n_d454aa531f08d224 -->|"proposed journey progression; not runtime guarantee"| n_ccfc2604c4873ebb
  n_ccfc2604c4873ebb -->|"proposed journey progression; not runtime guarantee"| n_afbf87c341f8da70
  n_7ddf0167ed2bce29 -->|"proposed journey progression; not runtime guarantee"| n_b04883c86abda987
  n_b04883c86abda987 -->|"proposed journey progression; not runtime guarantee"| n_9fa50c1f777820e7
  n_9fa50c1f777820e7 -->|"proposed journey progression; not runtime guarantee"| n_71fb154b2b8b93d2
  n_71fb154b2b8b93d2 -->|"proposed journey progression; not runtime guarantee"| n_92899c225603f591
  n_9c8cd65f113bebf3 -->|"proposed journey progression; not runtime guarantee"| n_d815be42ad1b5c54
  n_d815be42ad1b5c54 -->|"proposed journey progression; not runtime guarantee"| n_21541b5921d38215
  n_21541b5921d38215 -->|"proposed journey progression; not runtime guarantee"| n_8b2124ad3129a11b
  n_8b2124ad3129a11b -->|"proposed journey progression; not runtime guarantee"| n_e409f378e317f588
  n_e05cc21a3033962a -->|"proposed top-up navigation"| n_4ce0e2e9901233c5
  n_e05cc21a3033962a -->|"proposed purchase navigation"| n_b2ae75113ebda94a
  n_b2ae75113ebda94a -->|"proposed correlated order evidence"| n_3379fa5a6ee1330c
  n_e05cc21a3033962a -->|"proposed plan creation navigation"| n_ba65817b044ae8c4
  n_ba65817b044ae8c4 -->|"proposed plan evidence navigation"| n_2a6983ed18acdfae
  n_a7437a442b6c219b -->|"proposed story trace"| n_79964ffd134be20f
  n_f2fc3d9ccd4f8043 -->|"proposed story trace"| n_79964ffd134be20f
  n_cc11a4c9b31a3aac -->|"proposed story trace"| n_79964ffd134be20f
  n_e05cc21a3033962a -->|"proposed information architecture screen target"| n_b67678e238ad1fae
  n_4ce0e2e9901233c5 -->|"proposed information architecture screen target"| n_8b0364858c5f5b76
  n_b2ae75113ebda94a -->|"proposed information architecture screen target"| n_d409f3e000251a31
  n_3379fa5a6ee1330c -->|"proposed information architecture screen target"| n_27f2ebab1162527e
  n_ba65817b044ae8c4 -->|"proposed information architecture screen target"| n_12c56cf7f56d1c57
  n_2a6983ed18acdfae -->|"proposed information architecture screen target"| n_d46f831e6f30be49
  n_3ffa76f70f34874b -->|"system trigger, not investor action"| n_77252c6540fa6a68
  n_4321494e05df38b3 -->|"authorized query contract; host capability missing"| n_9a225c22a9fccb53
  n_a7437a442b6c219b -->|"故事 TopUpFromExternalBank"| n_d454aa531f08d224
  n_d454aa531f08d224 -->|"交互触点"| n_8b0364858c5f5b76
  n_d454aa531f08d224 -->|"参与者 Investor"| n_38c4122f1033a409
  n_ccfc2604c4873ebb -->|"交互触点"| n_8b0364858c5f5b76
  n_ccfc2604c4873ebb -->|"参与者 Investor"| n_74cfe4e46219f93f
  n_afbf87c341f8da70 -->|"交互触点"| n_8b0364858c5f5b76
  n_afbf87c341f8da70 -->|"参与者 Investor"| n_38c4122f1033a409
  n_f2fc3d9ccd4f8043 -->|"故事 PurchaseFund"| n_7ddf0167ed2bce29
  n_7ddf0167ed2bce29 -->|"交互触点"| n_d409f3e000251a31
  n_7ddf0167ed2bce29 -->|"参与者 Investor"| n_76699b574b7560ac
  n_b04883c86abda987 -->|"交互触点"| n_d409f3e000251a31
  n_b04883c86abda987 -->|"参与者 Investor"| n_503ab97880494330
  n_9fa50c1f777820e7 -->|"交互触点"| n_27f2ebab1162527e
  n_9fa50c1f777820e7 -->|"参与者 Investor"| n_e23ba6490173c5b8
  n_71fb154b2b8b93d2 -->|"交互触点"| n_27f2ebab1162527e
  n_71fb154b2b8b93d2 -->|"参与者 Investor"| n_e23ba6490173c5b8
  n_92899c225603f591 -->|"交互触点"| n_27f2ebab1162527e
  n_92899c225603f591 -->|"参与者 WealthOpsOfficer"| n_9a225c22a9fccb53
  n_cc11a4c9b31a3aac -->|"故事 CreateAndRunSipPlan"| n_9c8cd65f113bebf3
  n_9c8cd65f113bebf3 -->|"交互触点"| n_12c56cf7f56d1c57
  n_9c8cd65f113bebf3 -->|"参与者 Investor"| n_74b195e60ee8f8b9
  n_d815be42ad1b5c54 -->|"交互触点"| n_12c56cf7f56d1c57
  n_d815be42ad1b5c54 -->|"参与者 Investor"| n_bad9fb4c751b6055
  n_21541b5921d38215 -->|"参与者 SipScheduler"| n_77252c6540fa6a68
  n_8b2124ad3129a11b -->|"交互触点"| n_d46f831e6f30be49
  n_8b2124ad3129a11b -->|"参与者 Investor"| n_e383716561937968
  n_e409f378e317f588 -->|"交互触点"| n_d46f831e6f30be49
  n_e409f378e317f588 -->|"参与者 Investor"| n_41562372b9799d75
```

## 来源

- `ux.structure`：`tree/inbox/storyMapping/relation-sm-wealth-ux-structure-design-proposal-1.yaml/payload/info/artifact`

## 充值证据旅程 — TopUpFromExternalBank

| 阶段 | 参与者 | 动作 | 触点 | 信息需求 | 实现状态 |
|---|---|---|---|---|---|
| 了解关联账户与外部能力边界 | Investor | action.open-top-up | screen.top-up | 来源/目标账户授权；外部能力未验证说明 | missing |
| 提交已声明的充值申请契约 | Investor | action.request-top-up | screen.top-up | 金额与币种；请求身份与重试说明 | declared |
| 等待可核实入账证据 | Investor | action.open-top-up | screen.top-up | 请求已记录不等于已入账；关联入账查询缺口 | missing |

## 申购与交割证据旅程 — PurchaseFund

| 阶段 | 参与者 | 动作 | 触点 | 信息需求 | 实现状态 |
|---|---|---|---|---|---|
| 查看基金与金额输入框架 | Investor | action.open-purchase | screen.purchase | 基金代码；金额；最低限额/费用/日历未决 | missing |
| 提交申购申请契约 | Investor | action.request-fund | screen.purchase | 安全请求身份；申请已记录文案 | declared |
| 查看本地付款结算证据 | Investor | action.open-fund-order | screen.fund-order | 付款结算事件；不提前显示份额确认 | missing |
| 查看TA份额证据或未知异常 | Investor | action.open-fund-order | screen.fund-order | 确认份额；任意演示净值说明；未知/退款需求区分 | missing |
| 授权核查异常状态契约 | WealthOpsOfficer | action.inspect-order | screen.fund-order | 本地写侧证据；TA查询/退款桥接缺口 | declared |

## 计划与本期执行证据旅程 — CreateAndRunSipPlan

| 阶段 | 参与者 | 动作 | 触点 | 信息需求 | 实现状态 |
|---|---|---|---|---|---|
| 了解计划输入与日历缺口 | Investor | action.open-sip-create | screen.sip-create | 基金/金额/关联账户；cron转换与日历规则未决 | missing |
| 提交计划创建契约 | Investor | action.create-sip | screen.sip-create | 计划身份；计划配置 | declared |
| 系统触发本期，不是投资者按钮 | SipScheduler | timer.sip-due | 系统触点 | 稳定operationId/occurrence；计划与金额一致性 | declared |
| 查看计划与本期执行证据 | Investor | action.open-sip-detail | screen.sip-detail | 本期操作身份；成功/失败终态与计数缺口 | missing |
| 提交既有暂停契约 | Investor | action.pause-sip | screen.sip-detail | 暂停原因；进行中任务处理未决 | declared |
