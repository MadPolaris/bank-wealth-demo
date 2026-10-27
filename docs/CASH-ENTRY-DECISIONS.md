# 现金入口：三项 demo 决策与当前覆盖层导航

## 当前权威与历史

本轮经用户批准的三项 **selected-demo-design** 只在 `decision.cash-entry-prerequisites`，note [CashPrerequisiteDecisionOverlay](../tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml) 维护：

- 完整限定授权：`/payload/info/artifact/body/authorization`。
- 三项选择及 bootstrap／mapping／唯一启动者规格：`/payload/info/artifact/body/resolvedDecisions`。
- 对应历史条目、原选择 pointer、未来正负行为义务：各 resolved decision 的 `supersedes`、`originalChoicePointer` 和 `acceptance`。
- 其余八项仍 open：`/payload/info/artifact/body/remainingOpenDecisions`。
- 当前完整度与未实现边界：`/payload/info/artifact/body/designCompleteness`、`/payload/info/artifact/body/evidenceBoundary`。

原 [I0BaselineCoverageDesignProposal](../tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)（`decision.i0-baseline-coverage`）的 `/payload/info/artifact/body/scopeDecisions` 和原授权仍是 I0 当时快照，字节不改。当前只按新覆盖层明确引用的三项读取选择；不能将旧 register 的 open 与新选择解释成两个同步配置，也不声称公共工具已经实现通用 supersession 语义。

## 关联阅读，不复制政策

1. [I0 基线](I0-BASELINE.md) → 原 coverage 与 scope/design/evidence 分层。
2. **本页所链接的新覆盖层** → 当前三项 demo 设计、八项 open。
3. [公共扩展](PUBLIC-EXTENSIONS.md) → `decision.public-x01-work-packages` 与 `decision.public-x02-work-packages` 的公共实施交接包。
4. [现金纵切](CASH-FIRST-SLICE.md) → `decision.cash-first-slice-design` 的产品/技术需要；具体付款、TA、退款和金额政策沿既有 `contract.cash-purchase-v2`。

三个新 note 在 board `wealth-cash-next-design-v1`、refining seq 0 → 1 → 2；外层均保持 `demo-proposal`、`workshopHeld: false`。三项选择不是完整产品设计批准，不连带批准其余事项、公共写入或生产开户/金融政策。

## 设计选择不等于执法

真源把演示资金来源、已提交/未决 seed 恢复与 delayed duplicate fence 作为独立义务。只靠稳定 txid 或宿主查询不能证明不会重复 seed；实际 bootstrap 仍 blocked。trusted fixture 不是鉴权实现，单 invoke step 也不是 exactly-once 证明。旧 creation-only 命令、账户切片、Saga/Pipeline 和 bindings 不在本轮改写范围。

本轮不生成应用、不运行资金、不创建公共 EP、不改公共代码；公共源正在并行修改，其观察指纹只在新回执，公共 owner 实施前必须重新核对。暂停第三批原字节保留，不执行，不补银行本地生成/宿主兼容 shim。

## 证据入口

- 本轮源/设计范围实测由 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json) 记录；没有该回执的执行结果，不能从命令登记推断通过。
- [I0-VERIFICATION.json](I0-VERIFICATION.json) 是历史 I0 快照，原字节保留；它不覆盖新增三份 note 或当前导航。
- `npm run test:next-design` 验证本轮银行设计规格；`test:baseline`／`test:design` 保持原显式范围；`npm test` 显式合并六文件。暂停 `test/domain-runner.test.mjs` 是 **excluded paused suite**，不是 executed skip。

后续账户、authority、单启动恢复和公共生成行为证据按真源 acceptance/work-package gates 提供；本仓设计测试不替代这些实现验收。
