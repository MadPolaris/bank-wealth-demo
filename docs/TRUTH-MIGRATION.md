# 银行真源迁移：四流承接与十三类知识覆盖

日期：2026-11-04。状态：**当前作者树和根配置已实施；303原子结构/roundtrip与14产品编译已通过，最终闭环验收见文末执行记录。**

实施更新：根配置指向 `truth/bank-wealth`，八份技术绑定在 `bindings/implementation`。新增4故事、4用例、6读模型、3角色及1上下文范围说明；原9892行大副本在新树中收敛为359行引用/范围说明，旧副本原字节保留。所有执行家族与旧V1逐项对账，旧树保留原字节。[迁移证据](TRUTH-MIGRATION-EVIDENCE.json) 和 [当前教程](TRUTH-TUTORIAL.md) 是本轮新增。下面最初的“待主集成者”是开工时的承接要求，不再作为当前状态；验收门仍逐项执行，不因建树就宣布新运行时通过。

本文件记录来源、差异、迁移动作和验收条件，不是第二份业务模型，也不是1134重新签出。当前真实执行结果由文末和工具仓验收账说明；最初只读盘点的历史实测结论仍只引用原签出，不冒称本次重新运行。README/continuation的他人改动未覆盖，旧树/绑定/发行证据未改写。

## 1. 权威、目标与冻结边界

- 已接受的业务行为及范围以 [1134签出](../v1/integration/RELEASE-SIGNOUT-1134.md) 和 [现行25项验收矩阵](../v1/integration/ACCEPTANCE-MATRIX.md) 为准。较早合同中的阶段状态不能覆盖1134结论。
- 后续欠账、保护面见 [TRUTHSRC-CONTINUATION.md](TRUTHSRC-CONTINUATION.md)。<u>retry / backoff / deadline 仍为 OPEN，未修复，也未被用户接受为合理限制。</u>
- [统一设计](../../metarch-truthsrc/PROJECT-UNIFICATION-DESIGN.md) 已获本轮实施授权；完整五层产品设计仍不是强制批准范围。旧树与冻结发行保护继续有效。

| 位置 | 本次解释与处置 |
|---|---|
| 根 `truthsrc.project.json` → `truth/bank-wealth/contexts/bankwealth/` | **已建立的唯一当前作者入口。** 新开发只编辑此树和具名技术绑定；完整请求由公共 project 编译派生，不从旧请求兜底。 |
| `v1/tree/` | 当前V1消费者所用的语义比较基线；本次按冻结输入处理，保持原路径和字节。不是新教程的长期作者入口。 |
| 根 `tree/` | 旧导入、设计提案、较宽业务范围及历史合同；保留来源，不作为当前V1事实的自动补全库。本次保持原路径和字节。 |
| 两树以外的正式输入、生成物和发行 | 明确区分实时派生、冻结请求、手写实现和发行证据，见 [消费者清单](TRUTH-ENTRYPOINTS.md)。不手改派生产物以迎合新源。 |

不采用 `current/tree` 或 `v2/tree`，也不增加一套需要与V1同时编辑的现役树。系统名 `bank-wealth`、上下文身份 `bankwealth`、旧workshop名 `bank-wealth-v1`、canonical文档ID `bank-v1` 是不同层次；搬目录不能混同或重铸它们。`bankwealth` 保持单显式上下文，不凭旧候选图拆成三个限界上下文。

**旧根树与V1树均须字节不变；移动、删除、原地归一或回写需要另行明确授权。** 六个根绑定、`compiled/`、`isolation-zone/`、`qualification/`、暂停runner、旧正式请求、P23制品和1134证据继续受保护。新源应通过引用和迁移映射保留历史，不复制整个旧模型或9892行implementation note作为新作者入口。

## 2. 承接判定规则

| 判定 | 含义 | 迁移时不能做的事 |
|---|---|---|
| 保留当前语义 | 当前V1原子的规则、身份、参数、关联、顺序和结果边界继续有效；表示迁移仍待等价验证。 | 以“格式清理”改金额、顺序、身份派生或错误处理。 |
| 同一需求的当前实现 | 旧提案/声明说明需求来历，现行合同和1134说明已选行为；两者不一定语义等价。 | 把旧→V1业务差异说成纯重命名或追认旧实现通过。 |
| 范围外历史 | 如外部银行充值、跨行定投、未选产品最低申购额/估值设计；保留明确历史引用。 | 为凑覆盖重新实现，或拿它们替代当前现金路径。 |
| 当前源覆盖待补 | 已验行为存在，但没有清楚的当前故事、用例、角色或读模型说明；后续从接受过的行为整理作者说明。 | 把旧文本尚存在、页面已运行或产品编译通过写成源覆盖完成；伪造审批。 |
| 独立开放问题 | 如重试策略贯通；记录真实缺口，另行授权实施。 | 降为“不适用”，或因迁移/教程成功而关闭。 |

