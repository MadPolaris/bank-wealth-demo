# P23 银行业务权威交接

> **P23 后续实际输入交付：** [完整现有合同的正式公共输入](FORMAL-CONTRACT-INPUTS-HANDOFF.md)已通过三个语义产品准入及真实 CLI，新增正负门25/25、P23回归109/109。四流新应用输入仍未齐备；源根投影最小诊断另列，旧P23状态/回执不改。本次消费已结束，不要求公共持续freeze。

> **当前整阶段结论：P23 四包已通过。** 见 [P23 收口与接续](P23-CLOSEOUT.md)和 [P23 汇总验收回执](P23-ACCEPTANCE.json)。这是合同、政策、消费与制品基线通过，不是银行资金/恢复或完整 V1 已交付。以下各轮记录保留为历史，以此新汇总确定当前状态。

> **P23-3 当前状态：runtime 制品已核收通过。** 见 [银行核收交接](P23-3-RUNTIME-HANDOFF.md)、[锁定清单](P23-RUNTIME-LOCK.json)和 [P23-3 回执](P23-3-RUNTIME-ACCEPTANCE.json)。固定版本 `0.2.1-p23.20261027.1`，银行空缓存 file 仓消费 5/5；旧回执的 runtime `blocked` 仅代表当时状态，不再是当前阻塞。

> **当前修订入口：** [P23 design-2 六项修复交接](P23-DESIGN-2-HANDOFF.md)及 [新机器回执](P23-DESIGN-2-VERIFICATION.json)。唯一真源已修订为 `bank-v1-p23-design-2`；下方全文是 design-1 消费结束时的历史记录，原测试数、未提交说明和六项 open 状态不代表新修订。旧回执与窗口归还通知未被改写。

最后更新: 2026-10-27

## 最终汇总：结束本轮消费，不等于全部合同验收通过

本次按用户转达的 `complete-generated-file-anchors` 收尾要求，仅汇总当前字节证据并归还本银行会话已经结束的消费窗口；没有新增设计、修改合同/测试或重复运行已关联的门。

- 当前字节实测：`test:p23` **70/70**、`test:v1-contract` **450/450**、默认六文件 **285/285**；源验证、141原子往返、9投影对账通过，原16条notice保留。
- **上述门通过不表示合同没有缺口。** 迟到复核及主会话核对保留6项：SIP失败证据需限定付款阶段、暂停中backlog不得新启动、晚到非终态不得回退期次进度、重复退款完成oracle缺刺激、TA受理样例误用确认正文、4个not-run状态的测试断言不完整。详见 [REVIEW-FINDINGS.json](../.scratch/p23-bank-handoff-pxzkgeyq/REVIEW-FINDINGS.json)。本轮未修，仍归银行P23原合同包，不增milestone。
- 总体独立复核被停止，未返回完整签字；仅收到一份迟到的SIP局部复核。不能称“独立复核通过”或“银行设计无未决问题”。当前四类输入可作为公共需求/反例来源，**不可作为无缺陷的最终业务oracle认证**。
- 源码消费状态与合同问题、runtime制品门独立。本银行会话不再占用稳定公共工作树作测试/读取；实际归还通知见下文，后续修正需以新字节和新消费约定复验。整体P23保持未通过。

职责再次明确：`complete-generated-file-anchors` 负责公共版本化合同、strict语义产品、typed metadata、BC/JS producer/plan/有限宿主生成及通用回锚。本会话负责银行描述、现有bindings、具体业务端口与业务验收；公共侧先给正式格式，银行再补对应具体binding，不要求银行预先发明尚未定义的公共格式。共享窗口是约束，不另建源码副本绕过它。

## 1. 唯一当前输入

- 仓库：`bank-wealth-demo`，branch `feature/bank-wealth-truth-preview`，基于 `dda2f24` 的已有工作树；本轮未提交。**当前输入身份以新回执逐文件SHA为准，不以HEAD冒充包含本轮未提交文件。**
- 源：[P23BankV1HandoffContract](../tree/inbox/refining/question-rf-p23-bank-v1-handoff-contract-0.yaml)。
- Artifact：`decision.p23-bank-v1-handoff`；业务设计版本：`bank-v1-p23-design-1`。
- 外层仍是 `demo-proposal`，已选部分在body标 `selected-demo-design`；原政策/原子/六份bindings未被重写。新overlay通过明确来源和supersession生效，不使旧记录的历史open自动变成错误。
- 共同公共设计：[P24/P25 DESIGN.md](../../metarch-truthsrc/.rounds/p24-p25-v1-design-q5bnn0o8/DESIGN.md)及配套矩阵，原样沿用。公共接口、BC/JS实施写面与兼容接续由工具链会话准备；本交接不重复设计、不解冻公共源码。

以下JSON Pointer均相对于新源原子的解析文档：

