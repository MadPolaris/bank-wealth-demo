# 运行与生成侧移交：全目标路线与分层联合验收

## 当前 P23 银行业务交接

最后更新: 2026-10-27。先读 [P23-BUSINESS-HANDOFF.md](P23-BUSINESS-HANDOFF.md)，再按其指针消费唯一追加真源 [P23BankV1HandoffContract](../tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)（`decision.p23-bank-v1-handoff`）。包含四类当前业务描述、分离的schema/definition/plan/codec/runtime版本、已有binding与待公共合同支持的要求、正负场景及oracle；已选政策只补正式引用，没有重新决策。

共同工具链设计沿用 `metarch-truthsrc/.rounds/p24-p25-v1-design-q5bnn0o8/DESIGN.md` 及配套矩阵，不在银行复制实现规格或修改公共源码。新交接分别报告银行源/设计验收、**本会话源码消费窗口是否结束/归还**、**P23整体runtime制品门是否通过**。以下旧移交中open/未选栈/旧测试选择均为历史，不覆盖新overlay，也不因窗口归还自动批准公共实施。

## 当前移交：全目标路线与 X03／X04 未来规格

先读 [FULL-TARGET-ROADMAP.md](FULL-TARGET-ROADMAP.md)：`decision.full-target-gap-roadmap`，[FullTargetGapRoadmapProposal](../tree/inbox/refining/question-rf-full-target-gap-roadmap-proposal-0.yaml)，`/payload/info/artifact/body/coverageRows`、`/payload/info/artifact/body/phases`、`/payload/info/artifact/body/openDecisionSchedule`。完整目标保留SIP；R0–R8是未来退出里程碑，不是已实现／已授权行为，八项政策仍open。

公共移交沿 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md) 的新X03／X04四＋四包及既有X01／X02规格。现有apply／anchors／限定Fab恢复复用；P19窄锁与最新证据须owner开工再核。退款发起authority／唯一启动与旧SIP资金路径另需决定，不能由付款S09继承；没有银行兼容shim。

本轮新证据 [ROADMAP-DESIGN-VERIFICATION.json](ROADMAP-DESIGN-VERIFICATION.json)，旧 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)与I0／第二批保留历史。默认六文件和旧tests原字节，新增 `test:roadmap` 与七文件 `test:current`；暂停runner仍未执行。以下此前移交内容用于历史追溯，不将旧回执当本轮完整验收。

## 此前移交：三项 demo 选择＋X01／X02 实施规格

先读 [CASH-ENTRY-DECISIONS.md](CASH-ENTRY-DECISIONS.md)：`decision.cash-entry-prerequisites`，[CashPrerequisiteDecisionOverlay](../tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml)，`/payload/info/artifact/body/resolvedDecisions` 与 `/payload/info/artifact/body/remainingOpenDecisions`。只有账户 setup／可信归属募集映射／付款 pipeline 唯一启动三个设计 selected；原 I0 和其余八项不自动升级。

再按 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md) 的 `decision.public-x01-work-packages`、`decision.public-x02-work-packages` 移交。独立公共 owner 授权、read/write-set、两域实际行为与兼容门都在真源；不在银行仓实现公共代码/EP或 generation/host shim。未来运行前仍须证明 seed delayed-duplicate fence、authority、creation-only pending 恢复和 source/stage/txid 关联。

本轮源/设计证据 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)；旧 I0/第二批回执是历史。以下 I0 内容用于追溯，不将其 open/default test selection 当当前状态；目前增加 `test:next-design`，默认六显式文件，paused runner 不执行。


本次写入限于 `bank-wealth-demo/` 的 I0 设计与本地证据范围。未修改 Saga/Monarch、JS/BC 编译器、生成器、共享应用或运行服务。另一位 agent 的 money/Fab/composition 验收不自动扩展到银行财富。

## 先读 I0，再拆公共工作包

