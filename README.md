# Bank Wealth Workshop

## 一笔申购，看到每一步的来处

客户提交100元申购。钱扣了，投资就成功了吗？基金公司拒绝后，为什么还要另一笔退款？定投每一期怎样复用这些规则？

本例用 **业务真源 → 严格编译 → 本地知识图 → 生成代码 → 精确回锚 → 分层验收** 回答这些问题。它是本地教学 demo，不处理真实资金，不是生产银行系统或 Palantir 兼容实现。

## 四条业务线

| 业务线 | 做什么 | 不能混淆的结果 |
|---|---|---|
| 付款 | 现金申购入口持久化请求，Saga协调投资人账户、募集账户与订单 | 付款成功不等于投资成功 |
| TA确认 | 向模拟基金公司/TA提交已付款订单，查询相关最终结果 | accepted不是份额确认；unknown不能直接判成功或失败 |
| 独立退款 | TA拒绝后，以另一事务退回原本金 | 不是补偿已经Commit的付款；申请退款不等于已经到账 |
| 有限定投 | 显式推进业务时钟，持久化期次，再复用现金申购流程 | 不另造资金链，不增加“三次失败自动暂停”政策 |

三个主要聚合是 `CreditBalance`、`FundOrder`、`SipPlan`。金额、NAV和份额采用精确表示；TA允许模拟，不连接真实金融机构。Saga负责跨聚合事务，Monarch/pipeline负责流程编排，二者不可互换。

## 第一次成功：只验真源