| 交付 | Pointer |
|---|---|
| 已选政策正式来源/覆盖关系 | `/payload/info/artifact/body/inheritedDecisions`、`/payload/info/artifact/body/resolutions` |
| V1必交/非目标子范围 | `/payload/info/artifact/body/coverageRows` |
| 既定十里程碑、40验收包和oracle索引 | `/payload/info/artifact/body/milestones`、`/payload/info/artifact/body/acceptancePackages` |
| 付款 | `/payload/info/artifact/body/flows/0` |
| TA | `/payload/info/artifact/body/flows/1` |
| 独立退款 | `/payload/info/artifact/body/flows/2` |
| 定投 | `/payload/info/artifact/body/flows/3` |
| 30个正负场景与未执行业务oracle | `/payload/info/artifact/body/scenarios` |
| 代表性数据（非定价公式/真实资金） | `/payload/info/artifact/body/representativeFixture` |
| 六份现有binding文件索引 | `/payload/info/artifact/body/bindingInventory` |
| 页面/API/机器权限/手写边界及已选技术基线引用 | `/payload/info/artifact/body/productAndTechnicalScope` |
| 尚未执行/认证的能力 | `/payload/info/artifact/body/readiness` |

## 2. 版本与binding状态

真实版本及精确文件/行内JSON Pointer由每个flow的 `existingDeclarations` 和 `bindings` 定义；此处只提供阅读说明，不维护第二套可编辑绑定。

- **付款**：现有 cash-purchase-v2请求、`fund-purchase-payment-v2` Saga定义`v2`、cash pipeline `plan-v2`；static/runtime/execution三个binding引用及codec版本均对原文件逐项核对。
- **退款**：现有`fund-purchase-refund` Saga定义`v1`，独立cash refund pipeline `plan-v2`。可信服务唯一intent政策已正式引用，但SYSTEM_INJECTED refundTxId到公共typed port/权威pipeline身份的实现仍未完成。
- **TA**：现有submission/accepted/confirmed/rejected/unknown声明和MockTA配置可定位；技术bridge绑定仍是requirements，不冒已有公共schema或真实发送者认证。
- **定投**：V1有限本地现金计划的输入/配置/期次状态/事件/guard/fold义务和oracle已在新设计中描述。原`SipPlan`及`sip-installment-execution`外部链仍为legacy，**没有迁移、没有新增伪可执行binding或scenario schema**。

业务版本、binding schema、Saga definition、pipeline plan、args/result codec、runtimeVersion是不同身份，不能只写一个“v1”代替。公共旧sourceGates通过也不认证新overlay中的V1 SIP/TA要求已具备生成运行能力。

## 3. 验收证据入口

最终当前回执：[P23-VERIFICATION.json](P23-VERIFICATION.json)。本轮详细日志/基线/原失败/新结果位于：

`.scratch/p23-bank-handoff-pxzkgeyq/`

脚本：

```sh
npm run test:p23          # 仅新增P23设计合同及mutation tests
npm run test:v1-contract  # 原七文件 + P23，显式选择；不含暂停runner
npm test                 # 保留历史默认六文件，不代替新增合同门
npm run verify           # 当前结构/旧与现金strict源门/往返/派生投影
```

**只有最终回执记录的实际执行才算通过。** tests验证声明、来源、版本、业务oracle与安全边界，不运行另造资金状态机。所有30个业务scenario仍 `execution:not-run`；真实actor/HTTP/余额/TA/退款/定投/JVM恢复分别留后续业务纵切。

开工基线曾为379/380：唯一失败是旧派生`index.json`的`toolDigest`与固定公共版本不一致，业务sourceDigest及其余内容相同。已保存失败log和 `baseline-projection-diff.json`，用原`project`工具刷新后基线380/380及verify通过。没有改旧测试、公共工具或历史回执来消除失败。

## 4. 三个独立状态

### A. 银行源／设计合同

以本轮回执 `bankSourceDesign` 及逐门结果为准。当前为 **`tests-passed-review-gaps-open`**：权威输入、四flow、版本/binding引用和正负场景已交出，但6项合同/测试缺口未修，不能标无阻塞的设计总验收通过；更不是完整V1业务或所有公共产品已准入。

### B. 本会话源码消费窗口

准确通知：`.scratch/p23-bank-handoff-pxzkgeyq/SOURCE-CONSUMPTION-WINDOW-RETURN.json`。

**仅当该新文件实际存在并记录 `returned-by-bank-consumer` 时，才表示本银行P23会话的当前源码消费已结束并归还。** 通知引用固定公共 `b621ac0` 与原676文件清单、当前验收回执，明确无本会话在途tests/编译/生成/读取；它不代其他consumer释放窗口，不修改公共方旧HANDOFF/ACK，也不是公共实施授权。

若整体制品门仍blocked，不因此默认延长已结束的银行源码消费。工具链可据归还通知核对其余owner及下一写面批准，不能只据本页或旧ACK推断解冻。

### C. P23整体制品门

独立保留：Saga/Monarch候选同源性、POM、许可、直接及传递依赖、干净目录消费证明。历史定位为 `backkend-codegen/.rounds/p23-finish-contract-main-20261027/preflight.json` 的 `candidateSha256`／`candidateDeliveryClosure`；本轮未重建、认证或发布这些制品。

**源/设计通过、窗口归还均不能将该门改成通过。** 最终回执保持 `completeP23:false`，直到对应owner提交实际制品证据。

## 5. 下一次工具链接续

消费上述四flow及scenario原指针，结合公共已对齐矩阵准备P24/P25接口、BC/JS精确写面和兼容门。发现表达/绑定缺口时回到明确source ref与最小反例，不要求银行迁就Fab模板，不在银行新增normalizer/generator/host shim。

本轮没有应用/Scala生成、服务生命周期、runtime源码或公共源码修改；没有commit/push。暂停`qualification/`、`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`及所有旧失败/历史回执保持。
