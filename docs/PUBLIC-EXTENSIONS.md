# 公共扩展：边界真源与 X01–X10 导航

## 当前 X03／X04 交接与全目标路线

- `decision.public-x03-work-packages` — [PublicX03WorkPackagesProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-public-x03-work-packages-proposal-1.yaml)，`/payload/info/artifact/body/packages`、`/payload/info/artifact/body/upstreamSpecification`。
- `decision.public-x04-work-packages` — [PublicX04WorkPackagesProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-public-x04-work-packages-proposal-2.yaml)，`/payload/info/artifact/body/packages`、`/payload/info/artifact/body/upstreamSpecification`。
- [FullTargetGapRoadmapProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-full-target-gap-roadmap-proposal-0.yaml) 的 `decision.full-target-gap-roadmap`，`/payload/info/artifact/body/publicExtensions`、`/payload/info/artifact/body/reuseAndFeedback`，沿 [FULL-TARGET-ROADMAP.md](FULL-TARGET-ROADMAP.md) 查完整目标与分阶段退出门。

每份四个未来子包；API／产品／目标端口／测试fixture分配、P19 overlap、兼容与版本迁移、portable／generated分层门只在新真源维护。没有公共 EP、代码实现或跨仓授权；X05–X10仍待相应纵切前拆包。P16/P17/P18限定恢复／文件锚成果应复用，P19仍须owner重新核对，不当作X03完成。

本轮证据 [ROADMAP-DESIGN-VERIFICATION.json](ROADMAP-DESIGN-VERIFICATION.json)；旧 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)仅覆盖此前选择／拆包。默认六文件不改，新 `test:roadmap` 单组、`test:current` 七显式文件；paused仍excluded，公共两域行为未由银行设计测试认证。

## 此前 X01／X02 拆包入口

原 X01–X10 在下述 I0 note 保持原字节。X01／X02 当前实施交接细化（不是公共 EP 或跨仓授权）只在新真源维护：

- `decision.public-x01-work-packages` — [PublicX01WorkPackagesProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-public-x01-work-packages-proposal-1.yaml)，`/payload/info/artifact/body/upstreamSpecification` 与 `/payload/info/artifact/body/packages`。
- `decision.public-x02-work-packages` — [PublicX02WorkPackagesProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-public-x02-work-packages-proposal-2.yaml)，`/payload/info/artifact/body/upstreamSpecification` 与 `/payload/info/artifact/body/packages`。

每份四子包；权威 ID/title/read/write-set、proposedCreateSet、公用 product/API 与 typed host-computation port、两域 fixture/test 落点、输入输出、步骤、依赖、compatibility baseline/迁移/退出门从 `packages` 读取。本页不复制规格。portable contract 与 capability-gated generated-domain behavior 是分开的证据阶段：blocked diagnostics 不算 bank positive；portable completion 不等于整项 bank 生成资格通过。公共 owner 须独立授权并重新核对其并行 dirty checkout；新出现的 `applyEntries` 应复用而非再造 apply/anchors，源码观察不是验收证明。X03–X10 仍是原 proposal-only，尚未实施/授权，银行资金门的 blockers 不能被隐藏。

三项 demo prerequisite 选择见 [CASH-ENTRY-DECISIONS.md](CASH-ENTRY-DECISIONS.md)；本轮银行源/设计回执 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)，不是公共两个领域测试或生成行为通过。旧 [I0-VERIFICATION.json](I0-VERIFICATION.json) 仅是历史快照。当前 `test:next-design` 登记第六个显式文件，paused suite 仍 excluded。


本页是导航，不是另一套公共扩展设计表。扩展的标题、输入/输出、owner、code areas、non-goals、兼容/迁移/弃用、第二领域正负例、依赖与验收门，只在下述真源条目维护。本次没有公共 EP、公共代码实现、跨仓修改或已通过公共扩展验收的声明。

## 阅读顺序与唯一权威

1. [I0 覆盖/scope](I0-BASELINE.md)：`decision.i0-baseline-coverage`，[I0BaselineCoverageDesignProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)，`/payload/info/artifact/body/coverageRows` 与 `/payload/info/artifact/body/scopeDecisions`。
2. **边界与公共扩展**：`decision.i0-boundary-ownership`，note [I0BoundaryOwnershipDesignProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)。
   - 全部 body：`/payload/info/artifact/body`。
   - repo/layer/owner：`/payload/info/artifact/body/ownershipRows`。
   - 工具处置/回流：`/payload/info/artifact/body/toolDisposition`。
   - 公共扩展条目：`/payload/info/artifact/body/publicExtensions`。
