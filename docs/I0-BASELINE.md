# I0 基线：真源与证据导航

## 后续当前覆盖层

I0 下述三份 note 和 [I0-VERIFICATION.json](I0-VERIFICATION.json) 现为原字节保留的历史快照。当前只将三个 demo prerequisite 设计按 [现金入口决策](CASH-ENTRY-DECISIONS.md) 的 `decision.cash-entry-prerequisites` 覆盖层收口：note [CashPrerequisiteDecisionOverlay](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml)，`/payload/info/artifact/body/resolvedDecisions`、`/payload/info/artifact/body/remainingOpenDecisions`；其他八项仍 open。旧 register、授权及测试不倒写，不能将旧 open 当成当前三项未选择。

X01／X02 的当前拆包入口见 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md)。本轮证据为 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)，不认证 bootstrap、authority、唯一启动行为或公共实现。以下 I0 段落描述当时边界；当前显式测试新增 `test:next-design`，默认六文件，暂停 suite 仍 excluded。

当前交付是 I0 覆盖/边界提议与第一现金付款纵切设计包，不是完整银行财富业务、产品、技术设计已完成。获准落盘不表示尚未裁决的账户、持仓、日历或批量业务政策获准。

## 阅读顺序与唯一权威

三个标准 `kind: note` / `type: question` 位于 board `wealth-i0-design-v1`、refining seq 0 → 1 → 2。其 artifact 均为 `category: decision`、`status: demo-proposal`、`workshopHeld: false`；新政策保持 open。JSON Pointer 相对于解析后的单个 YAML 文档，不是本页维护的配置。

1. **覆盖与 scope** — `decision.i0-baseline-coverage`，note `I0BaselineCoverageDesignProposal`，[真源文件](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-baseline-coverage-design-proposal-0.yaml)。
   - 完整设计 body：`/payload/info/artifact/body`。
   - business/product/technical coverage、design/evidence/gap/owner/ref/后续 iteration：`/payload/info/artifact/body/coverageRows`。
   - required/deferred/excluded scope 与未裁决事项：`/payload/info/artifact/body/scopeDecisions`。scope、design 状态与 evidence 层级必须分别读取；required 不等于政策获准或行为已实现。
2. **边界与公共扩展** — `decision.i0-boundary-ownership`，note `I0BoundaryOwnershipDesignProposal`，[真源文件](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-i0-boundary-ownership-design-proposal-1.yaml)。
   - repo/layer/owner：`/payload/info/artifact/body/ownershipRows`。
   - 工具保留/回流/暂停处置：`/payload/info/artifact/body/toolDisposition`。
   - X01–X10：`/payload/info/artifact/body/publicExtensions`；逐项导航见 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md)。
3. **第一现金付款纵切** — `decision.cash-first-slice-design`，note `CashFirstSliceDesignProposal`，[真源文件](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-cash-first-slice-design-proposal-2.yaml)。
   - 五要素：`/payload/info/artifact/body/productPlanes`。
   - 技术需要：`/payload/info/artifact/body/technicalNeeds`。
   - 真实验收义务：`/payload/info/artifact/body/acceptanceObligations`；与已有契约的阅读关系见 [CASH-FIRST-SLICE.md](CASH-FIRST-SLICE.md)。

本页不复制覆盖矩阵、scope 决策表或新的政策值。修改设计在对应真源 note 中进行；文档仅同步 ID、路径、pointer 与流程导航。源码 hash 是快照证据，不是 definition/semantics 认证；不把机器 hash、时间或 compiled manifest 写成业务事实。

## 本轮边界

- 银行业务断言、具体绑定与模拟留在 demo；通用能力通过有 owner 的公共工作包回流，不补本仓银行专用生成/宿主兼容 shim。本次没有公共 EP 或公共扩展实现，也没有跨仓代码变更。
- 基金公司/TA 模拟已获允许；真实外部银行能力未确定，银行 mock 未获授权。账户 setup/归属/募集、内部转账、持仓、SIP clock/occurrence/counters 和 batch scope 的状态以 `scopeDecisions` 为准，不能把候选或 open 政策写成决定。
- 既有 source、aggregate/slice/VO、Saga/Pipeline、根/补充 bindings 与历史 receipts 不在本轮设计重写范围；原保护 13 文件及第二批授权 4 文件仍分别检查，不能倒写历史 hash。
- 暂停第三批按原路径/字节保留：`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`、`qualification/fund-order-cash/`。不修、不移、不删，也不执行 qualifier。冻结保留不是接受其设计或证明银行宿主可运行。
- 本次不生成 Scala/应用、不构建或启动服务、不提交/推送；没有 machine-authority 执法、真实资金运行、恢复、回锚或独立审计完成声明。

## 证据位置与测试选择

历史 [I0-VERIFICATION.json](I0-VERIFICATION.json) 是 I0 当时源/设计提议范围回执，包含当时执行命令、计数、输入快照及排除项，原字节保留。它不能覆盖当前三项设计选择、公共拆包或新增测试/文档；当前证据以 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json) 为准。两者均不认证完整设计、公共实现或真实行为。

历史输入/回执保留在 [BASELINE.json](BASELINE.json)、[VERIFICATION.json](VERIFICATION.json)、[SECOND-BATCH-INCREMENT.json](SECOND-BATCH-INCREMENT.json) 与 [SECOND-BATCH-VERIFICATION.json](SECOND-BATCH-VERIFICATION.json)。第二批的 131 YAML、186 tests、9 projections、27 artifacts 仅描述其历史快照，不覆盖新 I0 notes、后续修改或暂停第三批。

```bash
npm run test:baseline  # truth/projections/cash-contract/mock-ta 四个显式文件
npm run test:design    # 仅 test/i0-design.test.mjs
npm test              # 四个 baseline + I0 design
npm run verify        # 现有结构/语义/lowering/往返/投影门
```

命令列举不表示已执行。`test/domain-runner.test.mjs` 是 **excluded paused suite**，未被默认选择，不是 executed skip；选定测试报告 0 skipped 不能称全仓资格通过。后续测试必须显式登记到 `package.json` 的相应脚本，不恢复 wildcard 或 `test:all` 自动纳入暂停草稿。

当前回执须按实际选择、结果、排除范围与未执行项记录，并区分结构/语义、lowered-contract-only、往返、知识投影与真实行为证据；历史 receipts 不重写。后续联合路径见 [HANDOFF.md](HANDOFF.md)，当前与历史状态见 [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md)。
