# 实施状态：全目标路线、公共交接与分层历史证据

## 当前 P23 追加合同（源/设计，不是运行实现）

最后更新: 2026-10-27。新真源 [P23BankV1HandoffContract](../tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)（`decision.p23-bank-v1-handoff`、`bank-v1-p23-design-1`）承接已选V1政策与四类业务描述；30个scenario均为 `execution:not-run`。新合同测试只验证声明/引用/版本/oracle完整性，不生成应用、不运行资金或恢复。

- 付款/退款指向现有准确版本bindings；TA桥和V1本地现金SIP明确列为设计要求/公共合同待补，旧外部SIP原子与六份bindings保持原字节。
- 当前交付与测试证据见 [P23-BUSINESS-HANDOFF.md](P23-BUSINESS-HANDOFF.md)；分别记录源合同、消费窗口和整体制品门，不能合并一个绿色完成标志。
- 以下历史章节的“八项open／未选栈／尚无新政策”不代表已选P23政策重新未决；新覆盖仅由明确source/supersession生效。旧测试、回执和暂停qualification仍保留。

## 当前路线图源／设计增量

- 全目标 `decision.full-target-gap-roadmap`，[FullTargetGapRoadmapProposal](../tree/inbox/refining/question-rf-full-target-gap-roadmap-proposal-0.yaml)，`/payload/info/artifact/body/coverageRows`、`/payload/info/artifact/body/phases`、`/payload/info/artifact/body/openDecisionSchedule`，入口 [FULL-TARGET-ROADMAP.md](FULL-TARGET-ROADMAP.md)。完整23行与required SIP保留，八项及退款／SIP补充决定仍open；没有新增运行目标／栈选择。
- X03／X04新增八个未来公共工作包，沿 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md) 看唯一真源规格；没有公共 EP／实现／测试执行。当前公共与peer源码仅只读观察；限定复用证据不升级为银行资格。
- 新 [ROADMAP-DESIGN-VERIFICATION.json](ROADMAP-DESIGN-VERIFICATION.json)记录本轮实测；原 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)、I0／第二批回执和旧notes/tests原字节保留。默认 `npm test` 六文件不变；新增 `test:roadmap` 与七显式文件的 `test:current`，不执行paused suite。
- 本轮只银行source/design/navigation/test/projections/新receipt，没有公共写入／应用生成／Scala构建／服务／资金运行／提交推送；bootstrap、authority、runtime绑定／恢复和完整设计仍未认证。

## 此前现金入口选择／拆包增量

日期：2026-10-26。当前交付是 **三项 demo 入口设计收口和 X01／X02 公共实施包规格**，不是公共实现、真实资金运行或完整业务/产品/技术设计。

## 当前下一轮：选择／规格／证据分别读取

- `decision.cash-entry-prerequisites` — [CashPrerequisiteDecisionOverlay](../tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml)，`/payload/info/artifact/body/resolvedDecisions` 与 `/payload/info/artifact/body/remainingOpenDecisions`；入口 [CASH-ENTRY-DECISIONS.md](CASH-ENTRY-DECISIONS.md)。三项 selected-demo-design，其余八项 open；bootstrap/fence/authority/start/recovery 未实现。
- `decision.public-x01-work-packages` 与 `decision.public-x02-work-packages` — [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md)，8个子包的唯一规格在新 note，不是公共 EP／跨仓授权。公共仓已有并行 dirty 修改，只读观察，不清理、不覆盖。
- 本轮验收在 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json) 发布实际选定结果与输入指纹；不从源码规格或命令登记推断测试通过。`test:next-design` 新增显式第六文件，原两个分组范围不改，paused suite 仍 excluded。
- 原三份 I0 note、原 I0 test、所有历史 receipts、13原+4新增保护、domain/bindings及 paused 草稿保持原字节。没有公共代码修改、生成应用、sbt/服务/资金运行、提交/推送；没有独立审计。

以下 I0／首批／第二批段落是历史快照与未实现义务，当前三项变化以新覆盖层为准，旧 open 与旧计数不倒写。

## 历史 I0：设计落盘与验收分开

按 board `wealth-i0-design-v1`、refining seq 0 → 1 → 2 阅读：

1. [I0 基线](I0-BASELINE.md) → `decision.i0-baseline-coverage`，源 [I0BaselineCoverageDesignProposal](../tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)：`/payload/info/artifact/body/coverageRows`、`/payload/info/artifact/body/scopeDecisions`。
2. [公共扩展](PUBLIC-EXTENSIONS.md) → `decision.i0-boundary-ownership`，源 [I0BoundaryOwnershipDesignProposal](../tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)：`/payload/info/artifact/body/ownershipRows`、`/payload/info/artifact/body/toolDisposition`、`/payload/info/artifact/body/publicExtensions`。
3. [现金纵切](CASH-FIRST-SLICE.md) → `decision.cash-first-slice-design`，源 [CashFirstSliceDesignProposal](../tree/inbox/refining/question-rf-cash-first-slice-design-proposal-2.yaml)：`/payload/info/artifact/body/productPlanes`、`/payload/info/artifact/body/technicalNeeds`、`/payload/info/artifact/body/acceptanceObligations`。