需要 **Node ≥22.13.0**（已验22.13.0、22.23.4），以及**相邻、配套的完整 `metarch-truthsrc` 工具 checkout**。单独 clone 银行不会带来工具；不能假定两仓main包含配套功能。参阅[工具安装说明](../metarch-truthsrc/README.md#install-the-local-cli)。

在**自己的银行 checkout 根目录**执行：

```bash
node tools/bank-workshop.mjs doctor --through source --format human
node tools/truthsrc-project.mjs validate
node tools/truthsrc-project.mjs compile
```

成功时doctor报告source前置满足，validate无hard错误且roundtrip为true，compile严格产品编译成功。**这一步不需要JVM、Docker或1134归档，也不是Scala/银行服务验收。** 需要保存一轮独立source回执时，按[工作坊第2节](docs/BANK-WORKSHOP.md#2-第一次运行只验真源)准备父目录与全新run。

接下来按目标选择：

- **从零学工具：**[Counter教程](../metarch-truthsrc/TUTORIAL.md)，在独立小项目练习，不改银行金融规则。
- **看懂业务与代码：**[银行真源教程](docs/TRUTH-TUTORIAL.md)，生成、离线图、精确区间反查与安全更新。
- **逐层核验：**[银行工作坊](docs/BANK-WORKSHOP.md)，source / anchors / code / service分别报告。
- **查命令读写：**[入口表](docs/TRUTH-ENTRYPOINTS.md)；作者权威合同见 [TRUTH.md](TRUTH.md)。

## 唯一作者入口与职责目录

**只从根 `truthsrc.project.json` 进入 `truth/bank-wealth/`。** 业务在作者树维护，具名技术选择在 `bindings/implementation/`；不手改canonical、完整request、SQLite、ledger、anchors或生成代码。

| 位置 | 职责 |
|---|---|
| [`truth/bank-wealth/`](truth/bank-wealth/) | 系统/context声明、四流知识、结构共享、故事与来源 |
| [`truthsrc.project.json`](truthsrc.project.json)、[`bindings/implementation/`](bindings/implementation/) | 项目配置与显式技术选择 |
| [`handwritten/scala/`](handwritten/scala/) | 银行端口、owner/DTO、TA/退款/定投适配、页面与运行装配 |
| [`test/scala/`](test/scala/) | 固定业务/读侧/HTTP/恢复预期，只按显式manifest运行 |
| [`third-party/`](third-party/) | 必须保留的许可和来源材料 |
| [`docs/architecture/`](docs/architecture/) | 当前生成/手写职责、手写来源映射与历史合同入口 |
| `generated/<owned>/`、`.truthsrc/` | 自有生成工程与派生知识/来源证据，不是第二作者面 |
| [`tools/`](tools/)、[`test/`](test/) | 编排工具与显式Node/Python合同测试；没有`npm start` |
| `target/`、`.local/`、`dist/` | 本机候选、供给与执行数据；新clone不自带，不清理或整包转交 |

35份手写、31份固定测试和14份许可已逐字节核等迁移；497份旧`v1/`材料由完整固定Git对象保存后退出工作树。**目录、来源与Node合同门已过，新候选运行门另行验收**，见[本批结果](docs/V1-RETIREMENT.md)及[退役manifest](docs/V1-RETIREMENT-MANIFEST.json)。旧两树、原README、1134签收与交接均从[历史索引](docs/HISTORY.md)读取，不恢复第二份作者树，也不把`/api/v1`等业务/协议版本改成V2。

## 分层验收与真实限制

| 层 | 额外前提 | 不能替代什么 |
|---|---|---|
| source | 上述Node与两份配套源码 | 不证明生成应用可运行 |
| anchors | 六份冻结JAR/POM；现有prepare从干净1134归档校验提取，不运行JVM | 文件/区间关联不是金融语义证明 |
| code | 固定构建供给、原生Darwin x64、JDK11、Python与macOS受限执行工具 | actor/readside测试不等HTTP或真实数据库验收 |
| service | 新owner租约、独占端口/存储、Docker、固定Mongo/MySQL镜像及浏览器材料 | 指定窗口不等任意故障恢复或生产认证 |

**完整生成仍依赖冻结供给，材料的真实公开获取渠道尚未落实。** 不虚构Release/npm下载地址，不从已运行的`dist/v1`拼包。当前运行平台和Mongo 4.4 EOL等限制见[工作坊](docs/BANK-WORKSHOP.md)与[历史发行边界](docs/HISTORY.md#release-1134)。

已有证据按候选和时点阅读：

- [兼容迁移验收](docs/TRUTH-COMPATIBLE-COMPOSITION.md)：生成Repository和JDBC读侧**已被实际消费**；银行owner/查询DTO仍手写。actor64与readside47共享23项生成测试，不能相加冒独立覆盖。
- [11月6日新人验收原回执](docs/ONBOARDING-ACCEPTANCE.md)：代码、图与固定恢复有实测，不是完整服务签收。回执中的环境状态保留原时点。
- **最新运行（2026-11-06）：**service02已完成新代码/运行编译、24恢复窗及真实数据库initial/restart/refund，replay新读库未在90秒内追平，完整服务仍未通过；资源已归还，共享`metarch-mongo`未操作。它消费旧P23，**不是[Monarch R2下游验收](docs/MONARCH-R2-DOWNSTREAM.md)**。
- [目录精简验收](docs/V1-RETIREMENT.md)：迁移后的新候选与各层实际结果；不继承原1134或前序代码窗口的通过。

根`npm test`只是明确列出的source/14产品与历史读取合同。禁止全仓测试发现、暂停的qualification/domain-runner、复用旧凭据、清除journal或改回执消红。**retry/backoff/deadline仍为实质OPEN债务，不是已接受的profile豁免**，见[当前续接状态](docs/TRUTHSRC-CONTINUATION.md)。材料分发和真人可用性也尚未完成。

## 继续读架构与扩展工具

- **作者语法和项目：**[SCHEMA](../metarch-truthsrc/SCHEMA.md)、[AUTHORING](../metarch-truthsrc/AUTHORING.md)、[PROJECT](../metarch-truthsrc/PROJECT.md)。
- **普通外部generator：**[模板](../metarch-truthsrc/generators/_template/)；`init-generator`创建确定性条目生产器，统一交给[公共writer](../metarch-truthsrc/src/core/generate.mjs)，不要自行写应用文件。
- **正式语义产品扩展：**[产品注册表](../metarch-truthsrc/lib/products/registry.mjs)、[schema](../metarch-truthsrc/schema/)、[生成准入](../metarch-truthsrc/lib/products/generate-cli.mjs)、[产品计划](../metarch-truthsrc/src/core/product-plan.mjs)。银行`generate-project`使用已登记shipped producer，不是任意目录自动发现。
- **银行服务生成来源：**[generator.json](../metarch-truthsrc/generators/scala-cqrs-play-service/generator.json)、[generate.mjs](../metarch-truthsrc/generators/scala-cqrs-play-service/generate.mjs)、[模板对照](../metarch-truthsrc/TEMPLATE-PARITY.md)；14项语义产品不等于14个文件。
- **查询与协作：**[公共查询](../metarch-truthsrc/lib/query.mjs)、[文件锚核验](../metarch-truthsrc/lib/anchor-query.mjs)、[只读MCP入口](../metarch-truthsrc/mcp/server.mjs)和[银行AGENTS](AGENTS.md)。MCP不是基础使用前提；多人按独占手写模块协作，共享接口与生成apply由主集成负责。
- **BC与金样：**[ArchitectMetadata.scala](../backkend-codegen/src/main/scala/net/imadz/meta/ArchitectMetadata.scala)、[正式产品生成入口](../backkend-codegen/src/main/scala/net/imadz/codegen/SemanticProductsGenerationPlan.scala)、[BC金样](../backkend-codegen/reference_project/app/)、[JS服务测试](../metarch-truthsrc/test/service-application-generation.test.mjs)。没有一个golden目录能替全部业务与运行验收。

以上工具链接要求相邻仓库；它们不是材料已发布的承诺。完整旧说明和命令表有[固定Git入口](docs/HISTORY.md)，无需先通读历史再开始学习。
