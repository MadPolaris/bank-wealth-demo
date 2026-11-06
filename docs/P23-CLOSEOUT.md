# P23 阶段收口与接续

最后更新: 2026-10-27

## 当前结论

**P23「完成合同、政策、消费与制品边界」按既定四包退出条件通过。** 机器结论见 [P23-ACCEPTANCE.json](P23-ACCEPTANCE.json)。这关闭的是 V1 的准备阶段，不是整个银行 demo 交付，也不代表业务资金、生成应用或恢复已通过。

| 包 | 退出条件 | 已核证据 |
|---|---|---|
| P23-1 完成合同覆盖 | 23 条覆盖、40 包，required 无孤项 | design-2 唯一真源及 P23 109/109；四 flow、30 个未执行场景与 package 引用完整；六项已知缺口已关闭 |
| P23-2 已选政策正式引用 | 既定选择有来源和显式 supersession | 三项继承、十项 resolution 的引用与已选状态已检验，没有重新决策 |
| P23-3 公共消费与 runtime 制品 | 源码消费认证和 runtime 来源／依赖／许可各有回执 | design-2 源门和已结束消费；三库版本锁；供给认证与银行空缓存仅 file 仓消费5/5、依赖图一致 |
| P23-4 可实施库存与目标边界 | 技术栈、页面、机器权限、手写边界及后续缺项明确 | 真源 `productAndTechnicalScope`、栈决议、四 flow 版本/bindings/pendingRequirements；未把后续 SIP/TA 技术要求伪装为现有可执行 binding |

完整独立审计签字未出具，不将 P23 源/设计验收描述成“已经证明没有任何业务缺陷”。当前四包的退出条件并不要求 P24/P25 已实现或银行运行已通过；因此不新增审批、微里程碑或隐含资格门延长 P23。

## 固定的接续输入

- [唯一银行真源](https://github.com/MadPolaris/bank-wealth-demo/blob/675a9366cf270995ef714e505e42c19652f0e4f0/tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)：artifact `decision.p23-bank-v1-handoff`，`bank-v1-p23-design-2`。
- [design-2 回执](P23-DESIGN-2-VERIFICATION.json)：P23 **109/109**、V1合同 **489/489**、默认 **285/285**，141原子往返、9投影通过。这里只重新核对原回执与当前源字节，没有重跑或把旧结果冒称新测试。
- [运行库锁定清单](P23-RUNTIME-LOCK.json)：三库 `0.2.1-p23.20261027.1`，明确 file Maven resolver、commit、JAR/POM SHA。
- [银行 P23-3 回执](P23-3-RUNTIME-ACCEPTANCE.json)及[制品核收说明](P23-3-RUNTIME-HANDOFF.md)：已核收，不再 blocked。
- 银行基线提交仍为 `5bf91e0` 加当前未提交增量；本次没有 commit/push。消费者按新回执的逐文件指纹取输入，不能把 HEAD 当成包含未提交修订。

## 接续顺序与职责

1. **公共工具链继续 P24/P25**：使用既有共同设计和银行四 flow／30场景，不重做总体设计。当前已读的公共阶段交接为 BC `15205652` 的 typed消费部分实现；其 `reference-layout@1`、`domain-decision@1` 及手写fixture不是完整 JS compiler 产品，更不是完整银行生成能力。新产品应由公共 owner 给出准确输入合同、支持范围及回执。
2. **银行按正式合同补具体 bindings／ports**：从上述四 flow 的 `pendingRequirements` 逐项对接；不提前发明未定义的公共格式，不在银行写 compiler/normalizer/generator/host shim，也不接管公共源码。
3. **进入可运行纵切**：P25 生成应用具备正式输入与有限宿主后，依既定 P26–P30 完成可信账户、付款、MockTA、独立退款、定投；P31/P32 完成恢复、真实读侧、回锚及可复现交付。运行库版本使用本次锁定值，应用新增依赖后须核自己的解析图，不沿用最小consumer图冒充完整应用验收。

上述是原路线的接续，不新增 milestone。公共部分成果可按准确能力边界先交接验证，不要求银行静等全部功能；但未实现的接口不能被银行自制替代层绕过。

## 窗口与历史解释

- design-1 的正式归还文件：`.scratch/p23-bank-handoff-pxzkgeyq/SOURCE-CONSUMPTION-WINDOW-RETURN.json`。
- design-2 的有限消费完成文件：`.scratch/p23-repair-design2-zpcoj_ho/CONSUMPTION-FINISHED.json`。
- 本轮制品消费者已经结束；未启动公共compiler、未申请新的公共源码稳定窗口。**本银行会话没有需要继续保留的 P23 源码消费要求**；不代其他owner/进程释放锁，不授予公共实施写权。
- 旧 `P23-VERIFICATION.json`、`P23-DESIGN-2-VERIFICATION.json`、`P23-3-RUNTIME-ACCEPTANCE.json` 的 `completeP23:false` 分别是出具当时的状态或单包结论，保持原字节。当前整阶段结论由新 [P23-ACCEPTANCE.json](P23-ACCEPTANCE.json) 汇总，不倒写历史。
- 真源 readiness 是设计记录，不承载可变运行证书；不用修改已测试真源中的历史 blocked/false 字段来表达树外验收状态，也不由此伪造生成/资金能力。

Akka eviction、SLF4J NOP、有限离线工具链和许可材料审查边界继续保留。它们是后续应用集成必须处理的真实边界，不将制品门重新标回 blocked，也不声称 Mongo/JDBC 集成已通过。
