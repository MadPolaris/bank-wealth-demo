# 第一现金付款纵切：设计真源导航

## 后续三项选择与证据

当前账户初始化／归属与募集映射／付款唯一启动者只按 [现金入口决策](CASH-ENTRY-DECISIONS.md) 的 `decision.cash-entry-prerequisites` 读取：note [CashPrerequisiteDecisionOverlay](../tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml)，`/payload/info/artifact/body/resolvedDecisions` 与 `/payload/info/artifact/body/remainingOpenDecisions`。三项为 selected-demo-design，其余八项 open；旧 I0 和本页引用的第一切口提议保持原字节，不倒写历史。

X01／X02 公共拆包见 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md)；本轮源/设计实测见 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)。`I0-VERIFICATION.json` 是历史快照，不覆盖新增选择/拆包。下述 open 描述属于 I0 当时状态，以新增覆盖层识别本轮三项变化；具体执行/资金/codec/bridge/恢复均未实现。当前显式测试增加 `test:next-design`，默认六文件，不执行 paused runner。

这是第一 cash 切口的设计包导航，不是已实现的 endpoint、认证桥接、CQRS projection、组件或可运行银行应用。新增内容是 `demo-proposal`，不是产品政策裁决；账户 setup、框架与其他 open 事项不得由文档补成默认答案。

## 先读 I0，再读切口

按 board `wealth-i0-design-v1`、refining seq 0 → 1 → 2 阅读：

1. [覆盖/scope](I0-BASELINE.md)：`decision.i0-baseline-coverage`，[I0BaselineCoverageDesignProposal](../tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)，`/payload/info/artifact/body/coverageRows` 与 `/payload/info/artifact/body/scopeDecisions`。
2. [owner/公共扩展](PUBLIC-EXTENSIONS.md)：`decision.i0-boundary-ownership`，[I0BoundaryOwnershipDesignProposal](../tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/ownershipRows`、`/payload/info/artifact/body/toolDisposition` 与 `/payload/info/artifact/body/publicExtensions`。
3. **本切口唯一设计权威**：`decision.cash-first-slice-design`，note [CashFirstSliceDesignProposal](../tree/inbox/refining/question-rf-cash-first-slice-design-proposal-2.yaml)，`/payload/info/artifact/body`。
   - 产品五要素的内容与缺口：`/payload/info/artifact/body/productPlanes`。
   - endpoint、auth/identity、codec/default、receipt projection、component、observability/deploy 等需要：`/payload/info/artifact/body/technicalNeeds`。
   - 正负例、恢复与行为证据义务：`/payload/info/artifact/body/acceptanceObligations`。

以上 pointer 相对于解析后的 YAML 文档。三个 note 为 `category: decision`、`status: demo-proposal`、`workshopHeld: false`，新政策保持 open。本页不重写五要素、endpoint/codec 规格或验收用例表；提议的名称不是已存在的公共 binding 格式、handler 或 runtime consumer。

## 已有契约与体验：沿引用读取，不重新定义

现金切口以第三份 note 的引用为入口，再依次读取：

- `contract.cash-purchase-v2` — [CashPurchaseV2Contract](../tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml)，`/payload/info/artifact/body`。付款/退款、TA 协议与 MockTA 配置均在该真源；具体入口、命令/事件、story、read-model 引用见 `/payload/info/artifact/references`。本页不是第二份付款契约或模拟配置。
- `ux.cash-v2` — [CashPurchaseV2ExperienceProposal](../tree/inbox/storyMapping/relation-sm-cash-purchase-v2-experience-proposal-0.yaml)，`/payload/info/artifact/body` 与 `/payload/info/artifact/references`。体验提议不等于渲染 UI 或产品批准。
- `flow.cash-v2` — [CashPurchaseV2LifecycleProposal](../tree/inbox/eventStorming/relation-es-cash-purchase-v2-lifecycle-proposal-0.yaml)，`/payload/info/artifact/body`。知识图关系不是运行事件投影或宿主桥接。
- `CashFundPurchaseLifecycle` — [story](../tree/stories/story-cash-fund-purchase-lifecycle.story.yaml)；`FundCashPurchaseLifecycle` — [read model](../tree/read-models/read-model-fund-cash-purchase-lifecycle.rm.yaml)。顺着 note 的 typed references 追溯字段/事件，不能把 read-model 声明当页面或查询实现。

原 legacy 入口/SIP/外部入金没有在此导航中升级为现金路径；同一请求不应由新旧入口双响应。具体隔离与身份规则仍由上述真源声明维护。

## 实现前的边界检查

先核对 scope/open decisions，再核对公共 owner 和 X01–X04 工作包，最后将 `acceptanceObligations` 交给未来实现方。公共实现需另获跨仓授权；本次不创建公共 EP、不改公共代码、不以银行专用生成/宿主 shim 绕过缺口。

本切口必须区分 public/operator/machine authority；机器结果的可信来源和持久桥接是待实现义务，不是 schema 已防伪。UNKNOWN 不授权新扣款或退款，waiting-TA 不代表最终成功。唯一 start owner、精确 value/wire 转换、同身份恢复/replay、读模型 watermark/chronology、生成与 manual 边界的具体要求只在真源维护，不能以 metadata/strict lowering/MockTA 重开代替真实行为证据。

TA 可以模拟；真实外部银行和银行 mock 不在本次授权内。独立 MockTA 不扣账、不启动 Saga、不自动退款，也不证明订单/账户/JVM 恢复。后续付款 → TA/持仓/退款 → SIP → 整体资格收口的最小联合路径保留在 [HANDOFF.md](HANDOFF.md)，均属未来验收。

## 当前证据与暂停草稿

历史 [I0-VERIFICATION.json](I0-VERIFICATION.json) 记录 I0 当时选定源/设计范围，不覆盖本轮选择/拆包。当前 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json) 只记录本轮银行源/设计验收，没有资金应用或公共扩展通过声明。第二批 [历史回执](SECOND-BATCH-VERIFICATION.json) 保留原字节，不作为当前实测或完整业务资格证明。

`npm run test:baseline` 只选四个 truth/projections/cash-contract/mock-ta 文件；`npm run test:design` 只选 `test/i0-design.test.mjs`；`npm test` 显式合并五个文件。后续测试必须在 `package.json` 中登记，不使用 wildcard 或 `test:all` 自动发现。

`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`、`qualification/fund-order-cash/` 是暂停第三批草稿，按原路径/字节冻结保留，不修、不移、不删、不调用。runner suite 是 **excluded paused suite** 而非 executed skip；选定测试的 0 skipped 不表示全仓资格通过。本页无运行、生成、machine-auth enforcement 或独立审计完成声明。
