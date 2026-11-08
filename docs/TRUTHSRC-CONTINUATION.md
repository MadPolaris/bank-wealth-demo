# 真源工具链：当前续接状态

日期：2026-11-08。本文只保留当前状态、剩余门与实质债务，不重启旧“首批入口”计划。原2026-11-04交接、现场HEAD及启动文本已固定在[历史索引](HISTORY.md#reading-archive)；它们不是今天的工作树状态。

## 1. 已有入口与本次精简

- 当前入口是根`truthsrc.project.json`及`truth/bank-wealth/`。公共编译、图导出AST生成、回锚、双向查询、受控update与教程已经存在，不再写成待从零实施。
- 紧凑作者树、生成Repository/Bootstrap及JDBC读侧已被银行消费。业务owner、查询DTO、endpoint、页面和外部适配仍属手写；参阅[架构职责](architecture/README.md)。
- [兼容迁移验收](TRUTH-COMPATIBLE-COMPOSITION.md)及[新人交付回执](ONBOARDING-ACCEPTANCE.md)记录各自候选的代码、图和固定恢复实测，不自动覆盖此后的路径/源码变化。原1134只关闭其[25项有界发行合同](HISTORY.md#release-1134)。
- 当前有界精简把35份手写、31份固定测试、14份许可分别归到`handwritten/scala/`、`test/scala/`、`third-party/`；497份历史`v1/`材料由精确Git对象保留。清单见[manifest](V1-RETIREMENT-MANIFEST.json)，不是全门通过回执。

目录、历史读取、当前手写映射及作者证据定位已完成并通过定向验证，实际新候选与运行门见[V1-RETIREMENT.md](V1-RETIREMENT.md)。作者改动仅为逐项记录的证据定位，业务声明/固定oracle不变；原验收证据未重签。

## 2. 尚未完成的事实与继续工作的边界

公共工具第三批新增显式[family1领域kernel](../../metarch-truthsrc/docs/artifacts/scala-cqrs/DOMAIN-KERNEL.md)，值／纯协议／State／RuleParams及必要真实PB转换已形成非银行candidate。逐门结果见[第三批验收](../../metarch-truthsrc/docs/artifacts/DOMAIN-KERNEL-ACCEPTANCE.md)；银行仍选原Play-service/P23入口，本轮只运行source doctor和validate/roundtrip，**未生成银行代码、未改carrier/PB/PID/codec或运行服务**。新参考和独立oracle不替代固定金融测试，完整modular应用与银行消费另列。

第四批新增[family2纯决策／有限聚合合同](../../metarch-truthsrc/docs/artifacts/scala-cqrs/AGGREGATE-CORE.md)：纯decide、事件fold、CommandHelpers与独立glue Actor协议／工厂／本地Repository，显式no-external候选，尚不是完整四模块或银行迁移。当前主样例和Counter变体已有独立真实编译／行为结果，公共收尾回归和现役能力台账仍在完成，合同页不作为最终验收回执。2026-11-08本次银行source doctor通过，validate为0 hard、157原子roundtrip通过；只检查作者面，无JVM／容器／银行apply，不回签旧ledger、anchors或服务证据。

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

1. **公共机制回流（任务172，部分已实施，整体未完成）。** 已有显式手写来源及下述文件/进程/工作线程机制；其余独占租约、构建/报告核验和工作坊编排继续按公共机制与银行政策拆分，不将Docker/JDK变为基础真源CLI的必选依赖。不能把硬编码银行路径/固定24恢复场景的文件直接搬入公共仓。
2. **银行专属输入保留。** 业务规则、技术选择、外部TA/页面/权限实现、模拟器、金融场景和独立oracle留银行；旧固定revision/发行读取按历史职责隔离。通用接口由公共工具定义，银行只提供配置、adapter与薄入口。
3. **补齐可解释构建顺序。** 区分人/agent补充业务与技术决策、公共编译展开、图/AST和代码生成、开放端口实现、独立业务验收。新业务仓应能消费安装后的公共工具与显式输入，不复制整套银行`tools/`；不能声称仅凭`truth/`即可重建所有实现和测试。
4. **建立版本化产物责任表。** 按BC的Scala及JS最终写者、当前strict Saga、Monarch新API共同归类；每项明确输入、producer、输出层/命名、手写/生成/runtime-library所有权、适用profile、回锚与验收。保持P23兼容和R2待接入状态分开；不因旧目录未列出就删新职责，也不把runtime的Coordinator复制生成为应用实现。
5. **目录和命名服从上述归属。** 默认开发视图只暴露业务作者输入、项目配置、手写实现、独立测试、文档与按需生成输出；历史与执行证据不成为新人必经步骤。Scala类型使用UpperCamelCase、成员使用lowerCamelCase，包/SQL/PB/稳定ID分别有各自规则；在公共生成器中统一解析与碰撞校验，不能手改生成Scala或重命名冻结载体消红。

此前兼容分层与指定测试成果保留，但不能代替上述产品结构和从零构建的可解释性。最初挂账只登记和评估；实际后续成果按下面各实施记录判断，完整service重放阻断、材料分发、真人可用性及R2独立升级状态不变。

### 2026-11-07：artifactType最高优先级实施

用户批准先集中补齐artifactType说明，并追加`docs/artifacts/scala-cqrs/`层级。中央入口为[公共Scala CQRS目录](../../metarch-truthsrc/docs/artifacts/scala-cqrs/README.md)，[构建顺序](../../metarch-truthsrc/docs/artifacts/scala-cqrs/BUILD-ORDER.md)区分作者信息、公共加工及开放实现；BC/Play旧说明按中央目录派生，来源/覆盖和漂移单列。[P0验收记录](../../metarch-truthsrc/docs/artifacts/ACCEPTANCE.md)已记录125类别、8仓来源对账及冻结源码回归；这不是银行服务签收。当前仅实施说明及文档消费者，不改银行生成代码、金融规则、PB/PID、R2依赖或运行证据。P1公共工具归属、P2命名、P3银行目录及P4服务/人工验收仍按批准顺序独立进行。

### 2026-11-07：工程范式与参考实现首批

用户进一步明确：BC mjs产物结构未经打磨检验，不能当金样；对齐目的不止格式，而是让DDD、FP/OO、TDD、Akka/ES/CQRS和洋葱架构对人、agent、测试、治理、演进与追溯都容易落实。已授权继续主线并行推进，具体[参考开发与兼容合同](../../metarch-truthsrc/docs/artifacts/scala-cqrs/REFERENCE-DEVELOPMENT.md)在公共仓。

公共聚合生成已经拆为不可变结构模型与逐职责模板，保留原公开载体/协议/PB/PID/金融规则。七份独立Warehouse参考是工程候选，不冒称用户已批准金样；两版独立Scala编译及各24项行为测试通过，未使用BC mjs输出当预期。银行实际输入的纯计划229项中21个聚合文件有结构/排版变化，其余产物字节不变。[本轮新候选验收](architecture/AGGREGATE-REFERENCE-ACCEPTANCE.md)记录Actor64/Readside47、15/14保护检查及两候选229项相同源码；不是继承旧回执，也不关闭完整服务replay失败。

P1首个公共回流为显式手写来源验证：`tools/verify-handwritten-map.mjs`直接调用公共`lib/handwritten-provenance.mjs`，不再经旧发行helper的历史import闭包。银行继续控制当前snapshot、35文件/54引用和关系政策，原映射JSON/手写字节未改；20个公共测试、6个适配测试和3个原来源测试通过。公共模块接受任意领域的明确关联，仅验证文件/指针，不声明语义、symbol/span或运行认证。其他58个mjs中的机制仍须按职责收敛，不能据本次一项回流关闭整个P1。

本轮教学输出已经公共update同步233项，21源码加1输入证据发生写入；229源码/配置与两已验候选相同，repeat written=0。status current/synchronized，ReserveFunds到新Behaviors的精确span正反查通过。公共全量3121通过/15明确跳过/0失败；七参考与反例36通过、artifact28通过；安装后的公共来源API无需银行checkout。完整service重放、R2消费、其余目录/命名/公共工具和真人验收均未借此关闭。

### 2026-11-07：公共验证机制与可解释构建配方

本批起点为工具`3ed716b928b6`、银行`207093ec87df`，接续P1，不重复P0或聚合参考改造。新增[构建配方](BUILD-RECIPE.md)解释全部13个受跟踪一级目录、人工业务/技术信息、手写实现、独立测试、公共编译/生成和逐层验收；[工具归属清单](architecture/TOOLING-OWNERSHIP.json)逐文件覆盖原62份工程源码及两个新薄adapter，共64份。清单只验证明确库存及捕获到的字面引用，不声称证明任意动态调用、语义或运行通过。

公共`lib/verification/`新增文件取证、受限进程/静态进程证据、纯工作线程证据、工具归属校验。银行现役build/admission/lease、actor/runtime、session及report实际消费；lease不再为路径/文件原语加载全套构建准入，session不再因worker检查提前加载旧crash/release-build。银行保留schema、路径/供给/TA/固定场景与金融oracle。现役crash/report和browser仍借用历史政策模块，未伪装成全部历史依赖已断开。

独立审阅和反例补强了参数descriptor-first捕获、metadata/JSON边界、monotonic计时、逾期callback拒绝、清理超时后pipe写入撤销、日志流摘要与最终字节对账。银行profile明确拒绝子进程直接写监督器日志/回执；未结束的callback、nested invocation或session helper会阻断lease释放。纯内存process doubles验证reap耗尽/倒拨时钟，真实自有Node进程验证Seatbelt证据写拒绝；没有启动银行JVM、数据库容器或新的真实服务窗口。进程监督仅覆盖直接子进程及原进程组，callback须让出事件循环；不是敌意任意后代隔离或可抢占无限同步代码的保证。

已执行结果：

| 检查 | 本批结果 |
|---|---|
| 公共完整回归 | 3218项：3203通过、15明确跳过、0失败；1097源码/测试/package/catalog文件执行前后SHA一致 |
| 公共机制 | 完整回归含82项新files/process/worker/ownership测试；最终process单suite31通过 |
| 银行公共适配与工具库存 | 35通过，含7项库存/配方/链接、4项fresh-import集成；无跳过 |
| 银行显式build/actor/readside/runtime/workshop Node合同 | 485项：484通过、1项旧端口18762 opt-in网络测试跳过；不是Scala actor64/readside47重跑 |
| 原银行process兼容suite | 原测试源码未改，29通过 |
| 当前作者入口 | source doctor通过，validate/roundtrip通过；默认source/historical-reader9项中8通过、1完整生成集成opt-in跳过 |
| 离线安装 | tarball安装后移动prefix，非银行file/worker/process/ownership API及Counter生成/查询通过；不需要银行checkout或JDK/Docker |
| artifact说明 | 定向28通过，8仓3170来源文件复核通过；125类别/284变体/39manifest未增减，BC/Play兼容副本检查通过 |
| 保护面与生成比较 | 369份公共生成/schema/scaffold/core/reference及311份银行作者/绑定/Scala/历史/许可/草稿全部字节不变；当前229源码/配置与公共纯计划相同 |

上述检查有重叠，不相加当作独立覆盖。Windows只有路径模型测试，本批未运行原生Windows或最低Node22.13；实际执行为Node22.23.4/Darwin。安装源码/机制测试不等材料已公开发布，更不关闭真人上手。

本机证据在工具`.rounds/public-verification-p1-ty8yx0sb/`：`baseline.json`、`SCOPE.md`、`js-full-01.log`、`js-test-source-before.json`、`bank-contracts-01.log`、`process-04.log`、`bank-public-01.log`、`installed-02.log`、`catalog-cross-02.json`、`compat-bc-01.json`、`compat-play-01.json`、`protection-01.json`及`teaching-code-comparison.json`。失败反例、首次不完整fixture和中断日志保留，未作为新clone必备材料发布。代理额度失败不计审阅通过；中断实施由主集成补齐并实际回归。通信层曾报ENOSPC，但实际df约52GiB可用，未据此清理磁盘。

**教学输出当前为工具指纹changed，不是synchronized。** 229源码/配置没有变化；本批没有apply、回签旧ledger/anchors或修改历史构建/服务回执。此前聚合批的current状态只适用于当时工具版本。后续受控更新与新构建必须使用新的对应证据。

P1尚有完整lease/build-report/工作坊编排及资源adapter归属、剩余历史银行政策分拆；P2全量命名/多模块/新profile参考、P3物理目录收敛、P4 service02 replay/材料分发/真人上手、retry/backoff/deadline OPEN与R2下游任务保持未完成。上述实施验收捕获时尚未commit、push、tag或publish；后续本地提交状态以各仓Git历史为准，提交不代表推送或发布。

### 2026-11-07：公共租约、文件清单与独立验证闭环

本批从已提交的工具`31a1480db11f`、银行`cf75af01b716`继续P1，未重复提交。公共`lib/verification/`新增协作lease、inventory/reference、outcome和串行runner；共享callback边界用于租约预检、action/verifier及进程barrier。银行现役lease、build清单/完成状态、runtime admission及报告实际消费；工作坊source阶段也通过公共runner运行。银行仍控制schema、plain路径、锁/marker字节格式、严格JSON、端口/TA根、冻结suite、金融oracle和完整服务判据。

[随包Catalog示例](../../metarch-truthsrc/scaffold/verification-project/README.md)将输入、builder、独立预期/checker和运行配置分开。离线tarball安装并移动prefix后，独立副本完成构建、验证、释放租约和静态报告；loader拒绝回退原checkout，修改产物或新增输入均被拒绝。新业务不必复制银行的锁/取证/串行运行生命周期；但仍必须提供真实业务实现、独立oracle与完整依赖声明，不能只凭truth自动补全工程。

本批反例修复了未await进程返回另一条未处理Promise、预检Promise形状失败被误当工作结束、同步结果在microtask后才捕获、generator/thenable冒充barrier、释放租约后再调用verifier、取消信号上下文不一致、无进程的准入失败误保留锁、保留锁时句柄泄漏及最终事件循环让出后产物变更。锁文件不自动接管；未验证退出/无法确认的I/O保留证据，放弃能力只关闭句柄、不删锁。回执解析前实行实际字节上限；静态检查核租约声明和私有目录。新process事件时间由启动墙钟加单调偏移构造，保持原schema/字段和排序合同；不是修改系统时钟或重签历史回执。

| 检查 | 本批结果 |
|---|---|
| 公共完整回归 | **3336项：3321通过、15明确opt-in跳过、0失败**；1102源码/测试/package/catalog文件执行前后SHA相同 |
| 银行显式Node合同 | **514项：513通过、1项18762网络opt-in跳过、0失败**；不是银行Scala/JVM/数据库重跑 |
| 银行公共适配与库存 | **46通过**；工具仍64份，未增加银行生命周期脚本 |
| 当前source合同 | **8通过、1完整生成集成opt-in跳过**；source doctor、validate/157原子roundtrip通过 |
| 独立安装 | 移址tarball的Catalog完整闭环及漂移反例通过；已有Counter、文件/进程/worker/归属检查同样通过 |
| 真实银行source | 新`target/workshop-public-lifecycle-3zfgpoyd-source02`的verify和read-only report通过；13份run文件字节/mtime未改，`fullPipelinePassed:false` |
| artifact说明 | 定向28通过；8仓**3181**来源文件对账、BC50/Play32兼容副本检查通过；125类别/284变体/39manifest不变 |
| 保护与生成 | 显式保护354份公共生成/schema/core/reference/原scaffold及302份银行作者/绑定/Scala/历史/许可/模拟器等未变；229生成源码/配置与纯update计划逐字节相同 |

结果有重叠，不相加成独立测试总数。公共15跳过为BC真实消费/迁移及actual-bank opt-in；银行1项网络测试未获本批固定端口运行授权。实际平台为Node22.23.4/Darwin，未再次执行最低Node或原生Windows。没有银行JVM、数据库、共享服务或新的真实service窗口。

本机证据在工具`.rounds/public-verification-lifecycle-3zfgpoyd/`：`baseline.json`、`SCOPE.md`、`REVIEW-DISPOSITIONS.md`、`js-full-01.log`、`bank-contracts-02.log`、`full-regression-result.json`、`installed-02.log`、`bank-public-02.log`、`source-workshop-02.log`、`catalog-cross-01.json`、`catalog-compat-01.json`、`protection-01.json`及`teaching-code-comparison.json`。限流/通信失败代理不计审阅通过；有返回的具体问题经反例与实际回归确认。原失败日志保留，未据通信层的ENOSPC提示删除磁盘材料。

**教学输出仍是工具指纹changed，不是synchronized。** 纯update计划233项中232项相同，仅1输入证据拟更新；没有实际apply、写图或改旧ledger/anchors。source子运行的通过不更新旧code/service验收。

P1剩余为旧build进程监督合同、工作坊其余阶段、Docker/relay资源适配及历史crash/browser政策分拆；本批公共闭环完成不代表所有银行工具已经公共化。P2全量Scala命名/多模块参考、P3物理目录、P4新读库replay/材料分发/真人上手、retry/backoff/deadline **OPEN**与独立R2下游仍未关闭。本批未commit、push、tag或publish，原`.gitignore`、`.DS_Store`和Python缓存不纳入修改。

### 2026-11-07：ArtifactType盘点与剩余落地计划

用户要求保存最新盘点并给出实施路线；正式记录集中在[公共现状报告与实施计划](../../metarch-truthsrc/docs/artifacts/STATUS-AND-IMPLEMENTATION-PLAN.md)，银行不再维护另一份类别台账。当前125类/125登记/125份说明齐套，66类只是JS支持登记数，不是已逐类核验的生成覆盖；6项JS变体缺直接本仓producer引用，Saga serializer的generated/library归属存在矛盾。最终质量验收为0类，7份聚合参考是文件级工程候选，不算7类最终完成。

推荐起手批改为全量校准125类/284变体/39入口的能力与所有权矩阵，再固定目标profile、命名和参考质量合同，按依赖家族处理模板；其余公共工具/目录收敛沿真实消费需要推进，不再用零散guard批次代替生成器主线。完整service、R2、重试债、材料和真人验收仍各自有独立门。本次只落报告/计划及导航，不修改登记数字消红、不实施生成器、不重签旧证据，也不提交或发布。

### 2026-11-07：全量生成能力台账校准

第一实施批已落实为公共v2[能力合同](../../metarch-truthsrc/docs/artifacts/CAPABILITY-CONTRACT.md)、[派生矩阵](../../metarch-truthsrc/docs/artifacts/CAPABILITY-MATRIX.md)和[验收记录](../../metarch-truthsrc/docs/artifacts/CAPABILITY-ACCEPTANCE.md)。原125类/284变体全部核对，补入189条漏登/拆分profile后为473变体；类别仍125，39manifest分别记录主入口、子生产者、wrapper、静态拷贝及退役通道。原66登记不再当生成完成数。现役JS代码/装配61类定位到producer，60类有本批真实纯生成样例；3类派生证据中2类有样例。新台账的目标编译、独立行为和最终审定均未借旧结果晋升。

六项缺引用/归属问题已按实际生产链纠正：JS HostSerializer与运行库StrictSagaSerializer分开，StrictParticipant/phase/bootstrap是应用装配，旧projection Repository、role/view-map和应用serialization注册有明确来源。125类别说明、BC50/Play32兼容副本已同步，运行库内核不被复制算为模板；已发现的BC结构/默认值/多模块代码债保留，未修生成器。

本批公共完整3376项中3361通过、15明确opt-in跳过、0失败；artifact定向66通过，离线移址包及8仓3206来源对账通过，973份回归输入前后SHA一致。银行只运行source doctor与validate/157原子roundtrip（0hard，既有notice保留），没有JVM/数据库/完整service重跑，银行业务/固定测试/绑定/生成目录未改。教学输出仍tool changed，旧code/service回执不重签；P23/R2、90秒replay失败、retry OPEN、材料及真人门均保持独立。本批无commit/push/tag/publish。

### 2026-11-07：第二批目标profile、集中命名与独立参考

公共[目标合同](../../metarch-truthsrc/docs/artifacts/scala-cqrs/TARGET-PROFILES.md)把银行既有legacy-compatible与新项目modular-candidate分开：旧名字显式保留，新合同单独解析Scala类型/成员/package，知识ID、SQL/PB/wire/PID/operation/codec不随风格改变。新公共`lib/scala-target/`只提供纯命名/冲突和结构模型校验，没有接入现役renderer或新增generator manifest，因此不是银行命名已迁移。

原Warehouse七源码保护；新增非银行Parcel四模块参考，10生产Scala/3独立suite覆盖计算、只读Repository、应用flow、完整签名VO闭包、同层Bridge、外置实现与root绑定。新候选实际逐模块编译、34行为、7对编译拒绝及无实现红灯控制通过；target Node38、artifact68、原聚合结构/源码36通过。机械通过不代替架构owner批准，BC mjs仍不是金样。完整回归、安装及最终保护由[本批验收](../../metarch-truthsrc/docs/artifacts/TARGET-PROFILE-ACCEPTANCE.md)统一记录，不在银行维护第二份类别统计。

catalog新增14个reference-only变体，类别125不变、变体487、入口39；现役61代码职责/60生成样例不因新参考而增加。工具版本变化后实际重放12个生成样例，输入和源码字节与原样例相同；旧回执原路径/原字节保留，历史声明不计当前能力。新参考不晋升现役生成器compiled/behavior/final状态。

完整公共回归3418项中3403通过、15明确opt-in跳过、0失败，993输入SHA保持；离线移址安装、8仓3225来源和五仓写面保护通过。定向检查与完整回归有重叠，不相加为独立覆盖。

银行本批仍仅更新本页并重验source doctor/validate/157原子roundtrip，0hard和37既有notice；没有银行JVM/数据库/服务运行、apply、图/ledger/anchors或旧code/service回执写入。冻结载体/PB/PID/runtime、金融政策与当前生成结果不变；完整service replay失败、90秒期限、R2下游、retry/backoff/deadline OPEN及材料/真人门继续开放，未commit/push/tag/publish。
