# Bank Wealth Demo：从业务知识到可运行系统

> 给第一次打开本仓库的同学，尤其是关心“Palantir 本体论的思路怎样落到系统研发”的同学。
>
> **本项目用银行账户、基金申购、退款和定投，演示一条可以追溯的研发链路：业务真源 → 编译 → 代码生成 → 手写边界集成 → 运行验证 → 代码回锚。** 它不是 Palantir 产品、插件或兼容实现，也不是可用于真实资金的生产银行系统。
>
> 阅读核对日期：2026-11-06。当前开发入口已收敛为根 `truthsrc.project.json` 和 [`truth/bank-wealth/`](truth/bank-wealth/)，先宏压缩、再受控微语法降噪；旧两树已退役。代码通过本地 SQLite 知识图导出的 AST 生成，再回锚同图。原1134发行和下文旧运行位置仍是历史证据，不与当前源码混用。
>
> **当前操作从 [真源教程](docs/TRUTH-TUTORIAL.md) 开始。** 本地无 npm 依赖的工具可安装为 `truthsrc` CLI；银行完整生成还需要已冻结runtime供给。用户选定的兼容分层／生成读侧已通过四流64项与读侧47项测试，见[验收记录](docs/TRUTH-COMPATIBLE-COMPOSITION.md)。BC家族与必要兼容差异见工具仓 `TEMPLATE-PARITY.md`，不冒称原样字节对齐或集群sharding。

## 先用一分钟回答最常见的问题

| 你想找什么 | 从这里开始 |
|---|---|
| 项目当前要展示的银行业务 | [`truth/bank-wealth/`](truth/bank-wealth/) 与根 `truthsrc.project.json` |
| `v1/` 是什么 | 保留的手写实现、测试、历史绑定、集成材料和发行证据；旧 `v1/tree` 已退役 |
| 真源编译后的 JSON | [`v1/formal-inputs/release-bridge-1069/bank-v1.json`](v1/formal-inputs/release-bridge-1069/bank-v1.json) 是发行输入快照；新编译输出应放到新目录 |
| 给生成器的完整输入 | 同目录的 [`files.json`](v1/formal-inputs/release-bridge-1069/files.json)、[`request.json`](v1/formal-inputs/release-bridge-1069/request.json) 和 [`compiled.json`](v1/formal-inputs/release-bridge-1069/compiled.json) |
| 生成后的 Scala 应用 | 在每次生成的目标目录中，不在 `v1/handwritten/`；本机已验位置见第 4 节 |
| 必须手写的代码 | [`v1/handwritten/scala/example/bankwealth/`](v1/handwritten/scala/example/bankwealth/) |
| 代码回锚 | 项目 `.truthsrc/knowledge.sqlite` 与生成目标的派生 `anchors.json`、`truthsrc.ledger.json`；手写来源另见 [`HANDWRITTEN-SOURCE-MAP.json`](v1/integration/HANDWRITTEN-SOURCE-MAP.json) |
| 前端 | 有。当前页面实现是 [`BankBrowserPages.scala`](v1/handwritten/scala/example/bankwealth/web/BankBrowserPages.scala)，应用内路径 `/bank/v1` |
| 怎样演示 | 第 5 节是无数据库的小演示；第 9 节是完整银行发行复演 |
| 什么已经验收 | [`RELEASE-SIGNOUT-1134.md`](v1/integration/RELEASE-SIGNOUT-1134.md) |
| 旧两套作者树去了哪里 | 已经逐文件核对后移除；固定 Git revision 和 [`TRUTH-LEGACY-BASELINE.json`](docs/TRUTH-LEGACY-BASELINE.json) 保留历史来源 |

**新手推荐顺序：**先读第 1–4 节，再做第 5 节的小演示。想看“知识怎样变成代码”，读第 6–8 节；准备运行银行，再读第 9 节。不需要先读所有编号报告。

---

## 1. 背景：为什么不直接写一个银行程序？

普通项目通常把业务知识分散在需求文档、数据库表、接口文档、代码、测试和人的记忆中。改一条规则时，很难回答：

- 这条规则的正式定义在哪里？
- 哪些命令、事件、流程和页面受影响？
- 哪些文件应该再生成，哪些实现需要人或 agent 修改？
- 代码中的这一段，究竟在实现哪项业务知识？

本项目不是为了再做一套银行 CRUD，而是用一个有实际复杂度的例子回答这些问题。

它来自两条逐步汇合的探索：

1. **架构端：**从早期 `playAkkaCQRS` 应用提取架构规律，形成 BC（本地目录名为 `backkend-codegen`）的架构元模型、builder 和模板，再生成应用。
2. **知识端：**把领域知识、用例、命令、事件和流程从散乱 JSON 整理成可由人和 agent 编辑的文件真源树，并由 `metarch-truthsrc` 编译、校验、生成和建立来源关系。

文件优先的目的，是让基础使用不必先部署知识服务或独立图数据库。**知识仍然可以形成图，但“图”不等于必须先运行一个图数据库。** 本地 JSON、关系查询 API 和可选 SQLite 缓存已经能承载一部分检索。

三个交付目标是：

- 描述 Saga／Monarch 领域语义，并让编译器、生成器、生成代码和回锚接得上。
- 提供本地真源驱动的研发闭环，而不是要求作者手工同步多份中间业务数据。
- 用银行 demo 展示这条链路如何工作、如何验证、如何迭代。

银行 V1 已完成既定本地 demo 发行验收；这不等于工具的所有体验、所有运行库能力或生产金融要求都已完成。

## 2. 与 Palantir 本体论有什么关系？

可以先把“本体”理解为：**系统对业务世界中的对象、属性、关系和可执行动作所采用的明确模型。** 它不只是术语表，也不只是数据库表结构。

Palantir 官方介绍用对象类型、属性、链接、动作和函数连接数据与业务操作。对研发而言，值得借鉴的问题是：“业务概念能否同时约束数据、行为、权限与应用，而不是只停留在一张概念图？”

本项目研究的是其中的**系统研发侧**：怎样把明确的业务知识交给编译器和代码生成器，再用来源证据连接实现。以下只是理解上的对照，不是格式或能力的一一兼容：

