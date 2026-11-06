# 银行财富：从真源到代码到回锚

2026-11-06当前兼容分层与生成读侧验收见 [实施记录](TRUTH-COMPATIBLE-COMPOSITION.md)：
534份main源码编译，四流64测试和读侧47测试分别通过，教学输出233项计划同步。
前一阶段摘要 [TRUTH-COMPACT-GRAPH-ACCEPTANCE.json](TRUTH-COMPACT-GRAPH-ACCEPTANCE.json)
保留其当时模板边界未裁定的历史状态，不被回写成新验收。

## 当前项目与前置

当前入口只有根 `truthsrc.project.json`。作者树为
`truth/bank-wealth/`，上下文 `bankwealth`。157个YAML使用显式结构共享与受控微语法；
旧 `tree/`、`v1/tree/`已移除，历史读取使用固定Git revision，不再双写。
`*-376` 请求仅属历史复演。用户已选择兼容迁移：生成Entity/Behaviors/Factory/
Bootstrap、本地Actor仓储及JDBC投影/DDL真实被消费；原公开载体、PB和PID不变。
本地仓储不是集群sharding，读侧业务选择仍为显式手写端口，见
[模板对照](../../metarch-truthsrc/TEMPLATE-PARITY.md)。

本教程使用相邻 `metarch-truthsrc` 源码和 Node ≥22.5。完整服务生成额外
需要本地冻结runtime供给；从已有干净1134归档准备，无下载或重发：

```bash
node tools/prepare-truthsrc-runtime.mjs --archive dist/bank-wealth-v1-darwin-x64-1134.tar.gz
node tools/truthsrc-project.mjs validate
node tools/truthsrc-project.mjs compile
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current" --plan
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current"
```

