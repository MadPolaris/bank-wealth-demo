# 银行财富：全目标路线图、公共交接与 MockTA

## 当前 P23：银行 V1 权威描述与交接

最后更新: 2026-10-27。当前追加式合同为 [P23BankV1HandoffContract](tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)（`decision.p23-bank-v1-handoff`、设计版本 `bank-v1-p23-design-1`）。它正式引用已选政策，提供付款、TA、独立退款、定投四类描述、实际 binding 版本、30 个未执行业务场景/oracle，以及既定23覆盖行和40验收包。旧原子/六份bindings未被重写；新定投设计不等于旧外部资金链路已迁移。

阅读 [P23-BUSINESS-HANDOFF.md](docs/P23-BUSINESS-HANDOFF.md) 的输入指针、当前回执和窗口状态。`npm run test:p23` 为新增合同门；`npm run test:v1-contract` 显式合并旧七文件和P23，默认 `npm test` 仍保留旧六文件。脚本存在不等于验收通过，以新回执为准。

**以下“当前路线图／八项open／尚未选政策”等章节保留其历史时点。** 对已明确覆盖的政策与V1范围，应先读新overlay的 `resolutions`、`coverageRows`、`flows`；不将旧open重新当成未决，也不将设计合同或窗口归还冒称P23制品门、银行运行已通过。

## 当前路线图增量

当前源／设计交付入口是 [全目标路线图](docs/FULL-TARGET-ROADMAP.md)：`decision.full-target-gap-roadmap`，[FullTargetGapRoadmapProposal](tree/inbox/refining/question-rf-full-target-gap-roadmap-proposal-0.yaml)，`/payload/info/artifact/body/coverageRows`、`/payload/info/artifact/body/phases`。23 项目标、八项 open 决策时点、五要素与技术／验收义务在真源维护；现金付款不是完整终点，required SIP 不被删除。

X03／X04 各四公共未来工作包见 [PUBLIC-EXTENSIONS.md](docs/PUBLIC-EXTENSIONS.md)。本轮仍无新政策选择、公共 EP／实施或运行目标选定；原 S01／S02／S09 设计与 X01／X02 八包保持原字节。当前证据是 [ROADMAP-DESIGN-VERIFICATION.json](docs/ROADMAP-DESIGN-VERIFICATION.json)，仅源／设计范围。

经用户明确选择，默认 `npm test` 仍保留旧六文件；新增 `npm run test:roadmap` 单组及 `npm run test:current` 七显式文件的当前总验收，不自动纳入暂停 runner。以下现金入口迭代与 [CASH-NEXT-DESIGN-VERIFICATION.json](docs/CASH-NEXT-DESIGN-VERIFICATION.json) 作为此前设计／历史证据追溯，不认证本轮或完整银行运行。

## 此前现金入口设计增量

本仓库描述账户、外部入金、基金申购与定投。当前交付是 **三项 demo 现金入口设计收口与 X01／X02 公共实施包规格**，建立在 I0 和第二批契约/MockTA/体验提议之上。完整业务/产品/技术设计尚未完成，它不是可运行银行应用，也未完成公共生成、实际资金运行、JVM恢复或回锚。

本轮计划批准只选定三个 bounded demo prerequisite；其余八项 open。外层新 note 保持 `demo-proposal`、`workshopHeld: false`，设计选择不等于 bootstrap、authority 或唯一启动者已执法；不连带批准真实账户生命周期、生产金融政策或公共仓写入。

## 当前入口

1. [现金入口三项决策](docs/CASH-ENTRY-DECISIONS.md) — `decision.cash-entry-prerequisites`，[CashPrerequisiteDecisionOverlay](tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml)，`/payload/info/artifact/body/resolvedDecisions`、`/payload/info/artifact/body/remainingOpenDecisions`。原 I0 register 保持历史原字节，当前只按明确覆盖的三项读取。
2. [公共实施拆包](docs/PUBLIC-EXTENSIONS.md) — `decision.public-x01-work-packages`、`decision.public-x02-work-packages`。各四子包在真源维护，公共 owner 独立授权、两领域行为/兼容证据和未就绪 blockers 不能省略；不在本仓造生成/宿主 shim。
3. [CASH-NEXT-DESIGN-VERIFICATION.json](docs/CASH-NEXT-DESIGN-VERIFICATION.json) — 本轮源/设计范围机器回执，不认证公共实现、bootstrap、鉴权或资金运行。旧 I0、第二批回执是历史快照。