| 关注点 | 本项目中可以观察的对应物 |
|---|---|
| 业务对象及属性 | `CreditBalance`、`FundOrder`、`SipPlan` 的身份、状态与值对象 |
| 对象关系 | 订单关联账户、付款、TA 请求；定投计划关联期次与订单 |
| 对业务对象采取动作 | Command、守卫条件、Event 及其状态变化 |
| 多对象协作 | Saga 的事务阶段、Monarch 的执行管线与显式技术端口 |
| 面向人的操作界面 | 服务合同、身份／权限边界、客户和操作员页面 |
| 模型与实现的联系 | source pointer、生成账本、实际文件指纹和手写来源映射 |

有三个很重要的区别：

1. **业务对象类型不等于聚合。** 聚合是本项目采用的状态一致性边界；页面和读模型也不应机械地与聚合一一对应。
2. **真源不是生产交易数据库。** 真源描述“账户怎样工作”；某个客户此刻的余额、已经发生的订单和事件，属于运行时数据。
3. **文件锚不是语义正确性的证明。** 它能证明某条知识关联到哪些实际文件，以及文件是否改变；不能仅凭 SHA 就证明“扣款永远正确”。

还可以分成两层来看：

- **业务模型：**账户、申购、退款、定投是什么，允许发生什么。
- **架构元模型：**Command、Event、Aggregate、SagaHost、Converter、Service 等软件构件如何组织，怎样从业务模型生成。