配置通过公共 project 入口编译14产品，生成完整service profile。
当前示例输出使用 `generated/current/`；本会话旧构建尝试留在`generated/`
根与`target/`的历史候选中，不要清理它们以运行教程。
八份技术绑定在 `bindings/implementation/`，execution不再手工嵌入重复
Saga副本，由公共assembly组装。配置中的runtime仓库和外部源路径相对
项目解析。`prepare` 只提取六个已核SHA的JAR/POM，未编译/发布runtime。
Scala构建/服务运行另需JDK、sbt及依赖/存储，不能把生成当作运行认证。
同日兼容迁移后的新候选还通过534份main/14份Test源码编译及原64项四流/生成测试；
独立读侧窗口通过534份main/11份Test编译及47项测试，见[兼容迁移记录](TRUTH-COMPATIBLE-COMPOSITION.md)。
前一紧凑树候选通过505份应用Scala和14份测试源码编译，64测试/13Suite全部成功，
见 [构建记录](TRUTH-BUILD.md#2026-11-06-紧凑真源与图链候选)。下面关于499源码、runtime冷02、
database11的段落是2026-11-05历史结果，不代表本轮又启动了这些窗口。
本轮前已在独立空缓存、仅本地供给和OS禁止网络的环境中通过499应用Scala源
及生成测试源码编译；生成-only窗口23项通过。后续固定actor窗口又实际通过
41项业务＋23项生成测试，覆盖四流原业务断言，详见[运行验收边界](TRUTH-RUNTIME-ACCEPTANCE.md)。
actor持久化使用内存testkit，TA使用显式有来源fixture及本轮新journal；
这些结果不是HTTP/真实数据库/跨JVM恢复或1134重签。后续独立runtime冷02编译并封存
运行classpath后，runtime-crash02已通过24个指定跨JVM恢复窗（72次JVM）；不依赖Docker，
也不等同于Mongo故障注入或自动重试策略认证。HTTP/数据库/页面仍以独立新回执为准。
最终database11另完成真实Mongo/MySQL、生产Loader/Factory、三个浏览器流程与正常重启/读库重放，
GET前后journal不变，21鉴权拒绝和5MySQL负例通过。它不是重新发行1134或BC现役切换。
复现与独占输出要求见[离线构建与受限测试](TRUTH-BUILD.md)。

## 第一条垂直切片：预留现金

1. 阅读 `stories/story-cash-fund-purchase.story.yaml`，理解客户提交现金
   申购意图，而不是直接调用内部聚合资金命令。
2. 阅读 `use-cases.yaml` 的 `PurchaseFundWithCash`：可信入站先持久化原
   请求，现金pipeline安排阶段，三participant Saga管理付款事务。
3. 阅读 `structures/outgoing-funds.structure.yaml` 中 `ReserveFunds` 的声明：
   `ReserveFunds` 要求账户初始化/归属匹配、CNY正金额、同交易正文一致和
   可用金额充足，产生 `ReserveFundsConfirmed`。事件payload及fold才
   演进余额/预留，不在命令处理器直接改状态。
4. 公共编译器派生decision/dependencies/folds，完整快照进入项目SQLite；
   从图导出已验证AST，再由唯一apply写入代码、ledger及最终字节锚，锚回到同图。
   服务生成把规则核心放在`domain/invariant/`，事件fold放在`domain/entities/behaviors/`。
   旧入口保留兼容，`BankRuntime`真实使用生成Repository/Bootstrap；不改冻结wire。

以上相对文件位于 `truth/bank-wealth/contexts/bankwealth/`。

```bash
node tools/truthsrc-project.mjs query --out "$PWD/generated/current" --knowledge ReserveFunds
node tools/truthsrc-project.mjs query --out "$PWD/generated/current" \
  --knowledge knowledge:bank-wealth/bankwealth/guard/CreditBalance/ReserveFunds/LEDGER_POSITIVE
node tools/truthsrc-project.mjs status --out "$PWD/generated/current"
```

从返回的 `locations[].file` 复制实际路径反查：

```bash
node tools/truthsrc-project.mjs query --out "$PWD/generated/current" \
  --file app/example/bankwealth/domain/invariant/CreditBalanceRules.scala
```

加 `--line <真实代码行>` 时，命中生成器记录且最终字节仍一致的区间会返回
`precision: span`；相邻fold保持不同知识身份。`--symbol next0`仍只是候选，不能把局部
变量或数组位置当永久ID。`origins`可指向同一宏声明/微语法字符串，不伪造字符串下
的对象子路径。项目 `.truthsrc/knowledge.sqlite`保存展开知识和同图代码锚，外置
`anchors.json`只作派生交换。缺图、过期、代码修改与历史来源分别报告。

## 真实知识变更、再生成与手写边界

不要为了练习改变当前银行资金政策。在临时自有项目副本中把
`ReserveFunds` 正金额guard的 `errCode` 从 `LEDGER_POSITIVE` 改为
`LEDGER_POSITIVE_TEACHING`，保留其金额predicate、rule ref、身份和顺序。
测试按同一公开接口执行这一变化：

```bash
BANK_TRUTHSRC_INTEGRATION=1 node --test --test-concurrency=1 test/unified-truth.test.mjs
```

该测试在2026-11-06对紧凑树与图/AST链实跑 **6/6通过**，创建并清理自己的临时项目，
不启动旧runner或服务：先生成、双向查询，再改变一条错误码、观察过期、受控update，
最后重复生成零源码写入。测试不改正式当前树或手写实现；实际兼容迁移由用户另行批准，
仅调整3份手写接线，冻结业务测试及runtime保持不变。

实际开发使用 `generate ... --update --plan` 后 `generate ... --update`。
更新仅接收同owner/生成器/类别且匹配成功基线的现有文件；冲突拒绝，不
自动删停止生成的文件。独立手写实现保留在 `v1/handwritten/scala/`。
两个agent按不同模块工作，主集成者控制接口及唯一生成位，不同时apply。
工具教程的 `test/teaching-loop.test.mjs` 实跑独立手写输入/呈现模块的集成
和再生字节保护；这不冒称新银行运行时端到端测试。

## 展开其余三流和查询体验

| 流程 | 当前故事/用例 | 执行及反馈边界 |
|---|---|---|
| 付款 | CashFundPurchase / PurchaseFundWithCash | 原请求先持久、订单最后commit；付款成功不是投资成功。 |
| TA | FundTaSettlement / SettlePaidFundOrderWithTa | 获准模拟；accepted/unknown与相关份额确认分开。 |
| 独立退款 | IndependentFundRefund / RefundTaRejectedPurchase | 可信TA拒绝后按原全本金反向独立事务，不撤销付款commit事实。 |
| 定投 | FiniteSipPlan / RunFiniteSipPlan | 原有限vector、未来修订、显式tick、首terminal计数；三败不自动暂停。 |

六个 `read-models/` 原子覆盖本人账户、原请求、订单、定投计划、期次和
操作员pending；三类角色说明客户/操作员/内部机器的边界。故事通过显式
用例/command/port引用可以正向查到相关代码，但这是追溯关系，不是叙事
自身生成执行逻辑的证明。已验TA故事关联40文件、SIP故事35文件且诊断为空。
复合来源明确
标为描述性推导，不谎称这些说明自动生成SQL/授权。水位caught-up只在其
限定PID/frontier有意义；整页索引unknown不能改成全部完成。

历史嵌入的大JSON已换成带文件/pointer的冻结引用，不持续同步。当前
`entryOwnership` 用实际四个pipeline名称，旧错名保留在原历史字节中。
十三类知识覆盖及不适用/历史项见 [TRUTH-MIGRATION.md](TRUTH-MIGRATION.md)。
全五层设计仍未成为必填；四份product-design保持proposal/null审批。

## 生成读侧与显式手写端口

`formal-products/artifact-contract/bank-service.formal.yaml`的`projectionStore`是技术
执行声明，选择原PB状态回放、JDBC表/索引、查询键/排序和生命周期参数。生成文件位于
`infrastructure/projection/BankJournalReadside{Schema,Repository,Projection,Domain}.scala`，
DDL位于`conf/sql/BankJournalReadside.sql`。

`BankReadside`仍负责银行特定owner/admission、pending选择、DTO与跨PID读时连接，
但不再自己实现SQL、事务、checkpoint或订阅。这是显式端口分工，不是六份说明性
read-model自动生成全部业务SQL。正式Factory无需换类名，其原构造入口现在使用
新的生成读侧。`--run-readside-tests`在新候选中执行固定H2/testkit测试，详见
[兼容迁移记录](TRUTH-COMPATIBLE-COMPOSITION.md)；它不启动数据库容器或HTTP服务。

## Agent、自定义生成器与历史复演

MCP配置使用公共 `truthsrc mcp`，调用 `project_sources`/`project_status`
并传根项目和自有输出路径；不要求服务器发号，读取生成时建立的本地知识图。
普通自定义生成器的实跑命令见 [工具教程](../../metarch-truthsrc/TUTORIAL.md)。
正式producer登记不等于普通插件：不得绕过产品准入或银行专写另一条链。

旧命令明确要求 `--historical`；旧完整请求API需要 `historical:true`，
不会默读 `payment-376`。旧release只解释1134冻结发行，不是本次新源验收。
不运行暂停qualification、旧domain-runner、不复用旧凭证、不覆盖回执。
**retry/backoff/deadline仍OPEN，未修复、未降为合理限制。**