表示迁移的比较对象是**同一已选V1业务**。旧业务范围到V1的选择差异单列解释；任何新的业务设计变化必须有新批准依据和预期，不藏进迁移。以下四流均属于承接范围，教程首条切片不能缩减它。

## 3. 四流语义承接

### F1 — 付款与原现金请求

**当前实际载体**

- [CreditBalance聚合与切片](../v1/tree/aggregates/credit-balance/)、[FundOrder聚合与切片](../v1/tree/aggregates/fund-order/)，服务入口先 [RecordCashRequestSource](../v1/tree/aggregates/fund-order/slices/record-cash-request-source.slice.yaml)，再 [RequestFundPurchaseSettlement](../v1/tree/aggregates/fund-order/slices/request-fund-purchase-settlement.slice.yaml)。
- 领域入口事件 `FundOrder.FundPurchaseSettlementRequested` → [bank-cash-payment-v1 pipeline](../v1/tree/pipelines/bank-cash-payment-v1.pipeline.yaml) → [同ID付款Saga](../v1/tree/sagas/bank-cash-payment-v1.saga.yaml)。Saga是事务合同，pipeline是耐久阶段编排，不能合成一个概念。
- 可信入站见 [BankTrustedAdmission](../v1/handwritten/scala/example/bankwealth/integration/BankTrustedAdmission.scala)；原identity、原资金参数、五类结果交付及恢复的接受范围见矩阵P26、P27与P31-1。

**旧证据与差异**

[旧PurchaseFund用例](../tree/use-cases.yaml) 和 [fund-subscription-pay](../tree/sagas/fund-subscription-pay.saga.yaml) 是旧申购声明，不等于当前三participant现金付款。[cash-v2付款Saga](../tree/sagas/fund-purchase-payment-v2.saga.yaml)、[现金付款pipeline](../tree/pipelines/fund-purchase-cash-payment.pipeline.yaml) 与 [CashFundPurchaseLifecycle故事](../tree/stories/story-cash-fund-purchase-lifecycle.story.yaml) 是当前需求的较近来源，仍保留其当时未认证的声明状态。

**迁移动作**

保留当前V1而非回退旧两participant路径：principal＋clientRequestId固定原请求身份，完整来源先持久化；投资人出款、募集户入款、订单付款确认分别成立，订单last commit。同key异正文拒绝，不通过改正文制造新operation。保留取消fence、late Prepare无资金效果、五类结果与原投递目标；UNKNOWN保原父流程，耐久commit决定后只可同identity向前恢复。名称中已有`v1`不因新目录而自动改名。

**迁移验收**

按P26-1～3、P27-1～5逐项映射新源；本金oracle仍为两账户 `1000.00 / 0.00 → 900.00 / 100.00`。新候选须证明重入/冲突无第二资金效果、订单不先于资金提交、取消与补偿不误报成功、指定恢复继续原身份。测试入口来源包括 [BankSinglePaymentOracleSpec](../v1/test/scala/BankSinglePaymentOracleSpec.scala)、[BankPaymentRecoverySpec](../v1/test/scala/BankPaymentRecoverySpec.scala)；本次未执行。

### F2 — TA提交、受理与份额终态

**当前实际载体**

- [RegisterFundTASubmission](../v1/tree/aggregates/fund-order/slices/register-fund-ta-submission.slice.yaml) 产生 `FundOrder.FundTASubmissionRegistered`，驱动 [bank-ta-submission-v1](../v1/tree/pipelines/bank-ta-submission-v1.pipeline.yaml)。
- [RecordFundTAConfirmed](../v1/tree/aggregates/fund-order/slices/record-fund-ta-confirmed.slice.yaml) 的实际事件名是 `FundTASharesConfirmed`；相关accepted/rejected/unknown切片在同一目录。矩阵中的“TAConfirmed”是业务结果称谓，不应被迁移工具当作另一个实际事件ID。
- [BankTaRefundApplication](../v1/handwritten/scala/example/bankwealth/ta/BankTaRefundApplication.scala)、[BankTaBridge](../v1/handwritten/scala/example/bankwealth/bindings/BankTaBridge.scala) 是明确手写宿主/可信回执实现；不是可由名字自动推导的第二份领域规则。