基金公司/TA 可以模拟；真实外部银行能力尚未确定，也未获准实现银行 mock。模拟 TA 不替代本地资金、订单、份额和退款语义。

## I0 阅读入口

按 `wealth-i0-design-v1` 的 refining seq 0 → 1 → 2 阅读。真源树是唯一设计权威；以下文档只提供导航、边界摘要与证据索引，不维护第二套业务/政策/公共扩展规格。

1. [I0 基线导航](docs/I0-BASELINE.md)：`decision.i0-baseline-coverage`，源 [I0BaselineCoverageDesignProposal](tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)，JSON Pointer `/payload/info/artifact/body/coverageRows` 与 `/payload/info/artifact/body/scopeDecisions`。
2. [公共扩展导航](docs/PUBLIC-EXTENSIONS.md)：`decision.i0-boundary-ownership`，源 [I0BoundaryOwnershipDesignProposal](tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，JSON Pointer `/payload/info/artifact/body/ownershipRows`、`/payload/info/artifact/body/toolDisposition` 与 `/payload/info/artifact/body/publicExtensions`。
3. [第一现金纵切导航](docs/CASH-FIRST-SLICE.md)：`decision.cash-first-slice-design`，源 [CashFirstSliceDesignProposal](tree/inbox/refining/question-rf-cash-first-slice-design-proposal-2.yaml)，JSON Pointer `/payload/info/artifact/body/productPlanes`、`/payload/info/artifact/body/technicalNeeds` 与 `/payload/info/artifact/body/acceptanceObligations`。

历史 I0 实测证据见 [docs/I0-VERIFICATION.json](docs/I0-VERIFICATION.json)：记录当时选定测试、源/工具快照、保护与排除范围，原字节保留，不覆盖新增选择/拆包或当前文档。

X01／X02 已拆为银行仓的交接规格；公共实现仍须另行取得 owner 授权，X03–X10 保留原提议。本次不创建公共 EP、不改公共代码，不补银行专用生成/宿主兼容 shim。

## 方法与权威来源

```text
工作坊/资料/代码观察 → Inbox：事实、假设、问题和提议
  → 人工裁决与工具检查 → 领域声明 + 产品体验提议
  → 确定性知识图/报告 → 后续生成、宿主实现、行为验证与回锚
```

七阶段目录是本项目的组织约定。导入稿的 facilitator/日期不是举行真实工作坊的证据；新增内容明确 `workshopHeld: false`。

五要素不是 CQRS 的机械映射：信息架构不是聚合拓扑，读模型不是页面，参数来源不是表单控件，后台技术完成不是用户最终成功。体验提议显式表达目标、旅程、导航、内容、反馈与无障碍；它不是已获产品批准的 UI，也不是公共可执行 UX DSL。

| 路径 | 角色与边界 |
|---|---|
| `tree/workshop.yaml`、`tree/inbox/` | 七阶段入口与标准 note；提议放在 `payload.info.artifact` |
| `tree/aggregates/`、`tree/value-objects/` | 命令/事件、守卫、状态 fold、Money/FundShare 声明 |
| `tree/stories/`、`tree/use-cases.yaml`、`tree/read-models/` | 故事、前置条件与真实事件字段血缘；不证明查询实现存在 |
| `tree/sagas/`、`tree/pipelines/` | 两个原协调例子，加独立现金付款/退款契约；不是运行认证 |
| 三个根 `*-bindings.json`/`bindings.json` | 原绑定，保持原字节；fixture 和未发布目标不是可运行实现 |
| `wealth-*.json` | 第二批补充绑定；检查身份/版本后在内存合并，原嵌套 Saga 副本也做一致性检查 |
| `simulator/`、`tools/mock-ta.mjs` | 单独 MockTA，手控业务时钟、持久日志、回执与冲突；不扣款、不自动退款 |
| `tools/`、`test/` | 局部声明/体验/资金契约检查和模拟器行为测试；只读复用 sibling 纯库 |
| `projections/` | Context Map、事件流、Story Map、旅程、界面流、cash 生命周期与反馈；知识投影，不是运行时 CQRS projection |
| `compiled/`、`isolation-zone/` | 导入的旧 IR/Scala 说明样例；未重生成，不证明当前 freshness 或回锚 |
| `docs/BASELINE.json`、`docs/VERIFICATION.json` | 原始输入与首批验收历史，不重写 |
| `docs/SECOND-BATCH-INCREMENT.json` | 新 Saga/Pipeline 和补充绑定的显式增量清单 |
| `docs/SECOND-BATCH-VERIFICATION.json` | 第二批历史实测回执；不作为当前 I0 或运行/生成证据 |
| `docs/I0-BASELINE.md`、`docs/PUBLIC-EXTENSIONS.md`、`docs/CASH-FIRST-SLICE.md` | 三份权威 I0 note 的 ID/源路径/JSON Pointer 导航，不是另一份设计配置 |
| `docs/I0-VERIFICATION.json` | 历史 I0 选定源/设计与快照回执，原字节保留，不覆盖本轮 |
| `docs/CASH-ENTRY-DECISIONS.md` | 当前三项 selected-demo-design 与八项 open 的真源导航 |
| `docs/CASH-NEXT-DESIGN-VERIFICATION.json` | 本轮选择/公共拆包规格的源与设计测试回执，不认证真实行为 |

候选上下文仍为 Ledger（CreditBalance）、Payments（ExternalTransferOrder）、Fund（FundOrder + SipPlan）。这不证明公共工具已支持多上下文编译。账户余额 map 是单一 AccountId 内的币种余额，不是多账户聚合。

## 第二批已有现金路径（摘要，契约仍以真源为准）

`contract.cash-purchase-v2` 的唯一来源是 [CashPurchaseV2Contract](tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml)，JSON Pointer `/payload/info/artifact/body`。以下仅说明阅读路径，不维护另一份付款政策或验收规格。

- 新入口：`RequestFundPurchaseSettlement` / `FundPurchaseSettlementRequested`，标记 `cash-purchase-v2`，保留原账户、募集账户、操作、订单、基金与金额。
- 付款：`fund-purchase-payment-v2@v2`，投资人 outgoing → 募集账户 incoming → 订单 TCC；三 singleton barrier，durable decision，订单最后 commit。
- 付款取消：专用 `CancelCashFundSubscription` 在未Prepare时也记录空释放栅栏，晚到Prepare拒绝；旧取消消息不改，已提交付款不能走取消。
- TA：注册请求，分别记录受理、确认、拒绝、未知；`taRequestId`、`taReference` 和 `receiptId` 不是同一身份。相同回执身份/正文幂等，不同正文冲突。
- 退款：仅成功付款且明确关联 TA 拒绝，才允许新 `fund-purchase-refund@v1` 从原募集账户退到原投资人账户，金额为原本金。不是释放已消费付款预留，也不是原付款 Saga 的补偿。
- 付款结果采用 cash-v2 独立账本：可恢复/未知结果可经可信核实进展到终态；相同终态幂等，冲突终态拒绝。旧 write-once 结果契约保持不改。

**声明与实际执法分开**：账户归属/募集授权、付款成功证据、TA exact body→typed slots、退款结果→订单等可信持久桥接尚未实现。结果未知不授权再次扣款或退款。订单付款标记、TA 受理、退款申请都不能显示为最终成功。

`ux.cash-v2` 与 `flow.cash-v2` 是明确的新体验/业务图。原 `ux.skeleton/structure/surface` 和 `mock-ta.registry` 加入首批 legacy 范围说明，保留历史而不混作现金路径权威；旧定投/外部入金未迁移。不得同一请求同时触发新旧入口，也不能让现金订单走旧 `RecordTAShareConfirmation` 捷径。

## MockTA

配置唯一来源：`contract.cash-purchase-v2` 的 [真源文件](tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml)，JSON Pointer `/payload/info/artifact/body/mockConfiguration`。CNY、零费用、全本金退款是既有 demo 策略；份额 `80.0000` / NAV `1.2345` 是独立 fixture，不是 amount/NAV 计算或生产定价。I0 不重新裁决或复制这些配置。

覆盖受理、确认、拒绝、延迟、未知、相同/冲突重复回执。API：`submit`、`query`、`advanceBusinessClock`、`close/reopen`。JSONL 日志先完整写入并 fsync 再应答，严格校验序号/hashchain/重放；单写者锁、损坏日志 fail-closed，不自动修复或抢占未知锁。

```bash
node tools/mock-ta.mjs submit --request '{"requestId":"ta-001","orderId":"order-001","paymentTxId":"pay-001","investorAccountId":"investor-001","fundCollectionAccountId":"collection-001","fundCode":"DEMO-FUND","amount":{"minorUnits":"10000","currency":"CNY"},"scenario":"confirmed"}'
node tools/mock-ta.mjs query --request-id ta-001
node tools/mock-ta.mjs advance --ticks 1
node tools/mock-ta.mjs query --request-id ta-001
```

模拟器有明确的本地运行容量：单字符串最多4096 UTF-8字节，日志最多16 MiB，超限在接受新操作/读取前拒绝，不截断或丢记录。这是演示工具的资源边界，不是产品最低额、金融精度或生产存储设计。

单文件 hashchain 验证保留记录的格式、次序与内容，不能检测删除完整尾记录或恢复旧合法前缀。活跃日志轮换/替换不受支持；O_EXCL 是协作单写者约定，不是抵御人为移除锁、非协作写入或检查到写入间竞态的内核 fencing。崩溃残锁不得自动抢占，须由操作者核实无活跃 writer 后处理。

默认日志 `.scratch/mock-ta/journal.jsonl` 相对本仓库而不是 cwd。`--journal` 只允许本仓库 `.scratch/` 或 `.local/mock-ta/` 的非 symlink/hardlink 路径。请求 JSON 使用精确字符串，不接受浮点金额。查询不新发资金操作；重开只证明 **模拟器日志恢复**，不证明 Saga、账户或应用恢复。持久数据不会因验证自动清理，未知/损坏日志或既有锁不得覆盖。

## 本地验证

要求 Node >=20，且 sibling `../metarch-truthsrc` 提供对应纯库 API（路径可用 `TRUTHSRC_ROOT` 指定）。无需安装依赖或启动数据库/共享服务。

```bash
npm run test:baseline  # truth/projections/cash-contract/mock-ta 四个显式文件
npm run test:design    # 原 I0 test/i0-design.test.mjs
npm run test:next-design # 本轮 test/cash-next-design.test.mjs
npm test              # 四个 baseline + I0 design + next design；不是所有仓库测试
npm run validate
npm run verify          # 另检查自建临时树往返与投影新鲜度
npm run project         # 显式重写本仓库 projections/
npm run project:check   # 只读检查
```

这些是执行入口，不是本页发布的通过结果。当前选定六文件是 `test/truth.test.mjs`、`test/projections.test.mjs`、`test/cash-contract.test.mjs`、`test/mock-ta.test.mjs`、`test/i0-design.test.mjs` 与 `test/cash-next-design.test.mjs`。后续新测试必须在 `package.json` 的相应脚本中显式登记；没有 wildcard 或 `test:all` 默认发现机制。

**暂停草稿单独排除**：`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`、`qualification/fund-order-cash/` 原路径/字节冻结保留，不修、不移、不删。本轮不运行 qualifier；`test/domain-runner.test.mjs` 是 excluded paused suite，不是 executed skip。即使选定测试报告 0 skipped，也不包含这份暂停 suite，不能据此称全仓资格通过。

`validate` 不写盘；roundtrip 仅创建/清理本仓库自有 scratch 临时目录。工具记录 HEAD、导入闭包/Schema 和真源/绑定指纹；中途变化会使该轮认证失败。strict Saga/Execution 与 runtime lowering 单独报告，lowering 保持 `lowered-contract-only`、`runnable:false`、`runtimeBindingVerified:false`。

原 **13** 个 Saga/Pipeline/binding/IR/Scala 文件逐项哈希保护；允许添加的四个新协调文件列于增量清单，不能修改原 hash 洗白。旧 IR 不用于当前生成或回锚证明。不擅自修改 sibling、共享应用、提交或推送。

详见 [实施状态](docs/IMPLEMENTATION-STATUS.md) 与 [运行/生成移交](docs/HANDOFF.md)。