三份 note 是唯一设计权威，均保持 `demo-proposal`、`workshopHeld: false`；新增政策仍为 open。导航文档不双写覆盖矩阵、业务政策、扩展规格或验收表。设计落盘不表示账户 setup/归属/募集、持仓、SIP 日历/计数或 batch scope 已裁决，也不证明 machine authority 已执法。

- 默认 `npm test` 显式注册四个 baseline 文件及 `test/i0-design.test.mjs`；`test:baseline`、`test:design` 分层执行。脚本注册不是测试通过证据。
- 当前 [I0-VERIFICATION.json](I0-VERIFICATION.json) 记录源/设计提议范围的实测：原四组186项＋I0设计28项，选定214/214通过；134 YAML往返、9投影、30artifacts/200entities。结构hard0，原16notice保留；严格编译/lowering仍为contract-only。该回执不认证完整设计、公共扩展或运行；第二批回执保持历史原字节。
- `tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`、`qualification/fund-order-cash/` 是暂停的第三批草稿，原路径/字节冻结保留，不修、不移、不删；不是本轮实现或验收。
- `test/domain-runner.test.mjs` 是 **excluded paused suite**，未被默认选择，不是 executed skip。即使选定测试报告 0 skipped，也不能称全仓资格通过。新测试必须在 `package.json` 中显式登记相应范围，不能恢复 wildcard 或 `test:all` 自动运行暂停草稿。
- 本次不生成 Scala/应用、不运行第三批 qualifier、不启动 build/服务、不实现公共扩展或银行专用兼容 shim；没有公共 EP、跨仓代码修改或独立审计完成声明。

下一步先评审 I0、按公共 X01–X04 拆有 owner 授权的工作包，再进入 [HANDOFF.md](HANDOFF.md) 的未来联合验收；此顺序不自动批准新产品政策。

## 首批历史

首批提交 `dda2f24`：修复地址/字段/事件fold/门禁/读模型与用例，39个受影响atom保留sourceCapture；24张工作坊/上下文/五要素提议；三条旅程、六屏幕、七个派生文件；25/25测试、104 YAML精确往返。历史回执保留在 [VERIFICATION.json](VERIFICATION.json)，原基线 [BASELINE.json](BASELINE.json) 不重写。

**计数纠正**：首批实际保护13个原Saga/Pipeline/binding/IR/Scala文件，原文17是误报。第二批增量另有四个新协调文件，目前家族共17，不能拿此总数倒写历史保护数量。

## 第二批历史交付

以下是第二批已记录内容的历史索引，不是 I0 新政策或新的可编辑业务规格；契约/五要素/公共扩展的当前定义只在真源维护。

| 工作 | 范围与结果 |
|---|---|
| 现金入口 | 新 `RequestFundPurchaseSettlement` / `FundPurchaseSettlementRequested`，保留原请求、账户、募集账户、基金与Money；cash-purchase-v2隔离旧入口 |
| 付款Saga | 三参与者：投资人outgoing、募集账户incoming、FundOrder TCC；三singleton barrier、durable-before-commit、订单commit最后 |
| 退款Saga | 独立募集→原投资人、新operation/txid、原本金；只在付款成功与明确TA拒绝后授权，不释放已消费付款预留 |
| 付款结果修复 | 五kind专用命令/事件、current与terminal账本；未知/待恢复可进展到终态，相同final幂等、冲突final拒绝；旧write-once结果切片保持原字节 |
| TA领域事实 | 提交、受理、确认、拒绝、未知；请求/业务引用/回执身份分开；资源/付款/基金/币种关联、正文冲突、幂等门禁声明 |
| 退款领域事实 | 申请、成功、无效果拒绝、已补偿、待恢复、未知；原交易关联、receipt body/kind与terminal ledger；UNKNOWN不授权再扣款 |
| 补充绑定与lowering | `wealth-*.json`只新增；旧副本对账、schema/ID/target检查、内存合并、strict与runtime-v3 lowering |
| 独立MockTA | 唯一真源配置、七类场景、手控时钟、持久化JSONL/hashchain、严格重放、单写者自有锁、损坏fail-closed |
| 体验与图 | 独立 `ux.cash-v2`、`flow.cash-v2`；原体验稿明确legacy范围；用户输入与可信账户映射、付款/TA/退款分区、UNKNOWN和final反馈、无障碍约束 |
| 本地语义检查 | 真实参与者/方向/金额/身份/槽位/桥接引用、结果进展、冲突、UNKNOWN负例；测试解释声明，不实现第二套资金/协调引擎 |
| 保护与移交 | 原13文件逐项保护＋4新增白名单；旧IR/Scala未重生成；首批回执保留，第二批单独记录 |

## 第二批历史实测（2026-10-25，不是当前 I0 验收）