**旧证据与差异**

[fund-ta-settlement](../tree/pipelines/fund-ta-settlement.pipeline.yaml)、[结算/退款设计](../tree/inbox/refining/question-rf-settlement-and-refund-decision-proposal-3.yaml)、[MockTA设计](../tree/inbox/refining/externalSystem-rf-wealth-mock-ta-registry-design-proposal-1.yaml) 和旧用例记录异步TA需求。旧`RecordTAShareConfirmation → FundSharesConfirmed`与当前完整付款、资源、正文、回执关联不是仅换名的同一合同。

**迁移动作**

保留只对真实已付款订单提交；taRequestId、paymentTxId、原正文及资源固定，scenario来自受信demo配置。付款成功、TA accepted和技术effect confirmed都不等于投资成功；相关份额确认才成功，UNKNOWN不是拒绝，可信TA拒绝才可进入独立退款。shares/NAV原文本不转浮点、不顺手改精度。基金公司/TA保持获准模拟，不补造真实外部集成。

**迁移验收**

按P28-1～3、P31-1对照新源和 [BankTaApplicationSpec](../v1/test/scala/BankTaApplicationSpec.scala)：未付款、错误资源、冲突正文拒绝；accepted-only/UNKNOWN不报成功；register→submit→accept→ingest指定恢复窗口维持原identity、不重复提交。将这些当前行为整理为后续故事/用例，不把旧“桥待补”或新说明改写成旧模型已通过。

### F3 — 独立反向退款

**当前实际载体**

- [RequestFundPurchaseRefund](../v1/tree/aggregates/fund-order/slices/request-fund-purchase-refund.slice.yaml) → `FundOrder.FundPurchaseRefundRequested` → [bank-independent-refund-v1 pipeline](../v1/tree/pipelines/bank-independent-refund-v1.pipeline.yaml) → [同ID独立退款Saga](../v1/tree/sagas/bank-independent-refund-v1.saga.yaml)。
- [RecordFundRefundSucceeded](../v1/tree/aggregates/fund-order/slices/record-fund-refund-succeeded.slice.yaml) 产生 `FundRefundSucceeded`；其它四类结果在同一聚合目录。手写关联见 [BankRefundBindings](../v1/handwritten/scala/example/bankwealth/bindings/BankRefundBindings.scala) 和TA/退款应用。

**旧证据与差异**

[旧独立退款Saga](../tree/sagas/fund-purchase-refund.saga.yaml)、[旧退款pipeline](../tree/pipelines/fund-purchase-cash-refund.pipeline.yaml)、[现金生命周期读模型](../tree/read-models/read-model-fund-cash-purchase-lifecycle.rm.yaml) 保留来源。旧`RecordFundRefundCompleted → FundRefundCompleted`与当前`RecordFundRefundSucceeded → FundRefundSucceeded`必须显式承接，不能让旧读模型事件名暗中命中新对象。

**迁移动作**

保留“原付款已成功＋相关可信TA拒绝”才创建唯一退款intent/parent/transaction。原募集户→原投资人，全本金反向；客户不能给退款目的地或替换本金。退款不是对已commit付款Saga的补偿；原付款成功事实保留。早拒绝、补偿、UNKNOWN及退款处理中不等于本金已退。恢复只继续既有退款身份，结果ACK丢失不铸第二退款。

**迁移验收**

按P29-1～3、P31-1对照 [BankRefundApplicationSpec](../v1/test/scala/BankRefundApplicationSpec.scala) 与原恢复证据：完整本金真实返回才完成；替换/重复/未知路径无第二资金效果；intent、装配、Prepare/Commit收据和结果交付间隙由真实恢复路径承接，而非测试手发Reconcile替代业务恢复。

### F4 — 有限定投、现金派发与首次终态计数

**当前实际载体**

- [SipPlan聚合及切片](../v1/tree/aggregates/sip-plan/)：完整create intent、Create/Append/Seal、单调tick、revision、pause/resume、期次分类和首次终态记录。
- [TriggerSipInstallment](../v1/tree/aggregates/sip-plan/slices/trigger-sip-installment.slice.yaml) → `SipPlan.SipInstallmentTriggered` → [bank-sip-dispatch-v1](../v1/tree/pipelines/bank-sip-dispatch-v1.pipeline.yaml) → 原现金入口，而不是另一条资金状态机。
- [BankSipApplication](../v1/handwritten/scala/example/bankwealth/sip/BankSipApplication.scala)、[BankSipTerminalBridge](../v1/handwritten/scala/example/bankwealth/bindings/BankSipTerminalBridge.scala)、[BankBusinessClock](../v1/handwritten/scala/example/bankwealth/integration/BankBusinessClock.scala) 承担既有入站、派发/终态桥与显式业务时钟。

