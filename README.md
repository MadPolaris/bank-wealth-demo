# 银行账户核心 + 外部跨行转账 + 基金申购与定投 (`bank-wealth-demo`) 真源工程示例

本示例工程完整演示了如何结合 **事件风暴工作坊（Event Storming 7 Sessions）** 与 **产品设计五要素（战略、范围、结构、框架、表现）**，从零构建 `inbox/` 原始探索笔记，组装为符合 `truthsrc/v1`、`truthsrc.saga/v1`、`truthsrc.execution/v1` 规范的领域真源文件树，并最终编译为通过 Schema 严格校验的 AST/IR（`compiled/saga-ir.json` 与 `compiled/execution-ir.json`）以及手写隔离区回锚闭环。

---

## 一、 目录结构与五要素 × 事件风暴映射全景

```text
bank-wealth-demo/
├── README.md                                           # 工程总览、方法论映射与验证指南
├── bindings.json                                       # [表现/宿主绑定层] truthsrc.saga-binding/v1 严格 TCC 绑定
├── execution-bindings.json                             # [表现/宿主绑定层] truthsrc.execution-binding/v1 Pipeline + Monarch 绑定
├── runtime-binding.json                                # [表现/宿主绑定层] truthsrc.saga-runtime-binding/v2 Lowering 绑定
├── compiled/
│   ├── saga-ir.json                                    # [编译产物 AST] 通过 saga-ir-v1.schema.json 校验 (Digest: bc773fd698f998e0...)
│   └── execution-ir.json                               # [编译产物 AST] 通过 execution-ir-v1.schema.json 校验
├── isolation-zone/
│   ├── generated-scaffold/FundOrderGeneratedContract.scala # [代码脚手架] 编译器生成的不可变协议与状态折叠契约
│   ├── handwritten-adapter/FundOrderIsolationAdapter.scala # [手写隔离区] AI Agent 受限迭代的纯净 Port/Codec 实现
│   └── BACK_ANCHORING_WALKTHROUGH.md                   # [知识回锚实录] 从隔离区发现规则缺口并逆向回写 tree/ 的完整步骤
└── tree/                                               # [核心真源编辑树]
    ├── workshop.yaml                                   # 定义 7 个标准事件风暴阶段顺序
    ├── use-cases.yaml                                  # [范围层 Scope] 端到端用例、前置条件(invariantRef/errCode)与步骤
    ├── inbox/                                          # [战略层 Strategy] 工作坊发散期原始产物
    │   ├── eventStorming/                              # 5 个关键业务边界 Hotspot Questions (跨行超时、T+1 确认、定投余额不足等)
    │   └── commandStorming/                            # 3 个核心角色 (Investor/SipScheduler/WealthOpsOfficer) + 2 个外部系统
    ├── stories/                                        # [范围层 Scope] 3 个核心用户故事 (跨行充值、基金申购、定投计划)
    ├── value-objects/                                  # [框架层 Skeleton] Money (精确金额) 与 FundShare (确认份额与净值)
    ├── aggregates/                                     # [结构层 Structure & 框架层 Skeleton] 4 个核心聚合
    │   ├── credit-balance/                             # 1. 银行核心资金账户聚合 (双向 TCC 参与者：跨行入账 + 申购扣款)
    │   ├── external-transfer-order/                    # 2. 外部银行跨行清算指令聚合 (跨行代扣 TCC Source 参与者)
    │   ├── fund-order/                                 # 3. 基金交易订单聚合 (申购 TCC Target 参与者 + T+1 份额确认落账)
    │   └── sip-plan/                                   # 4. 基金定投计划聚合 (周期触发幂等账本 + 连续失败暂停)
    ├── policies/                                       # [结构层 Structure] 领域事件响应策略 (连续失败自动暂停定投)
    ├── read-models/                                    # [表现层 Surface] 投资者财富总览视图 & 定投计划执行视图
    ├── sagas/                                          # [结构层 Structure] 跨聚合严格 TCC 分布式事务
    │   ├── external-bank-transfer.saga.yaml            # Saga 1: 外部银行清算户 -> 本行核心账户 CreditBalance
    │   └── fund-subscription-pay.saga.yaml             # Saga 2: 本行核心账户 CreditBalance -> 基金订单 FundOrder
    └── pipelines/                                      # [结构层 Structure] 跨阶段长流程编排 (Execution v1 + Monarch)
        ├── fund-ta-settlement.pipeline.yaml            # 有界 Monarch 子计划：报送 TA -> 等待 T+1 净值 -> 确认份额
        ├── fund-purchase-invoke.pipeline.yaml          # 单次基金申购编排：invokeSaga(申购扣款) -> awaitChildRun(TA确认)
        ├── sip-installment-execution.pipeline.yaml     # 定投单期全链路编排：invokeSaga(跨行归集) -> invokeSaga(申购扣款) -> awaitChildRun(TA确认)
        └── sip-cross-bank-design-boundary.pipeline.yaml# Document-only 架构边界说明
```

---

## 二、 核心设计亮点（严格对齐 `SCHEMA.md` 与 Golden Master 约束）

1. **实时资金强一致（TCC Saga）与异步份额交割（Monarch Child Plan）彻底解耦**：
   - 跨行扣款（`external-bank-transfer`）和基金申购扣款（`fund-subscription-pay`）均采用 `truthsrc.saga/v1` 严格串行屏障（Group 1 Source Prepare → Group 2 Target Prepare → Durable CommitDecision → Commit）。
   - 基金公司 TA 份额确认（T+1）绝不阻塞在资金 TCC 事务内部，而是由父 Pipeline 通过 `awaitChildRun` 启动并观察有界 `monarch-persistence` 子计划（`fund-ta-settlement`）的持久化日志。
2. **全链路确定性幂等身份（Deterministic Identity Derivation）**：
   - 在 `sip-installment-execution.pipeline.yaml` 中，定投当期任务传入持久化的 `input:operation` 与 `input:occurrence`。
   - 第一步跨行资金归集使用 `stageId: "collect-external-funds"` 派生 `TxId`；第二步基金申购使用 `stageId: "pay-subscription"` 派生 `TxId`；第三步等待 TA 确认使用 `stepId: "await-ta-settlement"` 派生 `childRunIdentity`。三者在同一个定投周期内既共享溯源键、又拥有严格隔离的事务身份，支持任意节点崩溃后的安全重连（Re-attach）。
3. **无浮点数金额（Exact Minor-Unit Money）与无表达式业务面**：
   - 所有金额均通过 `Money`（`ISO-4217` + `minor-unit-string`）传递；所有聚合守卫均使用声明式结构（`map-absent`、`map-contains`、`money-sufficient`、`money-positive`）。