这里没有实现完整 Foundry/AIP、RDF/OWL 推理、通用数据连接器或企业级本体治理。不要把“有知识图和生成器”直接称作“复刻了 Palantir”。参考：[Palantir Ontology 官方概览](https://www.palantir.com/docs/foundry/ontology/overview/)。

## 3. 银行例子到底做什么？

### 三个主要聚合

- **`CreditBalance`：账户余额。** 单个账户中记录币种余额和资金预留，不是把所有账户装在一个对象里。
- **`FundOrder`：基金订单。** 记录请求、付款、TA 结果及退款相关业务状态。
- **`SipPlan`：定投计划。** 记录计划修订、有限到期时隙、暂停／恢复和执行期次。

TA 是基金登记／份额确认这一侧的简称。本例允许模拟基金公司／TA；没有接真实银行或真实基金公司。

### 四条业务流程

```text
一次现金申购
  客户提交请求
    → 投资人账户出金、募集账户入金、订单付款确认
    → 向模拟 TA 提交已付款订单
    → TA 确认：投资成功
    → TA 拒绝：启动独立退款，退回原本金
    → 结果未知：保留原身份并核实，不能直接当作成功或失败

定投
  建立计划与到期时隙
    → 操作员推进业务时钟
    → 持久化本期期次，再启动同一套现金申购流程
    → 按可信业务终态记录本期结果
```

**付款成功不是投资成功；TA 受理不是份额确认；退款申请不是本金已经退回。** 这些区别既影响状态机，也影响页面展示。

金额采用精确表示。HTTP 中 `{"minorUnits":"10000","currency":"CNY"}` 表示人民币 100.00 元，不能用二进制浮点随意计算或舍入。TA 的 NAV／份额保留精确字符串，不能把演示样例当成生产定价公式。

### Saga 和 Monarch 分别负责什么？

- **Saga** 负责跨聚合事务协调：Prepare、Commit、Compensate，以及结果核实。付款与退款是不同事务；付款已提交后的退款，不是把原付款随意改回补偿。
- **Monarch** 负责流程执行：阶段队列、执行游标和恢复后的继续处理。
- **`monarch-persistence`** 把 Monarch 的执行状态与持久化 actor 接起来。

本例消费三个锁定运行制品 `0.2.1-p23.20261027.1`。它们是应用依赖，不是复制在银行目录里的源码。修改 sibling 运行库不会自动改变已发行应用。

**仍有明确欠账：**真源中的重试次数、退避和独立阶段／查询期限尚未完整落实到 strict 执行路径。`lowering` 是生成前的模型转换，不是故障发生后的状态；已有授权核实恢复也不等于全部故障都有自动重试策略。详见[重试 OPEN 记录](docs/TRUTHSRC-CONTINUATION.md#3-重试挂账open未修复未接受限制)。

## 4. 目录应该怎样串起来理解？

### 4.1 先分清四类东西

```text
作者输入                       派生产物                         运行与证据
truth/bank-wealth/ ──公共编译器/图AST──> canonical / 语义产品 ──生成器──> 生成应用
    + 明确技术绑定、生成配置                                  + 手写边界
                                                             ↓
                                                        构建、运行、测试
                                                             ↓
知识 <──────── anchors / ledger / 来源映射 ─────────────── 实际代码文件
```

“真源”是作者维护的权威描述；“派生产物”可以从指定输入重新得到；“运行证据”记录某次真实执行发生了什么。三者不能互相冒充。

### 4.2 当前作者输入与保留的 `v1/`

```text
truth/bank-wealth/
├── system.yaml
├── contexts/bankwealth/
│   ├── context.yaml
│   ├── structures/         共享协议/结果/TCC结构，展开为标准虚拟原子
│   ├── aggregates/         聚合与未合并的业务切片
│   ├── value-objects/
│   ├── sagas/、pipelines/
│   └── formal-products/、stories/、read-models/、use-cases.yaml
└── inbox/                  有实际来源的背景、角色与决策
truthsrc.project.json       唯一项目配置
bindings/implementation/    八份具名技术选择
v1/
├── formal-inputs/          历史冻结请求，不是当前作者面
├── handwritten/scala/     银行适配、读侧、页面、安全及运行装配
├── test/scala/            冻结业务/恢复验收源码
├── integration/           历史合同、协作与发行证据
└── third-party/           许可/来源材料
```

`formal-inputs/` 中的 `payment-authored-*` 等目录含显式技术 binding，例如端口怎样连接实际实现。`payment-376`、`release-pages-721`、`release-bridge-1069` 等是历史批次标签，**不是需要依次运行的脚本编号**。不要通过批量编辑这些 JSON 来修改业务。

本次阅读 V1 发行输入，从 [`release-bridge-1069/`](v1/formal-inputs/release-bridge-1069/) 开始即可：

| 文件 | 用一句话理解 |
|---|---|
| `bank-v1.json` | 真源树编译后的统一业务文档，称为 canonical |
| `references.json`、`types.json`、`decisions.json`、`folds.json` 等 | 交给特定编译步骤的引用、精确类型、决策和状态变化输入 |
| `files.json` | 输入文件清单，声明文档角色、组装关系和产品要求 |
| `request.json` | 捕获这些输入后形成的完整内存请求的保存版本 |
| `compiled.json` | 编译后的 14 项语义产品；不是 Scala 源码 |
| `options.json` | 包名、runtime 制品位置、手写源码挂载等技术选项 |
| `scope.json` | 该批次输入的范围记录，不是业务运行成功证明 |

**编译完成不等于可运行。** 语义产品是供生成器消费的已检查模型，类似编译器的中间表示（IR）。仍需生成、集成、构建和业务验证。

### 4.3 生成后的代码在哪里？

本仓库没有在根部放一个固定的 `app/` 作为全部手写应用。生成器把完整工程写入每次明确指定的目标。

本机 1134 安装复演留下的两个生成目标是：

```text
dist/v1/bank/target/bank-wealth-release-v1/release1134installed/final/js-app/
dist/v1/bank/target/bank-wealth-release-v1/release1134installed/final/bc-app/
```

- `js-app` 来自 `metarch-truthsrc` 的 JavaScript 生成器。
- `bc-app` 来自 BC 的 Scala 生成器。
- 两者是对相同银行合同的两条生成链，不是前后端两个工程，也不是两个业务微服务。
- **这些是本机运行位置示例，不是新 clone 保证存在的目录。** `dist/`、`target/` 当前未纳入 Git；全新 clone 有真源、输入与手写源码，但没有上述应用和发行包。

生成目标内部可以这样读：

```text
<生成目标>/
├── app/example/bankwealth/domain/            协议、状态、守卫、actor、事件处理
├── app/example/bankwealth/domain/values/     值对象
├── app/example/bankwealth/infrastructure/    序列化适配等生成代码
├── app/example/bankwealth/service/           服务端口、Loader、配置及路由装配
├── src/                                     protobuf、测试等生成源码
├── conf/                                    应用配置
├── project/、build.sbt                       sbt 构建工程
├── anchors.json                             知识 → 实际代码文件
└── truthsrc.ledger.json                      文件类别、依赖与知识来源账本
```

ScalaPB 等构建工具还会根据 `.proto` 产生 managed sources；它们属于**构建期生成物**，不要与 truthsrc 直接写出的源码库存混为一类。

### 4.4 根目录其余内容是什么？

| 目录／文件 | 正确读法 |
|---|---|
| 六份根 binding JSON | 早期设计配套历史保护面；两旧作者树已退役，不是当前输入的快捷替代品 |
| `compiled/`、`isolation-zone/` | 旧 IR／Scala 说明样例，不是当前 V1 生成结果 |
| `projections/` | 业务知识的上下文图、故事图、旅程图等；**不是**运行时 CQRS 数据库投影 |
| `simulator/`、`tools/mock-ta.mjs` | 独立 MockTA 模拟器，不是银行前端，也不独自完成付款／退款 |
| `tools/` | 输入派生、校验、测试和发行编排；不是每个脚本都适合直接运行 |
| `test/` | Node／Python 等工具测试；银行 Scala 测试在 `v1/test/scala/` |
| `docs/` | 设计导航和历史交接；以具体日期和范围理解，不按“CURRENT”字样盲认最新 |
| `.scratch/`、`target/` | 本地中间产物、测试和运行数据；不作为业务真源，不随意清理或提交 |
| `dist/` | 本机发行包及安装复演；新 clone 不自带 |
| `package.json` | 工具测试入口，不是银行 Web 应用的启动器；没有 `npm start` |

旧根 README 曾以“尚未运行”的早期设计状态为主；本页替换了那个阅读入口，没有重写旧真源或旧验收文件。原设计导航仍可从 [I0 基线](docs/I0-BASELINE.md)、[现金路径](docs/CASH-FIRST-SLICE.md)、[P23 业务交接](docs/P23-BUSINESS-HANDOFF.md) 阅读。`v1/README.md` 也保留较早联合验证时点；最新冻结发行结论以 [1134 签出](v1/integration/RELEASE-SIGNOUT-1134.md) 为准。

## 5. 不启动银行，也能做的第一个演示

### 5.1 当前银行入口

在本仓库根目录，使用 Node ≥22.5。只编译真源不需要数据库、Docker或BC服务：

```bash
node tools/truthsrc-project.mjs validate
node tools/truthsrc-project.mjs compile
```

当前有157个YAML，展开后保留3个聚合、2个Saga、4条pipeline和14个语义产品。
结构共享与微语法只改变作者表示，不改变金融规则。`compile`的JSON输出是派生结果，不是新的编辑面。

完整银行生成还需要本地冻结runtime供给。只有已有干净1134归档时才执行准备：

```bash
node tools/prepare-truthsrc-runtime.mjs --archive dist/bank-wealth-v1-darwin-x64-1134.tar.gz
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current" --plan
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current"
```

已有输出需要先 `status`，检查变更后显式 `--update --plan` / `--update`，不覆盖陌生文件。
项目知识图在 `.truthsrc/knowledge.sqlite`；生成器实际消费图导出的AST，再将代码锚写回同图。
当前service生成199份源码/配置及4份派生证据，账本和锚交换文件另计。

### 5.2 从空目录体验工具

安装方式见 [工具README](../metarch-truthsrc/README.md#install-the-local-cli)。安装后：

```bash
truthsrc init ./my-workshop
truthsrc validate --tree ./my-workshop/truth/example
truthsrc roundtrip --tree ./my-workshop/truth/example
truthsrc generate-project --project ./my-workshop/truthsrc.project.json --out ./my-workshop/generated
truthsrc query-project --project ./my-workshop/truthsrc.project.json --out ./my-workshop/generated --knowledge SetCount
```

`my-workshop` 必须不存在。这是独立Counter教学模型，不是第二套银行真源。
本轮已从本地tarball在独立前缀离线安装CLI并实测建树和生成；没有发布到npm。
详细变更/再生、微语法、精确回锚和手写边界见 [当前教程](docs/TRUTH-TUTORIAL.md)。

## 6. 跟一条真实知识：初始化账户怎样变成代码？

打开 [`initialize-account.slice.yaml`](truth/bank-wealth/contexts/bankwealth/aggregates/credit-balance/slices/initialize-account.slice.yaml)。`slice` 可以理解为“围绕一个命令组织的一小块业务定义”。其内容包括：

- 命令 `InitializeAccount`，参数为账户身份、币种和金额。
- 守卫：账户身份匹配、币种为 CNY、金额非负、重复初始化不能篡改原值等。
- 产生事件 `AccountInitialized`。
- 事件字段从命令参数绑定。
- 事件应用时把 `initialized` 设为真，将币种余额写入状态。

不要被文件后缀误导：这里的格式是带 `kind` 等头字段、内嵌 JSON payload 的受约束 YAML 原子，不是随意拼字段的配置文件。写法依据公共 [`SCHEMA.md`](../metarch-truthsrc/SCHEMA.md)；agent 规则见 [`AGENTS.md`](../metarch-truthsrc/AGENTS.md)。

编译后，该命令在本发行请求中的定位键为：

```text
source:bank-v1#/aggregates/0/commands/0
```

含义是：输入文档 `bank-v1` 中 JSON Pointer `/aggregates/0/commands/0` 指向的知识。**数字下标是该次输入的定位，不是可以脱离版本永远硬编码的业务身份。**

生成器根据这项定义及其依赖产生多个文件，例如：

```text
app/example/bankwealth/domain/CreditBalanceProtocol.scala
app/example/bankwealth/domain/CreditBalanceCommandHelpers.scala
app/example/bankwealth/domain/CreditBalanceRules.scala
app/example/bankwealth/domain/CreditBalanceAggregate.scala
```

事件定义又关联 `CreditBalanceEventHandler.scala` 等产物。运行时的基本关系是：

```text
Command → 守卫与决策 → Event → 持久化 → event application 更新 State
```

**余额、订单、定投期次状态只在生成 actor 的事件应用中演进。** 手写适配器不是另一个偷偷修改余额的资金状态机。

本机已验生成目标的 `anchors.json` 中，上述命令确实对应 4 个文件；本轮重新读取实际文件后均为 `source-verified / current-bytes`。这说明“不是旁边放一份 YAML 作说明”，但业务正确性仍要靠独立预期和行为测试。

## 7. artifact type 从哪里来？golden example 又在哪里？

### 7.1 先区分四种“类型”

1. **知识原子类型：**`note`、`aggregate`、`slice`、`saga`、`formal-product` 等。定义入口是 [`lib/shared.mjs`](../metarch-truthsrc/lib/shared.mjs) 与 [`SCHEMA.md`](../metarch-truthsrc/SCHEMA.md)。
2. **作者侧正式合同 family：**如 `technical-port`、`saga-host`、`effect-host`、`artifact-contract`。定义在 [`lib/formal-products-pure.mjs`](../metarch-truthsrc/lib/formal-products-pure.mjs)，银行实例在 `truth/bank-wealth/contexts/bankwealth/formal-products/` 或对应的 `structures/` 宏声明中。
3. **编译产品类型：**供代码生成器消费的检查后模型。注册、版本和依赖在 [`lib/products/registry.mjs`](../metarch-truthsrc/lib/products/registry.mjs)，分派在 [`lib/products/compile.mjs`](../metarch-truthsrc/lib/products/compile.mjs)，JSON 结构在 [`schema/`](../metarch-truthsrc/schema/)。
4. **生成文件的 artifact kind：**`state`、`protocol`、`converter`、`service-runtime` 等。具体由生成器 [`generator.json`](../metarch-truthsrc/generators/scala-cqrs-play-service/generator.json) 的 `producers` 和 `artifactKinds` 声明，写入账本的 `entry.kind` 必须属于声明范围。

**14 项编译产品不等于 14 个文件，也不等于 14 种业务对象。** 本发行产品集包括：

| 产品 | 作用 |
|---|---|
| `reference-layout` | 解析带上下文、类型和所有者的引用 |
| `exact-value-types`、`exact-value-codecs` | 精确数值类型及边界编码 |
| `domain-decision`、`domain-dependencies`、`domain-folds` | 命令决策、字段依赖、事件怎样改变状态 |
| `domain-external-events` | 外部事件生产／投递合同 |
| `saga-contract`、`saga-runtime-contract`、`saga-host-contract` | 事务语义、runtime 转换和宿主合同 |
| `execution-contract`、`effect-host-contract` | 管线执行与持久外部 effect 宿主 |
| `artifact-contract`、`product-design` | 软件构件／部署服务合同，以及产品体验描述 |

某个生成器会直接消费其中一部分，其他产品为上游依赖或其他消费面服务。当前服务生成器声明32种输出kind，但不是每种输入都会生成所有种类；完整列表以`generator.json`为准。

### 7.2 银行使用的主要生成来源

JS 服务生成入口是 [`scala-cqrs-play-service/generate.mjs`](../metarch-truthsrc/generators/scala-cqrs-play-service/generate.mjs)。它复用 application/effect/domain producers，不是运行所有旧生成器目录。下表给出继续读源码的入口：

| artifact kind／构件 | 主要来源 |
|---|---|
| `state`、`protocol`、`command-helpers`、`rules`、`event-handler` | [`render-domain.mjs`](../metarch-truthsrc/generators/scala-cqrs-domain/render-domain.mjs) |
| 兼容actor、application Protocol/Behaviors/Factory、本地Repository与Bootstrap | service专用 [`render-aggregate-layers.mjs`](../metarch-truthsrc/generators/scala-cqrs-play-service/render-aggregate-layers.mjs)；旧domain/application profile仍使用原renderer |
| `value-object` | [`render-values.mjs`](../metarch-truthsrc/generators/scala-cqrs-domain/render-values.mjs) |
| `proto`、`converter`、`serialization-adapter` | [`render-serialization.mjs`](../metarch-truthsrc/generators/scala-cqrs-domain/render-serialization.mjs)、[`render-adapters.mjs`](../metarch-truthsrc/generators/scala-cqrs-domain/render-adapters.mjs) |
| Saga definition、invocation host、technical port、host 协议与序列化 | application 的 [`produce.mjs`](../metarch-truthsrc/generators/scala-cqrs-application/produce.mjs) 连接各 `render-host*`、`render-invocation-*` 和 `render-technical-ports` |
| `execution-plan` | [`render-execution.mjs`](../metarch-truthsrc/generators/scala-cqrs-application/render-execution.mjs) 及 application 中组合执行 renderers |
| effect host、effect 协议与序列化 | [`produce-effect.mjs`](../metarch-truthsrc/generators/scala-cqrs-application/produce-effect.mjs) 及 effect renderers |
| `service-port`、`service-runtime`、`service-config` | [`render-service.mjs`](../metarch-truthsrc/generators/scala-cqrs-play-service/render-service.mjs) |
| `build`、`generated-test`、`service-test` | scaffold／build renderer 与各自 verification renderer；完整登记仍看 `generator.json` |
| JDBC表/事务Repository、PB回放、checkpoint和订阅生命周期 | **生成** [`render-journal-readside.mjs`](../metarch-truthsrc/generators/scala-cqrs-play-service/render-journal-readside.mjs)及其repository/domain renderers；显式`projectionStore`驱动 |
| 银行读侧owner、索引业务选择与查询DTO | **手写端口** [`BankReadside.scala`](v1/handwritten/scala/example/bankwealth/readside/BankReadside.scala)调用生成实现；[`BankReadsideSchema.scala`](v1/handwritten/scala/example/bankwealth/readside/BankReadsideSchema.scala)仅保留兼容名称 |
| 银行 endpoint 实现、页面、业务装配 | **手写** [`BankServiceEndpoints.scala`](v1/handwritten/scala/example/bankwealth/integration/BankServiceEndpoints.scala)、[`BankBrowserPages.scala`](v1/handwritten/scala/example/bankwealth/web/BankBrowserPages.scala)、[`BankServiceFactory.scala`](v1/handwritten/scala/example/bankwealth/integration/BankServiceFactory.scala) |

HTTP 方法、路径、类型、端口、页面挂载等合同在 [`bank-service.formal.yaml`](truth/bank-wealth/contexts/bankwealth/formal-products/artifact-contract/bank-service.formal.yaml)。生成端产出类型化接口、Loader 和 `Router.from` 路由，不是必须生成传统 `conf/routes` 文本。具体页面 renderer 和银行 endpoint 实现仍为手写边界，不能宣传成“所有前端／读模型自动生成”。

### 7.3 BC 中的定义在哪里？

BC 的架构元模型实际文件名是 [`ArchitectMetadata.scala`](../backkend-codegen/src/main/scala/net/imadz/meta/ArchitectMetadata.scala)。其中的 `metaCategory`，例如 `domain.events`、`application.aggregates`，与 JS 的 `artifactKinds` 不是同一个枚举。

当前正式产品链的入口是 [`SemanticProductsGenerationPlan.scala`](../backkend-codegen/src/main/scala/net/imadz/codegen/SemanticProductsGenerationPlan.scala)，再进入：

- [`builder/products/`](../backkend-codegen/src/main/scala/net/imadz/codegen/scaffolding/cqrs/builder/products/)：构造结构模型。
- [`model/products/`](../backkend-codegen/src/main/scala/net/imadz/codegen/scaffolding/cqrs/model/products/)：传给模板的数据结构。
- [`template/products/`](../backkend-codegen/src/main/scala/net/imadz/codegen/scaffolding/cqrs/template/products/)：输出 Scala 等语法。

这是另一条实现链；不要因为 BC 有某个历史模板，就断言它已被当前银行使用。

### 7.4 golden example：没有一个目录替所有层证明正确

Golden example 通常指“预先认定的输入与期望输出”，用来检查生成是否发生意外变化。它和业务验收预期、运行日志是不同的东西。

| 你在验证什么 | 到哪里找例子 |
|---|---|
| JS 历史逐字节源码金样 | [`golden/`](../metarch-truthsrc/golden/)，例如 [`CreditBalanceProtocol.scala`](../metarch-truthsrc/golden/scala-cqrs-es/expected/modules/kernel/src/main/scala/net/imadz/banking/application/aggregates/CreditBalanceProtocol.scala) |
| 上述金样怎样被使用 | [`scala-cqrs-es.test.mjs`](../metarch-truthsrc/test/scala-cqrs-es.test.mjs)；**这是已标 deprecated 的旧生成链，不能作为当前服务全覆盖金样** |
| JS 当前正式服务生成例子 | [`inventory-mixed-effect-products/`](../metarch-truthsrc/test/fixtures/inventory-mixed-effect-products/)、[`service-application-fixture.mjs`](../metarch-truthsrc/test/service-application-fixture.mjs)、[`service-application-generation.test.mjs`](../metarch-truthsrc/test/service-application-generation.test.mjs)、[`service-pages-generation.test.mjs`](../metarch-truthsrc/test/service-pages-generation.test.mjs) |
| BC 传统架构金样 | [`reference_project/app/`](../backkend-codegen/reference_project/app/)，例如 [`TransferValidatorDomainService.scala`](../backkend-codegen/reference_project/app/net/imadz/domain/services/TransferValidatorDomainService.scala) |
| BC 金样基准如何定位 | [`VerificationSpecBase.scala`](../backkend-codegen/src/test/scala/net/imadz/codegen/scaffolding/cqrs/verification/VerificationSpecBase.scala) 的实际根是 `reference_project/app`；具体测试可能比签名而非整个文件字节 |
| 银行业务是否正确 | [`v1/test/scala/`](v1/test/scala/)，如 [`BankSinglePaymentOracleSpec.scala`](v1/test/scala/BankSinglePaymentOracleSpec.scala)、[`BankPaymentJointSpec.scala`](v1/test/scala/BankPaymentJointSpec.scala)、[`BankSipApplicationSpec.scala`](v1/test/scala/BankSipApplicationSpec.scala) |
| 冻结发行是否真实运行 | [1134 签出](v1/integration/RELEASE-SIGNOUT-1134.md)及其指向的独立执行证据 |

当前服务测试含非银行库存例子，这是为了防止公共生成能力仅对银行特例成立。修改生成器后，需要查其实际测试与 fixture，而不是随便更新一份 golden 让测试变绿。

## 8. 回锚与双向检索：怎么知道知识和代码还连着？

### 8.1 三份不同的关系记录

- **`anchors.json`：**一个知识键对应 `locations[]`。每个位置记录 repo、相对文件路径、生成器、文件指纹、验证粒度等。
- **`truthsrc.ledger.json`：**每个生成文件的 `kind`、依赖、产品版本及 `knowledgeIds`，便于从文件反查来源和判断生成范围。
- **[`HANDWRITTEN-SOURCE-MAP.json`](v1/integration/HANDWRITTEN-SOURCE-MAP.json)：**手写实现对知识的 `implements / supports / legacy-adapter` 显式声明，不是假装工具自动理解了手写代码。

本例现在同时有文件级和精确区间锚。命令、guard、事件分支和fold由渲染器同源记录，最终字节核验后存入项目知识图；无解析证据的`symbol`仍不认证。`anchors.json`是派生交换文件，不是另一真源，也不把hash塞回业务树。

### 8.2 查询知识之间的关系

以下在银行根目录执行，只读内存编译与查询：

```bash
node --input-type=module <<'JS'
import { compileTree } from '../metarch-truthsrc/lib/compile.mjs';
import { buildGraph, search, expand } from '../metarch-truthsrc/lib/query.mjs';
const graph = buildGraph(JSON.parse(compileTree('v1/tree')));
console.log(search(graph, 'InitializeAccount'));
console.log(expand(graph, 'command:InitializeAccount', {
  depth: 1, direction: 'out'
}));
JS
```

本例能找到命令／切片，以及命令产生 `AccountInitialized` 的关系。当前 `search` 是名称／ID 子串查找，`expand` 等是明确关系查询，不是任意自然语言语义搜索，也不会补造没有声明的边。

### 8.3 从知识找代码，也从代码找知识

下面使用本机已验生成目标。新 clone 需将 `app` 改为自己生成的目标，且知识键应从该次请求确认。它是一个只读 API 示例，不是虚构的 `truthsrc reverse` 命令：

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { queryAnchorsIndex } from '../metarch-truthsrc/lib/anchor-query.mjs';

const app = resolve('dist/v1/bank/target/bank-wealth-release-v1/release1134installed/final/js-app');
const indexFile = join(app, 'anchors.json');
const index = JSON.parse(readFileSync(indexFile, 'utf8'));
const key = 'source:bank-v1#/aggregates/0/commands/0';

// 本例明确把这一组锚的 repo 绑定到已知生成目标；不是自动信任任意外部路径。
const repoRoots = Object.fromEntries((index.anchors[key] ?? []).map(x => [x.repo, app]));
console.log('知识到代码：', queryAnchorsIndex(key, { indexFile, repoRoots }));

const file = 'app/example/bankwealth/domain/CreditBalanceCommandHelpers.scala';
const keys = Object.entries(index.anchors)
  .filter(([, locations]) => locations.some(x => x.file === file))
  .map(([sourceKey]) => sourceKey);
console.log('代码到知识：', keys);
JS
```

反向结果得到的是 request 内的 source pointer；找到 `bank-v1` 文档并解析 pointer 后，再按聚合／命令身份定位到原切片。**它不是自动从 Scala 推断业务意图，也不直接给出原 YAML 行号。** 一个 helper 文件实现多个命令，因此反向结果有多个知识键是正常的。

公开核验器会重新读实际文件：指纹改变报告 `stale`，文件消失报告 `unmapped`；不存在索引或缺少可信 repo 根不能冒充验证成功。单纯反向扫描只提供关联，不能替代文件新鲜度核验。银行更完整的输入指针、生成库存及手写映射核验在 [`v1-release-provenance.mjs`](tools/v1-release-provenance.mjs)。

### 8.4 “同步”至少有三个层次

1. **树与 canonical 同步：**重新编译、做 roundtrip，不手工改缓存。
2. **生成代码与输入／工具版本同步：**固定版本和选项，正式再生，检查差异、库存、ledger 和实际文件锚。
3. **手写实现与业务合同同步：**检查接口变化、显式来源关系、独立业务预期与行为测试。

重新计算 SHA 只能处理其中一部分。知识变了但代码没重新生成，旧文件仍可与旧 SHA 相等；所以还要核对输入版本和来源。反过来，不能把手写代码改了就自动认定业务知识已经更新。

## 9. 有没有前端？怎样演示完整银行？

### 9.1 有前端，但不是独立 React／Vue 工程

当前前端由 Play 应用提供 HTML 和原生 JavaScript，界面文案主要是英文；它是用于验证业务操作的朴素界面，不是手机银行成品 UI。

实际 renderer 为 [`BankBrowserPages.scala`](v1/handwritten/scala/example/bankwealth/web/BankBrowserPages.scala)，挂载合同在 [`bank-service.formal.yaml`](truth/bank-wealth/contexts/bankwealth/formal-products/artifact-contract/bank-service.formal.yaml)。正确装配并启动后，入口为：

```text
http://127.0.0.1:<本次分配的HTTP端口>/bank/v1
```

不要假定固定端口 9000。页面请求通过 `/bank/v1/...` 的正式别名路由；JSON API 对应 `/api/v1/...`。

页面大致可以这样理解（示意，不是截图）：

```text
登录：输入本次签发的 Bearer token 和 CSRF token
      选择 Customer / Operator 工作区，再由服务端验证权限

Customer                    Operator
├─ 我的账户                 ├─ 待处理操作
├─ 发起现金申购             ├─ 按原操作身份进行 Reconcile
├─ 查原请求／订单           └─ 推进演示业务时钟
└─ 创建、修订、暂停、恢复定投；查询期次
```

角色下拉框不会授予角色。不要使用旧运行目录中的凭证；由本次受信配置发放新 token。凭证只留在标签页内存，刷新需重新输入。

### 9.2 页面背后怎样连接？

```text
浏览器
  → 生成的服务路由／类型化端口
  → 手写身份、请求校验与 BankServiceEndpoints
  → 生成的领域 actor／Saga 与 Monarch 宿主
  → 事件 journal
  → 生成的JDBC Projection／Repository（复用生成的事件fold／codec）
  → 手写BankReadside业务选择与查询DTO端口
  → JDBC 读模型
  → 查询接口与页面
```

真实存储／浏览器验收使用 MongoDB journal 和 MySQL 读模型。单元测试使用隔离 testkit／独占本地存储；不能把单元配置与真实数据库配置混用。

### 9.3 推荐的讲解脚本

1. 从账户页说明“页面读到的是投影，写侧事件才决定业务状态”。
2. 发起一笔现金申购，保留 `clientRequestId`，查回原请求和订单。
3. 展示付款成功后仍需等待 TA 业务结果，不能提前显示投资成功。
4. 展示 TA 拒绝情景：独立退款完成后，才确认本金已退回。
5. 建立有限到期时隙的定投，操作员推进时钟，观察期次和订单关系。
6. 使用已有恢复验收说明重复请求、丢失应答和重启如何保持身份；不要在不清楚运行资源时随意 kill 进程。
7. 最后回到对应真源、生成文件与 anchors，展示“业务动作—实现—来源”是一条可追踪链。

这些是演示的业务观察点，不是每次点按钮就会自动触发的所有故障场景。TA 场景由测试／受信演示配置控制，不能靠篡改业务结果伪造成功。

### 9.4 完整可搬移复演

**先说明体验边界：当前正式复演会启动无头浏览器自动操作页面，然后关闭应用、浏览器和自建数据库容器。它不会留下一个常驻网页供你随后点击。** 仓库尚无本页已核实的“新手一键常驻启动”流程；`BankProductionHttpMain` 是有时限的集成测试入口，不能冒充常驻部署程序。

可转交的是本机 `dist/bank-wealth-v1-darwin-x64-1134.tar.gz` 及相邻 `.sha256` 文件，**不是整个已经运行过的 `dist/v1/`**。干净归档含冻结生成器、输入、独立手写源码、Node 和构建供给，不含已生成应用、数据库、凭证、journal 或构建缓存；复演时重新生成和构建。

外部前置：

- 已验证平台为 **macOS x86_64**；没有声称 Linux／Apple Silicon 原生通过。
- JDK 11、Python 3.10+、macOS 系统工具。
- Docker，以及已经存在的指定 MySQL 8.4.11／Mongo 4.4 镜像。
- Playwright 和 Chromium 的明确本地路径。

它不自动下载这些依赖。Mongo 4.4 已 EOL，本配置只限本地演示，不能公开部署或用于真实资金。

操作顺序如下；这是长耗时执行，会创建本次应用、缓存、journal、私有配置与数据库数据，不属于第 5 节的轻量命令：

1. 核对干净归档校验值；1134 的 SHA-256 为 `95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade`。
2. 解压到**全新目录**，得到 `bank-wealth-v1/`。
3. 在解压目录外、一个名为 `.scratch` 的目录下建立**新的控制目录**和 `CONFIG.json`。按发行的 [复演配置说明](dist/REPLAY-1134.md) 填写实际绝对路径、镜像 ID 和全新 `workId`。该链接是本机交付附属文件；新 clone 没有它时需取得发行材料，跟踪源码中的配置规范见 [`RELEASE-EXECUTION-V2.md`](v1/integration/RELEASE-EXECUTION-V2.md)。
4. 用归档内的 Node 和工具运行：

```bash
BUNDLE=/absolute/fresh/bank-wealth-v1
CONFIG=/absolute/.scratch/new-control/CONFIG.json

"$BUNDLE/node/bin/node" "$BUNDLE/bank/tools/v1-release.mjs" \
  --check --execution "$CONFIG"

# 审阅 check 结果后再单独运行，不用 && 连接。
"$BUNDLE/node/bin/node" "$BUNDLE/bank/tools/v1-release.mjs" \
  --run --execution "$CONFIG"
```

`--check` 不生成、不启服务；返回 **2** 表示预检不是实际发行签收。`--run` 成功退出 **0**，控制目录 `execution/REPORT.json` 为 `verified-execution`。复演包含双链生成、完整冷构建、HTTP、每链 24 类指定恢复窗、独占数据库和真实浏览器。

不要原地重跑成功或失败的 exclusive 配置。失败时保留材料，调查后用新的解压目录、控制目录和运行身份。工具只停止自己的容器并保留数据。复演后目录内包含私有凭证和运行证据，不能递归打包或提交；继续转交原干净归档。

## 10. 项目以后怎样升级？agent 怎样参与？

### 10.1 修改知识，而不是同时改五份 JSON

一次正常变更应该这样进行：

1. 找到当前真源原子和来源，说明要改的业务规则及预期；不要修改旧冻结输入伪造历史。
2. 修改作者输入，运行 `validate` 和 `roundtrip`；保持已有身份／seq，不为“整洁”重排。
3. 用匹配版本的入口重新派生请求和产品，先看生成 plan，再写独占目标。
4. 检查生成差异；如果涉及持久化类型，同时检查 `.proto`、converter 和注册，不只看 Scala case class。
5. 在手写边界完成必要适配，保留明确来源映射。
6. 跑对应的独立行为测试，再核对输入、代码、ledger 和 anchors。

本页第 5.3 节展示新通用项目入口；冻结银行发行仍走自己的固定输入和发行流程。把银行的持续迭代完整接入新入口，需要工具链与银行消费方按稳定合同协作，不能仅因为新增了一个 CLI 就宣称全部迁移完成。

### 10.2 agent 的读写边界

建议给 agent 一次明确的小任务，例如：“解释并修改某个定投守卫，列出受影响文件和测试”，而不是“扫描所有历史目录然后帮我全部修好”。

- 读公共 `AGENTS.md` 和项目规则，先查现有知识，不凭 grep 没命中就补造业务事实。
- 使用 `parseDoc / emitDoc` 等公共 API 编辑原子；不要用正则批量改整个 YAML payload。
- 不手改 canonical、compiled、anchors、ledger 来消除差异。
- 知识查询可直接使用本地 API；工具还提供 [`mcp/server.mjs`](../metarch-truthsrc/mcp/server.mjs) 的 stdio MCP 入口。MCP 是只读查询工具面，不是绕过真源约束的写入通道，也不是基础使用的必需服务。
- 遇到未支持的语义、缺失的外部实现或不明确的权限，报告缺口，不生成“看起来能跑”的占位成功。

### 10.3 怎么扩展自己的生成器？

先区分两种扩展：

- **普通外部 generator：**从 [`generators/_template/`](../metarch-truthsrc/generators/_template/) 学起。`init-generator <新目录>` 创建 `generator.json` 和 `generate.mjs`；`generate` 接收 canonical，返回确定性的 `{path, content, kind, …}` 条目，由公共 writer 应用。若需要来源追踪，应显式填写有效 `knowledgeIds`；模板不是自动语义推断器。
- **正式语义产品 producer：**本文银行使用的 `generate-products`／`generate-project` 只接受已登记的 shipped producer。需要对应 schema、版本、产品依赖、能力准入、producer 和测试；不是往任意目录放文件就自动注册。

不要让 generator 自己绕过 [`applyEntries`](../metarch-truthsrc/src/core/generate.mjs) 写应用文件。公共 writer 统一处理路径、已有文件、MANUAL／KEEP、ledger 和实际字节锚；它没有承诺跨文件事务、自动回滚或跨进程互斥。

### 10.4 生成脚手架后，怎样让多个 agent 并行开发？

**并行单位是独占模块，不是多个 agent 同时覆盖同一生成目录。** 推荐：

| 角色 | 独占职责示例 |
|---|---|
| 集成 owner | 真源合同、公共接口、版本选择、统一生成、运行装配和最终验证 |
| agent A | `readside/` 与 `web/` 的实现和对应测试 |
| agent B | TA／退款适配与对应测试 |
| agent C | `sip/` 的应用实现和对应测试 |

先固定接口和归属，再分派。共享 `BankServiceFactory` 等装配文件交给集成 owner；发现接口不够就反馈并再生，不私改生成签名。银行手写源码通过 external source roots 挂入生成工程，不复制到生成目录。

MANUAL 块可以保留允许的手写片段，但它不是协作锁。两个 agent 同时写同一文件仍会冲突。重型构建／服务验收排队运行，不能为节省时间复用他人的数据库和 journal。

## 11. 已验证什么，阅读时又应警惕什么？

**冻结银行发行：**[1134 签出](v1/integration/RELEASE-SIGNOUT-1134.md)记录原 25 项有界 demo 合同完成，包含双链完整冷构建、真实 HTTP、指定跨 JVM 恢复窗、Mongo／MySQL／浏览器和安装位置复演。该事实不因旧文档仍写“未完成”而消失，也不自动覆盖之后改动的工作树。

**前期 README 编写时点：**当时执行了V1 validate、roundtrip、canonical编译、服务输入检查、14产品编译、193文件plan及文件锚核验。后续当前源码已经完成紧凑树、同图回锚和任务108兼容迁移；最新233项计划、534主源码编译、64四流测试及47读侧测试见[验收记录](docs/TRUTH-COMPATIBLE-COMPOSITION.md)。本轮没有重跑真实数据库／浏览器，也不声称页面当前在线。

请特别注意：

- 根 `npm test` 是当前作者／14产品保真与历史读取的显式检查，不是全应用验收；`test:history`才是旧预览路线。新的四流/读侧运行以[独立回执](docs/TRUTH-COMPATIBLE-COMPOSITION.md)为准。历史`projections/index.json`不为消红重写。
- [`test/domain-runner.test.mjs`](test/domain-runner.test.mjs)、`qualification/` 及相关 qualifier 是暂停材料，不作为本文命令运行。
- 真源中的 proposal、`workshopHeld:false`、输入中的 `runtimeVerified:false` 等可能记录创作阶段，不能改成 true 冒充后来运行；运行结果有独立证据。
- 不能从文件锚、一个测试通过或页面返回成功，推导生产金融认证、任意故障自动恢复、外部真实对接或整个链路 exactly-once。
- 不读取、展示或复用旧私有凭证；不删除 journal／失败产物；不使用 `stash/reset/checkout` 清理他人工作树。
- 不运行会写共享 `ingested-app`／`metarch-app` 的默认生成命令；不要组合 `--direct --dry-run`。

## 12. 延伸阅读

按你的问题选择入口，不必把历史报告从头读完：

- **想读业务：**[`truth/bank-wealth/`](truth/bank-wealth/)，再对照 [`v1/test/scala/`](v1/test/scala/) 的实际预期。旧树按[固定历史来源](docs/TRUTH-LEGACY-BASELINE.json)读取。
- **想读银行运行装配：**[`BankServiceFactory.scala`](v1/handwritten/scala/example/bankwealth/integration/BankServiceFactory.scala)、[`integration/CONTRACT.md`](v1/integration/CONTRACT.md)。
- **想读服务／页面合同：**[`bank-service.formal.yaml`](truth/bank-wealth/contexts/bankwealth/formal-products/artifact-contract/bank-service.formal.yaml)、[`PAGES-CONTRACT.md`](v1/integration/PAGES-CONTRACT.md)。
- **想读工具：**sibling [`metarch-truthsrc/SCHEMA.md`](../metarch-truthsrc/SCHEMA.md)、[`PROJECT.md`](../metarch-truthsrc/PROJECT.md)、[`bin/truthsrc.js`](../metarch-truthsrc/bin/truthsrc.js)。这些跨仓链接在完整工作区有效，单独 clone 银行不会自动带来工具仓。
- **想读当前正式生成：**[`generate-cli.mjs`](../metarch-truthsrc/lib/products/generate-cli.mjs)、[`product-plan.mjs`](../metarch-truthsrc/src/core/product-plan.mjs)、[`generate.mjs`](../metarch-truthsrc/src/core/generate.mjs)。
- **想看发行做到哪一步：**[`RELEASE-SIGNOUT-1134.md`](v1/integration/RELEASE-SIGNOUT-1134.md)。
- **想继续工具链研发：**[`TRUTHSRC-CONTINUATION.md`](docs/TRUTHSRC-CONTINUATION.md)。它是交接时点记录；其中第一批入口工作已经出现新的工具工作区实现，应结合 `PROJECT.md` 和当前源码核对，不把旧“尚未实现”当成永久状态。

记住这条最重要的阅读原则：**先找业务真源，再看编译合同，然后看生成与手写实现，最后用实际测试和回锚证据检查它们是否仍然对应。**