**旧证据与差异**

[旧SipPlan](../tree/aggregates/sip-plan/)、[CreateAndRunSipPlan故事](../tree/stories/story-create-and-run-sip-plan.story.yaml)、[sip-installment-execution](../tree/pipelines/sip-installment-execution.pipeline.yaml)、[定投完整性设计](../tree/inbox/refining/question-rf-sip-integrity-decision-proposal-4.yaml) 保留需求来历。旧cron/外部银行充值组合不等于当前有限现金日程；同名Create/Trigger命令不能据名字判定等价。[三败自动暂停问题](../tree/inbox/commandStorming/question-cs-auto-pause-sip-on-three-failures-10.yaml) 已保存退役政策原文，不是当前执行政策。

**迁移动作**

保留完整有限vector先持久、恢复只补精确前缀；不靠客户重发、墙钟或内存日程补造期次。revision只影响未来区间；暂停保backlog、跳过paused dues、in-flight继续，恢复不复活跳期。occurrence固定身份先持久再按序派发，不等前一期TA终态。只有可信相关首terminal计一次；付款/accepted/UNKNOWN/退款未完成不计终态，失败总数不清零，三败不自动暂停，晚到或重复terminal不再计数。

**迁移验收**

按P30-1～4、P31-1对照 [BankSipRecoverySpec](../v1/test/scala/BankSipRecoverySpec.scala)、[BankSipCatchupJointSpec](../v1/test/scala/BankSipCatchupJointSpec.scala) 及原指定恢复窗：原vector/顺序/资金参数、唯一现金parent、暂停与revision边界、首terminal及计数均保真。不得为简化教程删除定投，或将旧跨行设计补进V1。

## 4. 已定位的名称、所有权和历史来源漂移

[BankV1Implementation note](../v1/tree/inbox/refining/question-rf-bank-v1-implementation-0.yaml) 的 `/payload/info/artifact/body/entryOwnership`（9877–9882行）仍为早期名字；其`readiness`还写着`not-yet-authored/generated=false/executed=false`。这不能覆盖1134，也不能被当作当前入口索引。本次只定位该尾部及来源头部，未整页展开9892行旧note。

| 旧note中的入口值 | 当前实际产品ID | 新源的处置要求 |
|---|---|---|
| payment: `bank-cash-payment-v1` | 同名付款pipeline和Saga | 保留各自kind及版本，不能只用裸ID丢掉类型。 |
| refund: `bank-cash-refund-v1` | `bank-independent-refund-v1` | 修正新源入口引用；保留旧别名、来源版本及“独立退款”的含义。 |
| ta: `bank-ta-v1` | `bank-ta-submission-v1` | 明确是提交/观察边界，不把技术confirmed映射成投资成功。 |
| sip: `bank-sip-local-v1` | `bank-sip-dispatch-v1` | 明确是期次派发边界，终态由可信关联回桥。 |

上表是需实施的映射，不是本次已修复。F2/F3的消息名差异、F4的同名异合同也须进入新源引用对账。新源应指向现行原子，旧note、旧`sourceCapture`、`inheritedSources[].value`及历史readiness原样冻结，不重新包装成新审批。

来源身份必须区分：作者对象的限定身份、旧noteId/别名、冻结`origin.seq`、某次snapshot的JSON Pointer。指针必须绑定对应快照摘要；`/aggregates/1`、当前位置或`nextN`不是永久知识ID。同名或旧号多义须报告歧义，不能自动合并。原引用中`tree/...`的意义应通过显式来源映射保存，不因新文件所在目录改变而错指新树。

## 5. 十三类知识 COVERAGE

**分类严格来自JS [`INBOX_PRODUCTS`](../../metarch-truthsrc/lib/shared.mjs)（33–47行），不是`NOTE_TYPES`，也不是十三种旧便签类型。** 这些是覆盖视角，不要求造满十三个目录；已落实规则只在aggregate/slice等原子定义一次，inbox/叙事以引用连接。

原V1基线只有implementation note承载说明。新源已增加4故事、4用例、6读模型、3角色及上下文范围说明；原三聚合/两Saga/四pipeline及正式技术产品保持原执行语义。新inbox README逐类列明载体与省略理由，见 [当前覆盖](../truth/bank-wealth/inbox/README.md)。