1. [I0 基线](I0-BASELINE.md)：`decision.i0-baseline-coverage`，源 [I0BaselineCoverageDesignProposal](../tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)，`/payload/info/artifact/body/coverageRows` 与 `/payload/info/artifact/body/scopeDecisions`。
2. [边界与公共扩展](PUBLIC-EXTENSIONS.md)：`decision.i0-boundary-ownership`，源 [I0BoundaryOwnershipDesignProposal](../tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/ownershipRows`、`/payload/info/artifact/body/toolDisposition` 与 `/payload/info/artifact/body/publicExtensions`。先拆 X01–X04；其余项不因此获得实现授权。
3. [现金纵切](CASH-FIRST-SLICE.md)：`decision.cash-first-slice-design`，源 [CashFirstSliceDesignProposal](../tree/inbox/refining/question-rf-cash-first-slice-design-proposal-2.yaml)，`/payload/info/artifact/body/productPlanes`、`/payload/info/artifact/body/technicalNeeds` 与 `/payload/info/artifact/body/acceptanceObligations`。

这些是 `demo-proposal`，不是完整业务设计、产品政策裁决或运行认证。文档只导航；业务契约、owner、公共扩展规格及验收义务在真源中维护。跨仓 public kernel/product/plugin/core 变更需独立 owner 授权和工作包；本次没有公共 EP 或公共实现，不以本仓银行专用生成器/宿主/资格兼容 shim 绕过公共能力缺口。

历史 [I0-VERIFICATION.json](I0-VERIFICATION.json) 记录 I0 当时源/设计提议范围；本轮选择/拆包证据见 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)。第二批和 I0 回执原字节保留。任何设计检查通过都不认证公共扩展、完整产品政策或银行资金运行。

## 契约与保护

原 **13** 个文件按 `BASELINE.json` 逐项保护：旧 Saga/Pipeline、三个根绑定、旧 IR、两份 Scala 样例。`SECOND-BATCH-INCREMENT.json` 允许四个新 Saga/Pipeline；补充绑定在 `wealth-*.json`，内存合并，不修改原嵌套权威副本。此前首批文档写成17是计数误报；现在家族共17＝13旧＋4新，不能重写旧hash。

新入口 `FundOrder.RequestFundPurchaseSettlement`，新事件 `FundPurchaseSettlementRequested`，版本 `cash-purchase-v2`。三参与者付款与独立反向退款严格声明已经添加；TA/退款领域切片、现金 read model/story、cash体验与知识图也已添加。具体验收以第二批机器回执为准，而不是文件存在。

旧请求、外部入金、定投与旧 `RecordTAShareConfirmation` 不迁移。新/旧请求不能双响应，现金订单不能使用旧份额确认捷径。UI提议不是公共UX DSL，多上下文解析仍未实现。

## 优先运行阻碍：从真源移交

不在本页维护另一张资金/身份/桥接规格表。未来实现方先读 `decision.cash-first-slice-design` 的 `/payload/info/artifact/body/technicalNeeds` 与 `/payload/info/artifact/body/acceptanceObligations`；具体付款/TA/退款契约沿 [CashPurchaseV2Contract](../tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml)（`contract.cash-purchase-v2`）的 `/payload/info/artifact/body` 及 `/payload/info/artifact/references` 追溯。

生成守卫/默认状态/marker 的缺口、唯一 start owner、可信持久结果桥接、exact value/wire 与读模型证据需要联合验收；它们是待实现义务，不是 metadata 或 strict lowering 的执法结果。新的 endpoint/codec/component 名称属于提议，不表示已存在公共 binding 格式或 runtime consumer。schema 不认证发送者，局部声明解释测试不替代 actor 回放、崩溃恢复或真实资金验证。

`ux.cash-v2` 的 [体验真源](../tree/inbox/storyMapping/relation-sm-cash-purchase-v2-experience-proposal-0.yaml) 与 `flow.cash-v2` 的 [业务图真源](../tree/inbox/eventStorming/relation-es-cash-purchase-v2-lifecycle-proposal-0.yaml) 同样在 `/payload/info/artifact/body` 维护；本页只保留未来协作顺序。

## MockTA已实现的独立能力

`simulator/` 从真源 `mockConfiguration` 取唯一配置，提供受理/确认/拒绝/延迟/未知/相同或冲突回执、手控时钟、严格JSONL重放与自有写锁。只写本仓自有日志；损坏日志和他人锁fail-closed，不抢占/覆盖。金额/NAV/份额使用精确字符串，不计算生产金融公式。

单文件hashchain只校验保留记录的次序与内容，不检测删除完整尾记录后的合法前缀rollback；不支持活跃日志rotation/replacement。协作O_EXCL不是内核fencing，不认证非协作unlink/替换竞态。崩溃残锁必须由操作者先核实无活跃writer，再按独立运维决策处理；模拟器不抢占。

MockTA不扣账、不启动Saga、不自动授权退款，也未连接FundOrder。测试与CLI重开证明的是模拟器行为/日志恢复，不是账户、Saga/JVM或整个应用恢复。外部银行mock不在授权范围。

## 其余业务债

- 真实外部银行：能力、授权、幂等、对账/退汇、UNKNOWN；本地ExternalTransferOrder TCC不证明外部能力。
- SIP：未迁移新现金路径；配置→期次一致性、终态去重/冲突、连续失败计数/成功清零/乱序仍待补；不保留无条件三次失败暂停策略。
- 开户/冻结/销户/归属及监管、真实产品最低额/费用/日历/精度/舍入均未验收。demo CNY/fee0/full principal/fixture不等于生产选择。
- 真实查询/UI/无障碍审计、公共context/UI Schema、源码认证/一对多锚映射仍待实现。

## 暂停第三批与测试选择

`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`、`qualification/fund-order-cash/` 按原路径/字节冻结保留，不修、不移、不删，本轮不调用。该 runner 不是已交付银行宿主或通过的资格工具。

`npm run test:baseline` 只选 truth/projections/cash-contract/mock-ta 四个文件；`npm run test:design` 只选 `test/i0-design.test.mjs`；`npm test` 显式合并这五个文件。`test/domain-runner.test.mjs` 是 **excluded paused suite**，不是 executed skip；选定测试的 0 skipped 不代表全仓资格通过。未来 suite 需在 `package.json` 显式登记，不恢复 wildcard 或 `test:all` 自动纳入暂停草稿。

## 最小联合验收顺序（未来工作，未执行）

先按 [I0 基线](I0-BASELINE.md) 明确 scope/open decisions，再按 [公共扩展](PUBLIC-EXTENSIONS.md) 的 X01–X04 真源条目拆包并取得跨仓 owner 授权；不做银行专用兼容 shim。完成相应公共能力与现金切口设计评审后，以下联合路径仍保留，具体契约/验收以真源为准，不是本轮执行计划或已完成证据。

1. 保持旧保护文件不动；在专属银行财富目标生成新版本，验收所有默认状态、消息/序列化、mixed guards与marker适配。
2. 认证请求/归属/募集映射及唯一durable start身份；实际执行三参与者付款，验证账户效果与订单标记。
3. 未知/待恢复→成功与冲突终态，重启无重复效果；验收可信付款bridge。
4. 对接独立MockTA；受理后确认、延迟、未知、重复与冲突、明确拒绝均写入订单/持仓。
5. 拒绝后独立退款，验证原账户/本金、五kind与同身份恢复；体验按可观察证据与水位显示。
6. 扩展定投，最后完成应用恢复、源码认证和代码回锚。

工具通过 `TRUTHSRC_ROOT` 只读使用纯API，记录工具/Schema与源快照指纹。旧 `compiled/` 不作为新版本证据；生成共享应用须遵守原repo协调约定，不能手改覆盖他人工作。
