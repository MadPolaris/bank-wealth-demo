# 真源工具链：当前续接状态

日期：2026-11-06。本文只保留当前状态、剩余门与实质债务，不重启旧“首批入口”计划。原2026-11-04交接、现场HEAD及启动文本已固定在[历史索引](HISTORY.md#reading-archive)；它们不是今天的工作树状态。

## 1. 已有入口与本次精简

- 当前入口是根`truthsrc.project.json`及`truth/bank-wealth/`。公共编译、图导出AST生成、回锚、双向查询、受控update与教程已经存在，不再写成待从零实施。
- 紧凑作者树、生成Repository/Bootstrap及JDBC读侧已被银行消费。业务owner、查询DTO、endpoint、页面和外部适配仍属手写；参阅[架构职责](architecture/README.md)。
- [兼容迁移验收](TRUTH-COMPATIBLE-COMPOSITION.md)及[新人交付回执](ONBOARDING-ACCEPTANCE.md)记录各自候选的代码、图和固定恢复实测，不自动覆盖此后的路径/源码变化。原1134只关闭其[25项有界发行合同](HISTORY.md#release-1134)。
- 当前有界精简把35份手写、31份固定测试、14份许可分别归到`handwritten/scala/`、`test/scala/`、`third-party/`；497份历史`v1/`材料由精确Git对象保留。清单见[manifest](V1-RETIREMENT-MANIFEST.json)，不是全门通过回执。

目录、历史读取、当前手写映射及作者证据定位已完成并通过定向验证，实际新候选与运行门见[V1-RETIREMENT.md](V1-RETIREMENT.md)。作者改动仅为逐项记录的证据定位，业务声明/固定oracle不变；原验收证据未重签。

## 2. 尚未完成的事实与继续工作的边界

1. **完整service仍失败，人工会话未执行。** service02使用旧P23制品，代码/24恢复窗及真实数据库initial/restart/refund通过；replay全新读库90秒未caught-up，完整结果false。两数据库/relay/lease已归还，失败数据保留；未增大超时或改oracle。用户提供的[Monarch R2候选已单独核验](MONARCH-R2-DOWNSTREAM.md)，下游尚未升级，不能将该失败归因R2或直接换JAR。
2. **冻结供给的公开取得渠道未落实。** source首次doctor/validate/compile不需要JVM或归档；后续完整生成仍需六份冻结JAR/POM，现有prepare从clean1134提取。本地归档/CLI包存在不等于已发布、可自助下载或交付完成。
3. **真人可用性未签收。** 自动化、代理或浏览器检查不能代替未参与实现读者的实际上手。
4. **retry/backoff/deadline仍OPEN。** 见下节；不因教程、路径迁移或指定恢复窗通过而豁免。

继续操作使用[当前命令与读写表](TRUTH-ENTRYPOINTS.md)和[工作坊](BANK-WORKSHOP.md)，共享接口/生成apply归主集成，手写模块按独占写面协作。重型执行另约窗口；不恢复暂停runner、不清失败/journal、不复用旧凭据、不写共享生成应用。文档任务不授权runtime修复、服务启停、下载、commit/push或发布。

## 3. 重试挂账：OPEN，未修复、未接受限制

**真源声明的故障重试、退避及期限策略，与strict执行路径尚未贯通。** 这是实质能力债，不是用户接受的有限profile限制；登记此债不撤销1134原范围签收，也不自动授权修复/重发runtime。

已有债务定位（本轮未重新执行runtime验证）：

- lowering是生成前的模型转换，不是故障发生后进入的状态。[runtime-binding-pure.mjs](../../metarch-truthsrc/lib/saga/runtime-binding-pure.mjs)的受限路径拒绝`maxAttempts > 1`、非零backoff及不同phase/query timeout；只下沉interactionTimeout，总期限仍是未验证宿主义务。
- [render-host.mjs](../../metarch-truthsrc/generators/scala-cqrs-application/render-host.mjs)中的`maxReconcileInteractions=32`是单次恢复授权的交互预算，不是业务重试次数。
- [StrictSagaCoordinator.scala](../../saga-core/src/main/scala/net/imadz/infra/saga/strict/StrictSagaCoordinator.scala)对未知/超时等未决证据进入RecoveryRequired；可信Reconcile可核实后继续，安全未执行证据成立时允许同一operation identity重发。不能误称“一辈子只执行一次”。
- journal replay不等于自动重驱动。Reconcile可以由可信服务发起，不一定靠人工点击；**银行自动调用者、连续故障退避及跨重启续接仍需按实际消费路径验清**。
- 旧[StepExecutorCommandHandler.scala](../../saga-core/src/main/scala/net/imadz/infra/saga/handlers/StepExecutorCommandHandler.scala)有retry/backoff，不能给另一条strict生成链背书。

关闭此债至少需要独立核定并验证：

1. 真实调用者/触发机制、尝试次数是否含首次请求、execute/query计数与期限，以及预算怎样跨重启保存；真源值必须控制生成代码与执行行为。
2. 区分确定未执行、结果未知、业务拒绝和已耐久Commit；未知先核实，不换交易ID盲重扣，Commit决定后不能改成abort/补偿。
3. 暂时故障在安全条件成立后自动继续；连续失败有退避/预算和明确的人工介入条件，而非把普通网络抖动永久挂为工单。
4. 覆盖暂时失败后成功、ACK丢失但已执行、预算耗尽、同ID重发及恢复中再次重启等反例，并对齐真源、生成端和冻结/新制品。

0.2.0无消费者不要求为其兼容，但P23已签出制品仍冻结。若后续需要改runtime，使用新版本和新证据，不覆盖原制品、journal或1134记录；本次目录精简不承担这项实施。
