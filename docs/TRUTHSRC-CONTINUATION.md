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

## 4. 用户新增的交付结构与工具归属挂账

2026-11-06，用户指出目录精简后仍难以理解各类内容的来源、构建顺序、Scala产物分类及混合命名，并明确追加问题5：`tools/*.mjs`如何产生，可复用公共部分为什么没有归入`metarch-truthsrc`。本节是待办登记，不是新的跨仓迁移、R2实施或删除授权。

### 已核事实

- 银行当前有13个包含受跟踪文件的一级目录；本机另有`generated/`、`dist/`、`target/`三个非隐藏派生目录。`tools/`共62份受跟踪源码，其中58份`.mjs`、3份Python、1份Scala。文件数不是独立工具数，也不表示全部属于公共工具。
- 这些工具是在各轮开发与验收中编写的工程源码，不是当前银行真源经公共生成器自动产生的产物。例如`tools/truthsrc-project.mjs`来自`675a936`，`tools/verify-truthsrc-runtime.mjs`来自`f796362`，`tools/bank-workshop.mjs`来自`4515b6b`。coding agent编写不等于可以由真源确定性再生。
- 当前`truthsrc.project.json`明确选择作者树、8份技术binding、生成profile和外置手写根；`tools/truthsrc-project.mjs`只是公共API的本地包装。`handwritten/scala/`的35份实现和固定业务测试是独立维护输入；来源映射不等于其实现可自动生成。
- 根`formal-inputs/`是旧三合同运输模板，不是当前项目编译的必要人工阶段；`projections/`是旧业务文档投影，不是当前JDBC投影实现。其旧说明和目录名仍可能误导读者。暂停的qualification、旧绑定、旧编译物和历史读取需按各自保护合同处置，不能为减少目录而盲删。
- `playAkkaCQRS/knowledge_base/artifacts`是历史架构参照，不是完整现行目录。还需覆盖BC `tools/gen_pipeline.mjs`的JS最终写者，以及strict Saga和Monarch R1/R2的应用侧接线职责。语义产品、代码artifact类别、运行库内部类型和物理文件不是同一种计数。
- 当前Scala命名存在实质生成策略缺口：`render-invocation-execution.mjs`以`id.replaceAll('-', '_')`拼接类型/成员名；`render-aggregate-layers.mjs`以`Ingest`拼接同类ID；公共`symbol()`只做合法标识符/关键字处理，不区分类型名与成员名。稳定知识ID、持久化身份、PB/wire名称不能通过全局改驼峰一起改变。

### 后续归属与完成判据

1. **公共机制回流（任务172，待实施）。** 优先评估进程生命周期、来源指纹、独占租约、构建/报告核验和工作坊编排中的通用部分；归公共工具的可选runner/verifier能力，不将Docker/JDK变为基础真源CLI的必选依赖。先拆出银行政策和平台adapter，再迁机制，不能把硬编码银行路径/固定24恢复场景的文件直接搬入公共仓。
2. **银行专属输入保留。** 业务规则、技术选择、外部TA/页面/权限实现、模拟器、金融场景和独立oracle留银行；旧固定revision/发行读取按历史职责隔离。通用接口由公共工具定义，银行只提供配置、adapter与薄入口。
3. **补齐可解释构建顺序。** 区分人/agent补充业务与技术决策、公共编译展开、图/AST和代码生成、开放端口实现、独立业务验收。新业务仓应能消费安装后的公共工具与显式输入，不复制整套银行`tools/`；不能声称仅凭`truth/`即可重建所有实现和测试。
4. **建立版本化产物责任表。** 按BC的Scala及JS最终写者、当前strict Saga、Monarch新API共同归类；每项明确输入、producer、输出层/命名、手写/生成/runtime-library所有权、适用profile、回锚与验收。保持P23兼容和R2待接入状态分开；不因旧目录未列出就删新职责，也不把runtime的Coordinator复制生成为应用实现。
5. **目录和命名服从上述归属。** 默认开发视图只暴露业务作者输入、项目配置、手写实现、独立测试、文档与按需生成输出；历史与执行证据不成为新人必经步骤。Scala类型使用UpperCamelCase、成员使用lowerCamelCase，包/SQL/PB/稳定ID分别有各自规则；在公共生成器中统一解析与碰撞校验，不能手改生成Scala或重命名冻结载体消红。

此前兼容分层与指定测试成果保留，但不能代替上述产品结构和从零构建的可解释性。此次仅登记和评估；完整service重放阻断、材料分发、真人可用性及R2独立升级状态不变。

### 2026-11-07：artifactType最高优先级实施

用户批准先集中补齐artifactType说明，并追加`docs/artifacts/scala-cqrs/`层级。中央入口为[公共Scala CQRS目录](../../metarch-truthsrc/docs/artifacts/scala-cqrs/README.md)，[构建顺序](../../metarch-truthsrc/docs/artifacts/scala-cqrs/BUILD-ORDER.md)区分作者信息、公共加工及开放实现；BC/Play旧说明按中央目录派生，来源/覆盖和漂移单列。[P0验收记录](../../metarch-truthsrc/docs/artifacts/ACCEPTANCE.md)已记录125类别、8仓来源对账及冻结源码回归；这不是银行服务签收。当前仅实施说明及文档消费者，不改银行生成代码、金融规则、PB/PID、R2依赖或运行证据。P1公共工具归属、P2命名、P3银行目录及P4服务/人工验收仍按批准顺序独立进行。

### 2026-11-07：工程范式与参考实现首批

用户进一步明确：BC mjs产物结构未经打磨检验，不能当金样；对齐目的不止格式，而是让DDD、FP/OO、TDD、Akka/ES/CQRS和洋葱架构对人、agent、测试、治理、演进与追溯都容易落实。已授权继续主线并行推进，具体[参考开发与兼容合同](../../metarch-truthsrc/docs/artifacts/scala-cqrs/REFERENCE-DEVELOPMENT.md)在公共仓。

公共聚合生成已经拆为不可变结构模型与逐职责模板，保留原公开载体/协议/PB/PID/金融规则。七份独立Warehouse参考是工程候选，不冒称用户已批准金样；两版独立Scala编译及各24项行为测试通过，未使用BC mjs输出当预期。银行实际输入的纯计划229项中21个聚合文件有结构/排版变化，其余产物字节不变。[本轮新候选验收](architecture/AGGREGATE-REFERENCE-ACCEPTANCE.md)记录Actor64/Readside47、15/14保护检查及两候选229项相同源码；不是继承旧回执，也不关闭完整服务replay失败。

P1首个公共回流为显式手写来源验证：`tools/verify-handwritten-map.mjs`直接调用公共`lib/handwritten-provenance.mjs`，不再经旧发行helper的历史import闭包。银行继续控制当前snapshot、35文件/54引用和关系政策，原映射JSON/手写字节未改；20个公共测试、6个适配测试和3个原来源测试通过。公共模块接受任意领域的明确关联，仅验证文件/指针，不声明语义、symbol/span或运行认证。其他58个mjs中的机制仍须按职责收敛，不能据本次一项回流关闭整个P1。

本轮教学输出已经公共update同步233项，21源码加1输入证据发生写入；229源码/配置与两已验候选相同，repeat written=0。status current/synchronized，ReserveFunds到新Behaviors的精确span正反查通过。公共全量3121通过/15明确跳过/0失败；七参考与反例36通过、artifact28通过；安装后的公共来源API无需银行checkout。完整service重放、R2消费、其余目录/命名/公共工具和真人验收均未借此关闭。