以下逐类记录原V1与历史证据、承接要求。其“待补”项已在上述新作者载体落实，验收结果在第6节；不把历史目录链接当作新作者入口。

| COVERAGE类别 | 当前实际载体与覆盖状态 | 旧证据 | 迁移动作 | 逐类验收条件 |
|---|---|---|---|---|
| **01-event-flow** | F1–F4的slice事件、两Saga、四pipeline；P27～P30定义结果分层。 | [旧事件流](../tree/inbox/eventStorming/relation-es-wealth-event-flow-design-proposal-0.yaml)、[cash-v2生命周期](../tree/inbox/eventStorming/relation-es-cash-purchase-v2-lifecycle-proposal-0.yaml)。 | 新事件流只引用当前事件与协作合同；旧跨行分支留历史。 | 四流的成功、早拒绝、补偿、未知/恢复、TA拒绝→独立退款均能追到当前定义；不存在付款成功即投资成功的边。 |
| **02-commands** | [当前聚合切片](../v1/tree/aggregates/)、[服务端点](../v1/tree/formal-products/artifact-contract/bank-service.formal.yaml)及可信入站；独立当前角色说明待补。 | [actor-command关系](../tree/inbox/commandStorming/relation-cs-wealth-actor-command-design-proposal-0.yaml)、旧Investor/SipScheduler/WealthOpsOfficer角色。 | 保留当前命令/参数/guard；后续补当前角色→入口引用，不沿用旧角色权限推定。 | customer/operator/internal入口逐一归属；客户不能seed、指定退款目标、注入机器字段或TA结果；P26-2、P28-1、P29-2可回查。 |
| **03-aggregates** | [CreditBalance](../v1/tree/aggregates/credit-balance/aggregate.yaml)、[FundOrder](../v1/tree/aggregates/fund-order/aggregate.yaml)、[SipPlan](../v1/tree/aggregates/sip-plan/aggregate.yaml)，均显式`bankwealth`。 | [旧aggregateDiscovery](../tree/inbox/aggregateDiscovery/)及四聚合树（含ExternalTransferOrder）。 | 三个当前一致性边界保留；ExternalTransferOrder作为范围外历史，不虚构第四个V1聚合。 | 所有当前命令/事件有唯一聚合owner；跨聚合资金通过显式Saga，不把外部充值混入现金付款。 |
| **04-subdomains** | 当前功能范围可由三聚合及P26～P30说明；未见独立当前子域原子。 | [ledger/payments/fund子域提案](../tree/inbox/subdomainExploration/)。 | 后续写明当前范围与旧候选分类的关系；未裁定的战略分类继续标提案。 | 读者能区分当前有界银行能力、范围外外部银行能力及未批准划分；不能仅复制旧三子域即称战略设计已通过。 |
| **05-context-map** | 原子中的`context: bankwealth`、[bankLayout](../tools/v1-inputs.mjs)的单context与服务/TA外部绑定；完整当前职责说明待补。 | [旧三context候选图](../tree/inbox/contextMapping/relation-cm-wealth-context-map-design-proposal-3.yaml)。 | 目标明确一个`bankwealth`，TA为模拟外部边界；旧ledger/payments/fund保留候选身份。 | 目录、声明、配置、原子context一致；资金与定投未被机械拆context；MockTA不被写成真实外部银行/TCC能力。 |
| **06-aggregate-detail** | 当前aggregate的state/order/defaults与slice guards、bindings、foldAssignments；[值对象](../v1/tree/value-objects/)；部分精确值配置仍在`bankExactTypes/Codecs`。 | [旧aggregate及slice](../tree/aggregates/)、[旧字段追溯](../tree/inbox/refining/relation-rf-wealth-field-traceability-design-proposal-0.yaml)。 | 当前细节唯一表达；逐项分离业务精度/币种与技术编码，不复制派生decisions/folds。 | 默认值、命令顺序、guard顺序、错误结果、事件槽→状态更新和精确数值不变；编译派生可追到单一定义。 |
| **07-aggregate-relations** | 付款三participant、退款两participant；订单TA关联、SipOccurrence→现金parent及可信terminal桥。 | 旧付款/退款Saga、[定投组合](../tree/pipelines/sip-installment-execution.pipeline.yaml)、旧aggregate-boundary提案。 | 以限定引用记录一致性/协作边界，不复制参与者模型；保留原owner和资金方向。 | 付款订单last commit、独立反向退款、SIP引用原现金入口均可解析；跨边界只传已声明身份/数据，不重建第二资金模型。 |
| **08-message-detail** | 当前slice参数/事件槽、[technical-port](../v1/tree/formal-products/technical-port/)、[external-event-producer](../v1/tree/formal-products/external-event-producer/)、值对象和宿主合同。 | 旧slice、六根绑定及旧TA/退款receipt合同。 | 保留原正文、txid/request/occurrence、回执精确关联；将旧/新事件名映射分开记录。 | 类型/限定owner/消息名/来源/结果kind全解析；金额不变浮点，shares/NAV不重格式化，重复/冲突/错误资源仍按原合同。 |
| **09-lineage** | [bankLayout/source指针](../tools/v1-inputs.mjs)、formal原子provenance、[手写来源映射](../v1/integration/HANDWRITTEN-SOURCE-MAP.json)、1134文件锚证据；note有旧入口漂移。 | 旧`sourceCapture`、`origin.seq`、[字段追溯提案](../tree/inbox/refining/relation-rf-wealth-field-traceability-design-proposal-0.yaml)及冻结请求。 | 实施第4节的限定身份/来源映射，新源引用当前对象，冻结副本只作证据。 | 每个新对象可解释旧来源及处置；pointer带快照、歧义不选首项、代码SHA与来源时效分开核验；不把file锚冒成symbol/span证明。 |
| **10-policies** | 规则实际在guards、Saga safety/resilience、可信入站、恢复/TA/退款/SIP桥；独立policy目录不是当前载体。 | [三败暂停退役问题](../tree/inbox/commandStorming/question-cs-auto-pause-sip-on-three-failures-10.yaml)、[结算/退款](../tree/inbox/refining/question-rf-settlement-and-refund-decision-proposal-3.yaml)、[定投完整性](../tree/inbox/refining/question-rf-sip-integrity-decision-proposal-4.yaml)。 | 从接受的P27～P30行为补政策说明并引用规则owner；retry另列OPEN，不造执行policy填目录。 | 每条自动触发有真实受信调用者和条件；三败不自动暂停、UNKNOWN不授权新扣/退、commit后不abort；重试缺口可见且未被静默丢弃。 |
| **11-stories** | 四个[product-design review](../v1/tree/formal-products/product-design/)与页面合同提供部分连接；当前独立故事说明待补。 | [四个旧stories](../tree/stories/)；其中TopUpFromExternalBank是范围外，其他故事混有旧设计边界。 | 后续按当前客户/操作员行为整理付款、TA、退款、SIP故事，逐一引用现行用例/命令和矩阵；不搬旧审批/作者履历。 | 四流的用户目标、角色、成功/待处理反馈有当前来源；故事内容与P26～P30一致，旧缺口状态不顶替已验行为，product-design仍保留proposal。 |
| **12-use-cases** | [集成合同](../v1/integration/CONTRACT.md)、[页面合同](../v1/integration/PAGES-CONTRACT.md)和现行矩阵有已选行为；当前独立用例文件待补。 | [旧use-cases](../tree/use-cases.yaml)：TopUpFromExternalBank/PurchaseFund/ExecuteSipInstallment/CashFundPurchaseLifecycle。 | 从接受行为整理四流当前主/备选路径，引用真实command/event；保留旧用例的原范围，不复制为现役规则。 | 每流入口、权限、原identity、前置、结果、拒绝/未知/恢复均可定位；退款与TA不被省略为付款的一句附注；定投不降为单次付款。 |
| **13-read-models** | 服务有query DTO/端点/pages，但`deployment.service.projections`实际为`[]`；[BankReadside](../v1/handwritten/scala/example/bankwealth/readside/BankReadside.scala)、[五表schema](../v1/handwritten/scala/example/bankwealth/readside/BankReadsideSchema.scala)承载已验读侧，当前独立业务读模型说明待补。 | [InvestorWealthOverview](../tree/read-models/read-model-investor-wealth-overview.rm.yaml)、[SipPlanExecutionView](../tree/read-models/read-model-sip-plan-execution-view.rm.yaml)、[FundCashPurchaseLifecycle](../tree/read-models/read-model-fund-cash-purchase-lifecycle.rm.yaml)。旧文件明确不认证余额/估值、完整chronology或运行投影。 | 后续依据P31-2及当前实现说明账户/原请求/订单分层状态/计划期次/pending视图、字段来源、权限和水位；引用PB及schema，不把五张技术表直接当五个业务模型。 | 字段/来源事件/关联/去重/事务水位/可见角色逐项对应；未知、未追平、不存在、失败分开，GET零副作用；旧事件名无悬空引用。页面通过及空projections均不能替代此源覆盖门。 |

