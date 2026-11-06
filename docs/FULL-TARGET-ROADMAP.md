# 全目标缺口路线图：真源与阶段导航

## 当前 P23 追加覆盖层

最后更新: 2026-10-27。当前V1选择与业务交接位于 [P23BankV1HandoffContract](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)，artifact `decision.p23-bank-v1-handoff`、设计版本 `bank-v1-p23-design-1`。入口指针均相对原子：`/payload/info/artifact/body/resolutions`（已选政策正式引用）、`coverageRows`（23行及子范围）、`milestones`／`acceptancePackages`（既定P23–P32十里程碑/40包）、`flows`／`scenarios`（四类业务和30个未运行oracle）。

本页以下“唯一设计权威”、R0–R8、八项open与未选栈描述保留为上一版历史；新overlay通过显式来源与supersession承接已选内容，不倒写旧note。当前状态和源码消费归还见 [P23交接](P23-BUSINESS-HANDOFF.md)；源/设计门通过不等于runtime制品、完整P23或V1运行通过。

## 唯一设计权威

`decision.full-target-gap-roadmap` — [FullTargetGapRoadmapProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-full-target-gap-roadmap-proposal-0.yaml)，board `wealth-roadmap-v1`、refining seq0。以下只提供 pointer／边界导航，不维护第二份业务、政策或阶段规格。

- 全部 23 项及业务／产品／技术原来源：`/payload/info/artifact/body/coverageRows`。
- bounded 完成目标和条件／延期／排除范围：`/payload/info/artifact/body/boundedCompletion`。
- R0–R8 依赖、owner、产物和未来退出证据：`/payload/info/artifact/body/phases`。
- X01–X10 依赖和已有规格入口：`/payload/info/artifact/body/publicExtensions`。
- 仅原三项 selected-demo-design：`/payload/info/artifact/body/selectedDesignDecisions`。权威选择仍是 [CashPrerequisiteDecisionOverlay](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-cash-prerequisite-decision-overlay-0.yaml)，不倒写 I0。
- 八项 open 的裁决时点、S10 未选候选评审、退款／SIP 补充决定：`/payload/info/artifact/body/openDecisionSchedule`、`/payload/info/artifact/body/consumerStackReview`、`/payload/info/artifact/body/supplementalDecisions`。
- 五要素、12 needs、15 obligations 完整映射：`/payload/info/artifact/body/productPlaneCoverage`、`/payload/info/artifact/body/technicalNeedCoverage`、`/payload/info/artifact/body/cashAcceptanceCoverage`。
- seed 防重、MockTA unknown 进展、cancel 读侧、SIP 终态的未验收门：`/payload/info/artifact/body/criticalGates`。
- 五层证据／公共复用／后续实际实施入口：`/payload/info/artifact/body/evidencePolicy`、`/payload/info/artifact/body/reuseAndFeedback`、`/payload/info/artifact/body/immediateIncrement`。

## 公共交接，不是实现授权

- `decision.public-x03-work-packages` — [PublicX03WorkPackagesProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-public-x03-work-packages-proposal-1.yaml)，`/payload/info/artifact/body/packages`、`/payload/info/artifact/body/upstreamSpecification`。
- `decision.public-x04-work-packages` — [PublicX04WorkPackagesProposal](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-public-x04-work-packages-proposal-2.yaml)，`/payload/info/artifact/body/packages`、`/payload/info/artifact/body/upstreamSpecification`。

每份四个未来子包。精确 API／产品、目标端口、existing/proposed 文件分配、两域测试／fixture、P19 重叠、迁移／兼容与分层门在真源中；最终名字仍须公共 owner 审批。X01／X02 旧八包及历史真源原字节保留，详见 [PUBLIC-EXTENSIONS.md](PUBLIC-EXTENSIONS.md)。公共现有 apply／anchors 和局部 Fab 恢复成果只作为限定复用依据，不认证银行；P19已观察到限定Money Prepare／actor ACK-loss回执，不能升级为X03完整值转换或银行资格。

## 本轮边界与下一交付

本轮只落盘路线 proposal、X03／X04 proposal、银行设计测试、导航和新回执。八项政策、退款入口和 SIP 资金路径仍 open，S10 目标／栈未选择；required SIP 不移出完整目标。付款成功不是最终申购成功，UNKNOWN 不授权新资金效果，外部银行 mock 未授权。

后续具体实施沿真源 `immediateIncrement` 和各包独立 owner 授权推进，不能连续以 proposal 数量冒充运行完成。银行业务政策／具体 bindings／真实业务 manual ports 留银行；公共能力不靠银行 normalizer、generator、host 或 qualification 兼容 shim 绕过。

## 实测入口与历史分离

本轮源／设计证据：[ROADMAP-DESIGN-VERIFICATION.json](ROADMAP-DESIGN-VERIFICATION.json)。原 [CASH-NEXT-DESIGN-VERIFICATION.json](CASH-NEXT-DESIGN-VERIFICATION.json)、I0 与第二批回执保持历史原字节；旧测试通过不能认证新增路线或完整运行。

经用户明确选择，保留旧测试和默认 `npm test` 六显式文件不变。新增：

```bash
npm run test:roadmap  # 仅 test/roadmap-design.test.mjs
npm run test:current  # 旧六文件＋roadmap，第七文件显式登记
```

脚本列出不表示已运行；实测以本轮新回执为准。`test/domain-runner.test.mjs` 为 excluded paused suite，不是 executed skip；暂停 qualifier／qualification 原路径／字节保持。源、设计、公共生成、组件行为、进程业务集成分别验收，本轮不生成／构建／起服／运行资金／提交／推送，也不宣称独立审计。
