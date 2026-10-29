# P23 design-2：六项合同缺口修复交接

最后更新: 2026-10-27

## 当前输入与修订范围

- 银行基线提交：`5bf91e0eb6fc841c571a4c459f0ad9411b150c95`，分支 `feature/bank-wealth-truth-preview`。本修订为该提交后的工作树增量，未自动提交或推送；当前字节以本版回执及清单为准。
- 唯一权威输入：[P23BankV1HandoffContract](../tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)，artifact `decision.p23-bank-v1-handoff`。
- `bank-v1-p23-design-2` 显式承接 `bank-v1-p23-design-1`。只修已记录的 P23-R01–R06，不改已选政策、不增加里程碑。仍为四个 flow、30 个未执行设计场景、23 条覆盖项、P23–P32 的 40 个验收包。
- 四个 flow 的正文、版本与 bindings 入口仍为 `/payload/info/artifact/body/flows/0` 至 `/3`；所有场景在 `/payload/info/artifact/body/scenarios`。六份 binding 原文件、旧业务原子、runtime、公共工具源码和暂停资格草稿均不在本次写面。

## 六项修复

下列 Pointer 以 `/payload/info/artifact/body` 为共同前缀；首项显示完整路径，其余简写相对该 body。场景按同一 body 的 `scenarios` 内唯一 ID 定位。政策只在真源维护，本页是变更导航。

| 问题 | 修复入口 | 合同与负例要点 |
|---|---|---|
| P23-R01 | `/payload/info/artifact/body/resolutions/4/details`、`/flows/3/completion`、`/flows/3/lifecycle`、场景 `SIP-no-effects-failure` / `SIP-refund-count-boundary` | 无效果失败仅指关联原付款；退款拒绝、补偿和 UNKNOWN 不证明本金已退回。退款拒绝/补偿是独立负分支，不伪造为同一已终结 Saga 又恢复成功。 |
| P23-R02 | `/payload/info/artifact/body/flows/3/guardObligations`、场景 `SIP-pause-backlog` | tick16 在 pause15/resume25 之间重触发 backlog，必须零新现金请求；resume 后才创建原 revision 请求，in-flight 不被改写。 |
| P23-R03 | `/payload/info/artifact/body/flows/3/eventObligations`、`/foldObligations`、场景 `SIP-late-terminal` | 可信终态之后晚到 UNKNOWN 不仅不计数，还不得回退 occurrenceProgress 或重新打开 recovery。 |
| P23-R04 | 场景 `SIP-refund-count-boundary` | 首次 failed terminal 后实际重投同身份、同证据的退款完成；零增量 oracle 以 `afterStep` 关联该投递。 |
| P23-R05 | 场景 `TA-accepted-only` | accepted 专用投递身份与一致的示意正文；正向观察关联的 `FundTAAccepted`、`TA_ACCEPTED` 状态，同时仍 pending 且无确认份额。示意正文不是完整 MockTA receipt 或新公共 codec schema。 |
| P23-R06 | `/payload/info/artifact/body/readiness`、[P23测试](../test/p23-finish-contract.test.mjs) | 精确检查四个 `not-run` 字符串；每个字段分别覆盖冒升和缺失。 |

`afterStep` 是银行设计 oracle 的关联字段；测试核验其确实存在于同一场景的 sequence。它不是新公共运行语法，不执行这些场景。

## 新证据与历史

- 本版机器回执：[P23-DESIGN-2-VERIFICATION.json](P23-DESIGN-2-VERIFICATION.json)。**只有其中实际执行、且与当前字节一致的门才算通过**；不得将 design-1 的 70/450/285 直接套用到本版。
- 原始命令日志、红绿门及逐文件清单：`.scratch/p23-repair-design2-zpcoj_ho/`。该目录是本地证据，不随 Git 提交；机器回执另嵌入当前测试摘要、源/工具清单与缺口处理结果。
- 旧 [P23-VERIFICATION.json](P23-VERIFICATION.json)、旧缺口记录、旧红测、旧归还通知保持原字节。它们准确描述 design-1 当时的状态，不倒写为本轮成功。
- 旧版源码可从提交 `5bf91e0` 取得；[原交接页](P23-BUSINESS-HANDOFF.md)页首只追加本版导航，下方历史正文保留。

验证仍使用现有脚本：

```sh
npm run test:p23
node tools/project.mjs --write
npm run test:v1-contract
npm test
npm run verify
```

本轮先保留两组预期红测，再修复正文与断言。真实最终计数、命令、退出码、日志 SHA 和测试前后无漂移检查见新回执。不启动应用、Scala 编译、服务或新的银行执行引擎。

## 三个独立状态

1. **本轮六项修复**：以新回执逐项结果为准，只证明源合同与回归断言闭合；不是对所有银行业务的独立审计签字。
2. **公共源码消费**：此前 design-1 窗口已归还，通知 `.scratch/p23-bank-handoff-pxzkgeyq/SOURCE-CONSUMPTION-WINDOW-RETURN.json` 不变。本轮只采用有限命令的只读消费及前后字节核验，不重新申请长期冻结，不代其他消费者释放锁。完成记录另写本轮目录的 `CONSUMPTION-FINISHED.json`；有漂移的结果不得发布为通过。
3. **完整 P23 与 V1**：runtime 制品来源、POM/许可、直接/传递依赖、独立干净消费仍为 blocked，未重新认证。公共语义准入、V1 SIP 可执行声明/TA 具体技术绑定、应用生成、资金运行、JVM 恢复及完整回锚均未由本轮证明；`completeP23` 仍 false。

本会话继续负责银行样例。`complete-generated-file-anchors` 负责公共版本化接口、typed metadata、BC/JS producer/plan 与有限宿主生成；仍沿用既有 P24/P25 共同设计。公共层先提供正式可消费格式，银行再补对应具体绑定，不在银行创建工具链 shim，也不重做总体设计。