### 源覆盖补齐与语义边界

这些描述性原子已按当前已接受行为整理并被公共编译器实际读取，没有重新设计银行资金规则，也没有改变审批字段。

1. **角色**：旧Investor/WealthOpsOfficer可解释客户/操作员需求来源，但当前权限以 [BankDemoAuthority](../v1/handwritten/scala/example/bankwealth/security/BankDemoAuthority.scala)、服务audience和P26为准。旧SipScheduler不能被追认为已部署cron；当前是受信服务及显式manual tick。来源说明应包含机器入口，不能只画两个页面角色。
2. **故事/用例**：为F1–F4补当前叙事与现行原子/矩阵引用。四个review原子均为`status: proposal`、`approvalSource: null`；有五层节点并不等于**完整五层产品设计获批**。后续填说明也不自动改变这两个字段。
3. **读模型**：由真实读侧和P31-2整理业务视图、字段来源、关联与权限。技术五表为`bank_read_namespace/stream/event/occurrence/pending`，schema版本见代码；不要把DDL、JSON缓存或旧`projections/*.md`当作已完成的当前业务视图定义。
4. **战略范围/上下文**：解释单`bankwealth`及TA模拟边界，保存旧候选分类为候选。若要改变业务拆分或接受新战略关系，须另有明确决定。

