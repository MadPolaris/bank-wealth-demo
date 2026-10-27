# 第二批检查点：本地范围验收完成

日期：2026-10-25。本检查点取代压缩前的待办清单；不要重做已有实现。完成的是 **真源声明、局部语义验证、知识投影与独立MockTA行为**，不是资金应用/生成/恢复/回锚闭环。

## 当前状态与边界

- 分支 `feature/bank-wealth-truth-preview`，首批HEAD `dda2f24`。
- 第二批全部仍未提交；不得擅自提交或推送。
- 写入仅 `bank-wealth-demo/`。Saga/Monarch、JS/BC工具及共享生成应用只读，未启动共享服务。
- 用户允许基金公司/TA模拟，不包含外部银行mock。
- 原BASELINE与首批VERIFICATION保留；原13个保护文件字节未变，4个新Saga/Pipeline列于增量清单。

## 已交付

1. cash-v2独立请求；三参与者投资人outgoing→募集incoming→订单TCC，订单最后commit；反向原账户/原本金的新退款Saga。
2. 新现金Saga/Pipeline和独立补充绑定，内存合并、原副本一致性、strict/lowering检查。
3. 付款专用五kind结果/current与terminal账本，修复未知/待恢复先到导致成功永久阻断；旧结果切片未改。
4. `CancelCashFundSubscription` / `FundCashSubscriptionCanceled`：未Prepare也能空释放＋持久栅栏，latePrepare拒绝；旧取消接口不改。
5. TA提交/受理/确认/拒绝/未知、exact body回执关联，退款申请与五kind结果、final/receipt-kind冲突声明。
6. 完整guard顺序/完整fold集、生产关系、typedslots、FundShare字段、TA生命周期、退款操作/结果保留与Mock唯一配置检查。负例拒绝附加短路/矛盾写入/遗漏依赖fold。
7. 独立MockTA从真源配置驱动七场景，手控clock，规范JSONL/hashchain，完整写与fsync-before-ack，reopen验证后fsync、单writer自有锁、部分锁回滚、close重试/主错误保留、livepath/lock顺序变化检查。
8. 原输入在克隆前校验，array不调用继承方法/accessor，BOM拒绝；CLI支持双横线ID等号值；故障注入覆盖。
9. 明确资源边界：字符串4096 UTF-8字节、日志16 MiB；超限拒绝，不丢记录。hashchain不检测完整合法前缀rollback，O_EXCL不是内核fencing，不抢占崩溃残锁，不支持活跃rotation。
10. `ux.cash-v2` / `flow.cash-v2`独立体验与图；五个旧提议标legacy；9个图/JSON派生文件与实测文档。

## 最终实测

- 全量 `npm test`：186/186，0fail/skip（108cash、47MockTA、8投影、23truth/binding）。
- `npm run verify`：131YAML精确canonical/path/byte往返，结构hard0/16notice，局部声明/提议/cash门errors0，27artifacts/200entities。
- 四Saga/四Pipeline strict与runtime-v3 lowering diagnostics空；lowered-contract-only，runnable:false，runtimeBindingVerified:false。
- 9投影一致；13旧保护＋4授权新增；git diff --check通过。
- 最后跨五进程CLI：`.scratch/cli-observation-CvYAji/observation.json`，accepted→tick1→confirmed；两独立receiptId/同taReference，重复submit同response、日志3条，仅模拟器恢复。
- 机器回执：`docs/SECOND-BATCH-VERIFICATION.json`，含源/工具/本地代码hash及验收边界。
- 独立复核提供的具体发现已经本地修复/回归；复核agents后因额度错误/停止，**没有最终独立签字**。不能宣称完成独立安全审计。

## 后续工作（不属于本次已验收范围）

- mixedguard生成保序、FundOrder marker适配、银行财富通用宿主及默认初态。
- 付款/TA/refund可信持久bridge、exact typed codec、真正账户效果与关联回执、同身份reconciliation。
- source-event/pipeline稳定身份等价、唯一startowner、handler-computed refundTxId。
- cash-v2排除legacyTA捷径，退款恢复不能单靠collection旧write-once账本。
- 真实read-model chronology/watermark、查询/UI/无障碍、完整SIP/外部银行/生产金融规则。
- 应用生成构建、实际业务/JVM恢复、源码认证、一对多代码回锚。

详见 `docs/HANDOFF.md`。未来继续应推进联合生成/运行验收，不重复当前真源/Mock工作，不将demo-proposal自动升级为已批准产品需求。