3. [现金纵切](CASH-FIRST-SLICE.md)：`decision.cash-first-slice-design`，[CashFirstSliceDesignProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-cash-first-slice-design-proposal-2.yaml)，`/payload/info/artifact/body/productPlanes`、`/payload/info/artifact/body/technicalNeeds` 与 `/payload/info/artifact/body/acceptanceObligations`。

三个 note 位于 board `wealth-i0-design-v1`、refining seq 0 → 1 → 2，均为 `category: decision`、`status: demo-proposal`、`workshopHeld: false`；新政策保持 open。范围批准不是具体产品政策批准或 machine-authority 执法证明。

## X01–X10 逐项入口

以下标题同步真源条目的 title，仅作导航；实际设计及 source owner 以权威条目为准，不在本页设另一份可编辑配置表。JSON Pointer 相对于解析后的 `I0BoundaryOwnershipDesignProposal` YAML 文档，数组索引从 0 开始；各条目的权威标题读取其 pointer 下的 `title`，例如 X01 为 `/payload/info/artifact/body/publicExtensions/0/title`。每项都属于 `decision.i0-boundary-ownership`，本次均未实现。

- **X01 — Public snapshot, declared-product and pure producer/apply seam**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/0`。
- **X02 — Ordered decision, complete parameter/binding/fold semantic admission**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/1`。
- **X03 — Exact Decimal/domain Money versus wire Money and protobuf definitions**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/2`。
- **X04 — Explicit phase evidence marker and completion resource targeting**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/3`。
- **X05 — Context-qualified typed identity and relation resolution**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/4`。
- **X06 — Versioned product artifact and deterministic design projections**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/5`。
- **X07 — Technical endpoint, authority, receipt bridge and read-side binding contracts**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/6`。
- **X08 — Static multi-face host, event-only entry, sole-start identity and completion ownership**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/7`。
- **X09 — Technical deployment, observability and test-obligation envelope**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/8`。
- **X10 — Generation consumption and certification through existing one-to-many anchors**：[真源条目](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)，`/payload/info/artifact/body/publicExtensions/9`。

## 拆包与回流流程

先读 ownershipRows/toolDisposition，再优先按 X01–X04 的权威条目拆下一轮工作包。公共 kernel/product/plugin/core 职责、code area 和 source owner 从源条目取得；跨仓写入必须独立取得对应 owner 授权，不因本轮范围批准而自动开始实现。X05–X10 保留设计入口，不表示其依赖已就绪或实现已获授权。

银行业务规则/断言、MockTA、具体绑定留在 demo；通用能力不靠本仓银行专用生成器、宿主或资格兼容 shim 补齐。沿公共条目核对第二领域正负例、向后兼容与迁移门，再由实施方提供真实证据；本页不复制输入规格或测试设计。已有一对多 anchors/apply 能力应先核对复用，不能把源码 hash 当 definition/semantics 认证或宣称完整回锚已经完成。

待裁决的新政策保持 open，不从 fixtures、demo 默认值或来源授权推导生产选择。TA 模拟允许；外部银行 mock 不在授权内。暂停第三批 `tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`、`qualification/fund-order-cash/` 按原路径/字节冻结保留，不修、不移、不删、不执行，不能作为公共扩展实现。

## 证据边界

历史 [I0-VERIFICATION.json](I0-VERIFICATION.json) 只记录 I0 当时源/设计提议验收，不覆盖本轮三项选择或 X01／X02 拆包。当前本轮证据由 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json) 记录，仍不是公共实现或兼容测试证明。第二批 [历史回执](SECOND-BATCH-VERIFICATION.json) 保留原字节。本轮不生成 Scala/应用、不构建/启动服务、不提交/推送，也不声称独立审计完成。

`npm run test:baseline` 与 `npm run test:design` 及默认 `npm test` 采用显式选择；`test/domain-runner.test.mjs` 为 **excluded paused suite** 而非 executed skip。选定测试的 0 skipped 不能称全仓资格通过；未来 suite 必须在 `package.json` 登记，不能恢复 wildcard 或 `test:all` 自动纳入暂停草稿。后续联合路径见 [HANDOFF.md](HANDOFF.md)，当前/历史状态见 [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md)。