## 6. 精确机械退出门与实际状态

这些是迁移完成判据。源码/结构/生成测试与应用运行认证分开计，未执行的运行窗口不能靠1134历史结果补签；见 [TRUTH-ENTRYPOINTS.md](TRUTH-ENTRYPOINTS.md) 与公共工具验收账。

| 门 | 必须检查的输入、断言与输出 | 本次状态 |
|---|---|---|
| M0 保护基线 | 在任何后续写入前捕获受保护两树、六根绑定、正式输入、compiled/qualification/isolation、暂停13文件及冻结发行相关路径的文件集合和SHA；写后集合/字节逐项相等，除非有逐路径新授权。新源/配置/文档使用独立授权清单，不能排除整个目录掩盖漂移。 | 已核：V1逐文件SHA与迁移前捕获一致；其余保护路径当前Git diff为空。未伪造未做的全工作区前后捕获。 |
| M1 单一身份入口 | 固定配置schema、根/原子语法版本；根配置只选择`truth/bank-wealth`，context目录/声明/原子均为`bankwealth`。故意改错任一身份或使用未知context必须诊断拒绝，不能注入默认值或回退`v1/tree`。 | 已通过：author-tree、author-contract-negative和银行current合同反例。 |
| M2 完整承接 | F1–F4及13行逐一有当前目标对象或有依据的历史处置；选定范围内影响规则、身份、角色、读模型及来源解释的缺口全部补齐并审阅。第4节入口与消息名漂移有明确映射，当前引用解析成功；仅填“未决”不能通过。 | 已实施并结构验证：15个描述性原子，四流和十三覆盖有当前载体；5层proposal不变。 |
| M3 身份与来源 | 检查限定对象身份唯一域、旧别名歧义、冻结seq、旧/新原子定位及snapshot摘要；重排、移动、同名对象不得重铸ID或误合并。缺失/过期/历史来源必须分别返回；source pointer可追到实际原子。 | 已通过：1557来源记录、完整银行文件正反查；最终TA/SIP故事引用均解析，重排/移动/歧义/历史文件及新增未生成知识反例通过。 |
| M4 结构与往返 | 对自有候选运行已支持的validate、compile、roundtrip；同一物理树确定性编译，compile/decompose的原路径与字节合同成立。七阶段兼容和十三类输入不混用；未知目录/知识文件/字段须明确拒绝，不能静默跳过报绿。原输入前后SHA不变。 | 已通过：新树0hard/37notice、303原子物理路径/字节往返；公共严格作者负例和旧字节回归通过。 |
| M5 同业务语义等价 | 用当前V1冻结比较输入与新候选逐项比较：限定身份/类型、guards及顺序、defaults、bindings/folds、Saga participant与屏障顺序、输入输出/结果、安全策略、pipeline、host/port及精确值。允许的路径/布局/来源位置差异单列白名单；不要求跨布局canonical全部字节相同，也不靠忽略业务字段消差。新叙事补覆盖不能夹带规则变更。 | 已通过银行current合同：原执行家族和14个编译产品payload逐项相等，新叙事与冻结引用分列。 |
| M6 完整派生与准入 | 从新树＋显式技术选择派生完整service请求，经公共file capture和API编译结果相等，全部要求的产品/版本/依赖与源覆盖齐全。保留四流，不能用七项domain prerequisite、空host、`payment-376`或只编付款替代完整请求。缺绑定/不支持能力在目标写入前拒绝。 | 已通过：根项目捕获当前树＋8具名绑定，14产品payload逐项对账；无编号请求/历史authoring输入，完整service预览193源码。 |
| M7 消费者分流 | 对入口清单逐项记录实际读路径。修改自有候选一条支持的知识后，当前检查/计划必须观察到变更；历史模式只能读指定冻结输入并标历史。缺新配置、旧快照冒充fresh、错误目标要拒绝，不能静默回退。历史runner保持暂停。 | 已通过：旧模糊CLI拒绝，无参历史request拒绝；当前根无历史输入fallback。 |
| M8 安全生成与稳定性 | 正式公共producer的`--plan`返回未apply且不创建目标；实际生成只经唯一apply进入新授权目标。缺失/冲突不先破坏目标。相同输入在另一新目录再生，差异只限明确允许的定位字段；MANUAL/KEEP及外置手写根不被覆盖，不隐式删除旧文件。 | 已通过：银行193源码＋4证据完整apply；临时副本变更、update预览/apply、相同输入repeat零写；公共MANUAL/KEEP/冲突反例通过。 |
| M9 回锚与双向定位 | 对实际新生成文件重算SHA、1:N源指针/版本；手写implements/supports/legacy关系单列。知识→文件、文件→知识都回到新原子且能解释旧来源；代码偏离生成与知识/配置/工具过期分开报告，裸`nextN`不能冒称稳定ID。 | 已通过银行完整集成5/5：ReserveFunds双向反查和nextN候选、新源变更后旧/当前快照状态；文件SHA由公共apply/query复核。手写根不作为自动生成来源。 |
| M10 候选行为不退化 | 在另行授权的执行窗口，对同一新输入生成的候选完成对应compile/Test compile及四流、权限、读侧/页面相关验收；F1～F4的精确oracle和P26/P31相关边界逐项有新证据。共同BC/JS profile若都声明支持，须各自准入/生成并对账，不能以一链或小fixture替代银行。测试存储层次与平台边界如实记录。 | 离线compile/Test compile已通过；续接生成-only23项成功，后续固定四流actor窗口41业务＋23生成测试全部成功（13Suite），499main／14test源冷编译、15保护checks true。actor持久化为testkit、TA为显式冻结fixture；未重新运行四流HTTP/真实数据库/跨JVM恢复/页面窗口，未操作BC生成应用。具体已验与未验边界见[运行验收说明](TRUTH-RUNTIME-ACCEPTANCE.md)，本门运行级部分仍未全通过。 |
| M11 切换与教程 | 主集成者先完成M0–M10适用门及缺口收口，再设根配置默认并核对所有默认命令只选新源；旧两树仍冻结可定位，未适配旧入口明确历史或拒绝当前使用。教程由主会话接线并实际验证建树→编译→生成→文件回锚/反查→变更再生，四流均有章节；完成字段只填写实际命令/结果。 | 作者/包命令已切换并验缺省拒绝；教学生成/查询/变更闭环5/5通过。原1134仍是运行发行，新候选不替代其运行签收；M10全运行窗未完成，所以不声称发行级迁移全部结束。 |

业务新增/修改不属于M5等价白名单；需要独立决定、版本与预期。若候选只能从旧作者源补取现行规则，则仍是迁移未完成，不能因小型样例通过或共同产品子集存在就宣布统一完成。

### 重试账的保留，不是退出门偷换

当前两份Saga明确有`maxAttempts=1`、零backoff及phase/query/total timeout声明。其精确值由原子拥有，本文不另定义策略。continuation已说明strict lowering的限制、total deadline未验证宿主义务及恢复调用者/退避/重启续接尚待完整核验；`maxReconcileInteractions=32`不是业务重试次数。已验启动补扫和指定恢复窗不等于所有暂时故障自动重试完整。

**表示迁移应保留并暴露这些事实与OPEN账；不能删除不支持策略、补造默认重试或用有限profile豁免。** 是否修复runtime是独立后续范围，不因本文而重发P23制品。1134既定本地demo签收不撤销，也不因新源、教程或本表完成而扩大/重新签收。