当时执行 `npm test`、`npm run verify`、`git diff --check`，历史证据见 [SECOND-BATCH-VERIFICATION.json](SECOND-BATCH-VERIFICATION.json)：

- 当时选定测试：**186/186通过**，0失败、0跳过。108个cash声明检查、47个MockTA测试、8个投影测试、23个truth/binding测试。不包含后来出现的暂停第三批 suite；数量不是业务完备性或当前全仓资格证明。
- 公共结构：0 hard errors，**16条notice**保留。
- 局部声明、提议引用、cash语义门：0 errors；27个artifacts、200个entities仍是demo-proposal。
- 四个Saga与四个Pipeline严格编译：通过，diagnostics空；runtime-v3 lowering通过，但 **lowered-contract-only、runnable:false、runtimeBindingVerified:false**。
- 精确往返：**131 YAML** 的canonical、相对路径集合、每文件字节一致。
- 派生件：**9个文件一致**，包含新增cash-lifecycle与cash-experience；双次渲染确定性通过。
- 保护：**13个原文件未变＋4个授权新增**，无越界增量。
- CLI：五个独立进程依次submit/query/advance/query/同正文submit；受理与确认有不同receiptId、同一taReference，钟0→1跨进程保留，重复请求无额外日志（总3条）。仅证明模拟器日志恢复。

工具HEAD/Schema导入闭包、source fingerprint、测试和独立复核记录见第二批回执。上述数字是记录快照，后续修改必须重新验证。

## 第二批历史公共 notice 含义

| 类别 | 数量 | 保留原因 |
|---|---:|---|
| RF5参数为空 | 3 | 原查询声明，路由实体/授权是host义务 |
| V2历史seq非连续 | 3 | 保留导入数值，不人工densify；byte roundtrip通过 |
| SA0树只检查transport | 4 | 四Saga另跑strict；运行认证仍未执行 |
| ES4方案语言 | 1 | SipPlanCreated原身份保留，领域措辞可评审 |
| CS1捕获缺trigger | 1 | 真实切片有生产关系，捕获因果追踪未伪造 |
| CS3捕获缺initiating role/policy | 2 | 原捕获稿；新协作提议不冒充公共因果索引 |
| CS6timer/mock无公共trigger | 2 | 局部提议关系已检查，公共graph未扩展 |

## 第二批历史复核修复与边界

复核发现的付款write-once和cash取消前无栅栏矛盾已修复：新增cash结果/终态账本与 `CancelCashFundSubscription`，在未Prepare时也记录取消栅栏，旧取消切片不改。验证器检查完整guard顺序与完整fold集，覆盖生产关系、TA生命周期/关联、退款操作/终态保留、额外短路守卫/矛盾写入、实际FundShare字段及共享mock配置漂移负例。

MockTA恢复fsync、自己部分锁清理、close可重试/错误保留、array继承方法绕过、原输入先校验、BOM、CLI双横线身份、活跃path/lock顺序变化等已修复并通过故障注入测试。后续复核agent因额度失败/停止，未获得最终独立签字；本批验收依据已取得的复核发现及本地重现/回归，不伪造独立审计完成。

单日志hashchain只能验证保留记录，不能检测删除完整尾记录后的合法前缀rollback；协作O_EXCL不是抵御人为unlink/replacement竞态的内核fencing。工具限制单字符串4096 UTF-8字节、日志16 MiB，超限明确拒绝，不丢记录；这是演示资源边界，不是金融/生产认证。

## 未实现/未认证

1. **实际资金/订单宿主**：ownership/collection授权、初态、稳定start身份、账户effects与精确回执；本批不扣账、不启动Saga。
2. **可信持久bridge**：付款结果认证/同身份reconciliation、TA canonical bytes→所有typedslots与持仓、退款五kind→订单。metadata的host-only不是鉴权实现。
3. **生成阻碍**：mixed legacy/structured guards原顺序、FundOrder marker字段适配、Fab专用composition host；不修改sibling。
4. **退款身份**：handler-computed refundTxId缺直接binding；source-event/pipeline recipe等价与唯一start owner必须证明，不能双启动。
5. **旧契约**：legacy TA confirmation必须由新host排除cash订单；collection旧write-once completion不是退款恢复的唯一结果权威；旧SIP/外部转账未迁移。
6. **产品和外部能力**：真实银行、完整定投、开户/冻结/归属/监管、产品最低额/日历/费用/精度/舍入；demo CNY/fee0/本金/fixture不是生产决策。
7. **体验与链路**：真实读模型handler/水位/chronology、查询/UI/无障碍审计、多上下文与公共UI DSL、完整应用/JVM恢复、源码认证/代码回锚。

MockTA 的第二批历史行为结果不意味着真实业务运行通过。先完成 I0 评审与公共首批扩展的 owner/边界授权，再由运行/生成侧执行 [HANDOFF.md](HANDOFF.md) 的未来联合验收；不能将所有 demo-proposal 自动升格为已接受产品需求。
