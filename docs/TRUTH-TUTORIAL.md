# 银行财富：从真源到代码到回锚

## 当前项目与前置

当前入口只有根 `truthsrc.project.json`。作者树为
`truth/bank-wealth/`，上下文 `bankwealth`。旧 `tree/`、`v1/tree/`
和 `*-376` 请求均只用于历史比较/复演，不再双写。

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
本轮已在独立空缓存、仅本地供给和OS禁止网络的环境中通过499应用Scala源
及生成测试源码编译；生成-only窗口23项通过。后续固定actor窗口又实际通过
41项业务＋23项生成测试，覆盖四流原业务断言，详见[运行验收边界](TRUTH-RUNTIME-ACCEPTANCE.md)。
actor持久化使用内存testkit，TA使用显式有来源fixture及本轮新journal；
这些结果不是HTTP/真实数据库/跨JVM恢复或1134重签。复现与独占输出要求见
[离线构建与受限测试](TRUTH-BUILD.md)。

## 第一条垂直切片：预留现金

1. 阅读 `stories/story-cash-fund-purchase.story.yaml`，理解客户提交现金
   申购意图，而不是直接调用内部聚合资金命令。
2. 阅读 `use-cases.yaml` 的 `PurchaseFundWithCash`：可信入站先持久化原
   请求，现金pipeline安排阶段，三participant Saga管理付款事务。
3. 阅读 `aggregates/credit-balance/slices/reserve-funds.slice.yaml`：
   `ReserveFunds` 要求账户初始化/归属匹配、CNY正金额、同交易正文一致和
   可用金额充足，产生 `ReserveFundsConfirmed`。事件payload及fold才
   演进余额/预留，不在命令处理器直接改状态。
4. 公共编译器派生 decision/dependencies/folds；生成器消费版本化产品，
   核心apply写入规则、事件handler、源码ledger和真实文件anchors。

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
  --file app/example/bankwealth/domain/CreditBalanceRules.scala
```

加 `--symbol next0` 或 `--line 10` 只得到文件级候选，不能用局部变量或
当前数组位置伪造跨版本ID。原子位置、canonical pointer和快照摘要同时
返回。源已变但代码未变、代码被手改、来源缺失/历史等分别报告。

## 真实知识变更、再生成与手写边界

不要为了练习改变当前银行资金政策。在临时自有项目副本中把
`ReserveFunds` 正金额guard的 `errCode` 从 `LEDGER_POSITIVE` 改为
`LEDGER_POSITIVE_TEACHING`，保留其金额predicate、rule ref、身份和顺序。
测试按同一公开接口执行这一变化：

```bash
BANK_TRUTHSRC_INTEGRATION=1 node --test --test-concurrency=1 test/unified-truth.test.mjs
```

该测试已实跑5/5通过（含完整service生成的opt-in项，约290秒），创建并
清理自己的临时项目，不启动旧runner或服务：先生成、双向
查询，再改真源、观察输入过期、预览更新、受控再生、确认规则源码包含
新错误码，最后同输入重生零写入。正式当前树与原V1树都不修改。

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

## Agent、自定义生成器与历史复演

MCP配置使用公共 `truthsrc mcp`，调用 `project_sources`/`project_status`
并传根项目和自有输出路径；不要求服务器发号或先建图。
普通自定义生成器的实跑命令见 [工具教程](../../metarch-truthsrc/TUTORIAL.md)。
正式producer登记不等于普通插件：不得绕过产品准入或银行专写另一条链。

旧命令明确要求 `--historical`；旧完整请求API需要 `historical:true`，
不会默读 `payment-376`。旧release只解释1134冻结发行，不是本次新源验收。
不运行暂停qualification、旧domain-runner、不复用旧凭证、不覆盖回执。
**retry/backoff/deadline仍OPEN，未修复、未降为合理限制。**
