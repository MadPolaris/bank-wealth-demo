# 银行 V1 原 P26–P32 成果级验收证据矩阵

最后更新：2026-11-02

## 范围、编号与判定纪律

- 范围依据已批准 `/Users/zhongdj/.claude/plans/snappy-churning-creek.md`，特别是第 4–7 节，以及 [CONTRACT.md](CONTRACT.md)。保留 **P26(3)／P27(5)／P28(3)／P29(3)／P30(4)／P31(4)／P32(3)，共 25 个原内分项**；不得用滚动 guard、测试数量或局部检查点替代成果关闭。
- 上述正式记录未逐一列出 25 包的精确名称。本表的 `P26-1` 等仅是原阶段内的内容归档序号，要求栏按批准计划和合同整理，不创设新包 ID、正式包名或业务政策，也不凭本表反向认证原包的完整覆盖。
- 正式整包依赖 P26→P27→P28→P29→P30；P31 统一集成，P32 依赖 P31。可以提前实施、积累证据，不能提前计包 pass。**“成果已验”仅说明所注明范围有实际证据；“部分已验”说明仍有具体缺口；二者均不是原包关闭。** `not-run` 与 `blocked` 不冒充失败测试，更不冒充通过。
- 本文是实施／验证清单，**不是第二个领域真源**。业务、产品、技术声明仍由 `v1/tree` 与正式编译链承载；本文不修改领域事实、资金状态机或冻结引擎。
- 下方25行原表是 **853截止的历史核签底稿**，不是当前欠项清单。883八窗、934十六窗以及949稳定再生/文件锚、950合法源增量闭环由后附实测段覆盖；不得继续将这些已验窗口笼统列为not-run。各回执只认证其实际源码窗口。
- 原表最初为只读定位。后续实际构建/恢复/生成/回锚以各实测段与不可覆盖回执为准；不修改或洗绿历史失败。原25包仍未逐包关闭。

## 证据定位与适用范围

以下缩写仅用于定位实际文件，不是新的验收编号：

- `B` = `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo`。
- `E` = `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p26-p32-bank-v1-59o__arv`。
- 所列银行 suite 源码位于 `B/v1/test/scala/<Suite>.scala`。本次从 `E/844-app.stdout.log` 抽取了实际 suite／用例名称与最终结果；BC 对应结果由最终 853 核验记录交叉确认。不是把计划中“拟新增 suite”当成已执行。

实际证据组：

1. **最终应用测试窗口**：`E/844-app.stdout.log`、`E/844-app.json`（JS），`E/845-app.json`（BC）；[BROWSER-RECOVERY.md](BROWSER-RECOVERY.md) 和 `E/BROWSER-RECOVERY-VERIFICATION-853.json` 确认两链 compile／Test compile／全部 tests 各 131/131。数字仅定位运行窗口，不等于关闭 25 包。
2. **真实浏览器与真实数据库**：806–811 通过页面输入／按钮驱动生产 generated Loader／Factory、Mongo journal、MySQL 读侧及可信 MockTA；847／848 为最终源码下真实新 JVM 浏览器重入，849／850 为只读历史查询。`E/BROWSER-CROSS-RUN-817.json` 的 `passed`、完整原请求／订单／期次／账户／精确小数／每 PID 水位比较均为 true。754 的 Chromium 只证明 transport 桩，不能替代这些资金证据。
3. **空 MySQL 清洁重放**：815／816 保留原 Mongo namespace 和 TA journal，接两套新空 MySQL 读库，只经浏览器 GET 查询。`E/REPLAY-VERIFIED-817.json` 的 `cleanReplayExact`、`mongoUnchanged`、`originalProjectionsUnchanged` 为 true；两链各五表逐列／主键排序／blob HEX 比较，35 流、213 事件、2 期次、0 pending，原库与重建库 SHA 相同。不是仅比较余额。
4. **最终关闭与资源退出**：`E/FINAL-LIFECYCLE-851.json` 确认 847–850 的 stderr 为空，Mongo 不变、全部投影字节等 817；852 停止本人数据库，853 记录三容器停止／exit0、无已记录 PID 在途。853 交接为 `E/BROWSER-RECOVERY-HANDOFF-853.md`；其中登记最终核验文件 SHA256 为 `70e6b22b5a091820571123c36e6559f4b8a4cff192361a91780a8048c000bd7b`。
5. **正式生成与公共回归**：[CHECKPOINT-675.md](CHECKPOINT-675.md) 记录 645 准入及 675 双链本地集成；[CHECKPOINT-754.md](CHECKPOINT-754.md) 记录正式 `release-pages-721` 输入、双链应用、BC 1067／JS 2332 公共回归、真源 validate／roundtrip 与独立 schema 反例。853 确认公共生成器源码等 795，交接明确继承 795／754 的同源公共回归，**不是本轮重跑**。

## P26 — 3 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P26-1 | 固定可信 principal／账户／fund 映射及 seed 版本；核原 `AccountInitializedPB` 而非当前余额；相同初始化零写、冲突 fail-closed，竞争／ACK 丢失后重读原事实；客户不能 seed。 | 844 实际执行 `BankSeedAuthoritySpec` 的“seed checks original PB and never credits again after the balance changes”；`BankBalanceStateSpec` 执行真实资金守恒。806–811 及 847／848 的已有资金／重入结果未被再次 seed；817 完整账户跨运行比较通过，最终证据由 853 收录。 | 将原包要求的冲突 seed、竞争／初始化 ACK 丢失与零新增初始化事件逐项关联到具体断言／回执；本次读取的 suite 名称与普通重入不能独自证明这些组合。指定中断后的跨 JVM 证据仍归 P31-1。 | 部分已验；未关闭。 |
| P26-2 | 服务端创建 principal；客户仅闭集 cash DTO，账户归属来自受信配置；精确 Money／Decimal 字符串；未认证、越权、机器字段注入零业务事件；查询先授权，GET 无副作用，页面写动作认证／CSRF／Origin。 | 844 的 `BankRequestHttpSpec`、`BankQueryAuthorizationSpec`、`BankPageRouterSpec`、`BankPagesSpec` 实际覆盖闭集 DTO、身份／角色注入拒绝、查询前授权、GET 不调资金／journal、页面 CSRF／Origin；`BankBalanceStateSpec` 覆盖 38 位 wire／PO／protobuf。754 的 401／403／宽 Long 为独立 transport 负例；806–811 的真实页面走相同生产入站。 | 原验收的未认证／越权／机器注入“零事件”需逐项对应到真实命令边界及持久日志核验，不能把拒绝 dispatch 的单元断言或 transport 桩扩大成全部署资金负例已验。 | 鉴权／解码成果已验，零事件整组仍待核；未关闭。 |
| P26-3 | principal＋clientRequestId 稳定身份，不以正文铸新操作；完整原请求及来源先原子持久，再 ensure／start 唯一现金图；同正文重入、异正文 409；并发、ACK 丢失、持久未 start、重启均保持原身份；集中 PID／装配与启动追平。 | 844 的 `BankApplicationAssemblySpec` 实际覆盖原文先持久、恢复后冲突拒绝；`BankSeedAuthoritySpec` 覆盖无歧义身份；`BankPaymentRecoverySpec` 覆盖 retained source 启动与原请求读取。806–811／847–848 真实 HTTP 页面重入／409，817 比较完整原请求与订单相同。 | 并发提交、原请求耐久后未 start、成功结果耐久但 HTTP ACK 丢失的完整组合及可观测栅栏／跨 JVM 回执；启动发现、追平后写就绪与无第二 writer 的整组证明。当前工具编写不是完成证据。 | 部分已验；未关闭。 |

## P27 — 5 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P27-1 | 真实三 participant 付款，订单 last commit；本金／预留守恒。原 oracle 为 1000.00／0.00，单笔 100.00 后 900.00／100.00，不用技术成功替代业务结果。 | 844 的 `BankPaymentJointSpec` “PAY-success/repeat/conflict” 使用真实 Saga／Monarch／生成 actor，`BankBalanceStateSpec` 使用真实 debit／credit actor 验守恒。真实数据库／浏览器累计现金 100＋两期各 10 后为 880.00／120.00、预留 0，见 806–809、817／853。 | 将三 participant、order-last-commit、单笔 900.00／100.00 的逐 phase PB／Saga 独立预期显式附入原包证据；累计 880／120 不能替代该单笔与提交顺序核证。 | 真实付款与累计守恒已验；原包证据待补齐。 |
| P27-2 | 原 identity、资金参数与原目标不可替换；重复／冲突不二次扣款；保留五 kind 原目标投递及耐久 Monarch checkpoint，结果 ACK 丢失仍同身份交付。 | 844 的 `BankPaymentJointSpec` 实际执行 success／repeat／conflict 与 guarded result delivery；806–811 的重复原请求不二次付款／退款、异正文 409，817 比较原订单／完整请求，847／848 新 JVM 重入相等。 | 五 kind 各自原目标／实际 PB 及 checkpoint 对照、结果已存 ACK 丢失的精确窗口与零第二次资金效果回执。现有普通重入不是完整交付故障矩阵。 | 部分已验；未关闭。 |
| P27-3 | 应用取消 fence、早拒绝、late Prepare 零资金效果；已补偿与未发生资金效果不能误报付款／退款成功。 | 844 的 `BankOrderCancelSpec` 执行原 order 同 PID 恢复及 late order Prepare fence；`BankPaymentJointSpec` 执行 “PAY-early-reject/cancel-before-prepare”、late debit fence 及 rejected-before-effects／compensated 边界；真实 actor，不是字符串模拟。 | 已验 actor 范围可保留；指定跨 JVM 栅栏恢复后的 fence／原身份核证尚欠 P31-1，且 P26 依赖与整包核签未关闭。 | 取消／早拒绝局部成果已验；不提前计包 pass。 |
| P27-4 | Prepare／付款收据 unavailable 时保持 UNKNOWN 与原父流程；授权查询真实 identity 后 reconcile，不铸新现金，不提前终结或重扣。 | 844 的 `BankPaymentJointSpec` “PAY-unknown-recover” 在真实 debit 后隐藏收据并恢复；`BankAutomaticRecoverySpec` 执行 uncertain／completed／foreign 身份准入；`BankPaymentRecoverySpec` 保留原 source。 | 精确 Prepare／收据故障栅栏、旧 JVM 退出 wait 后继任 JVM 自动发现／授权恢复、真实 PB／Saga／Monarch 状态及零重复资金效果；不能以同系统 actor 恢复代替。 | 部分已验；跨 JVM 指定窗口 not-run。 |
| P27-5 | 耐久 commit decision 后必须原 identity forward reconcile，不能重新 Prepare／补偿；Preparing／Committing 中断也可被启动补扫与持续恢复发现。 | 844 的 `BankPaymentJointSpec` “PAY-unknown-recover after durable commit decision” 验同 parent／Saga forward 且无补偿；`BankAutomaticRecoverySpec` 有 interrupted-commit。数据库 787 从旧 UNKNOWN／中断 commit journal 恢复，788 再启新 JVM，见 [DATABASE-INTEGRATION.md](DATABASE-INTEGRATION.md)；853 的普通生产重入继续通过。 | 两链各指定 commit 耐久点的强杀／故障栅栏与前后 PB、decision、checkpoint、资金事件次数核证；旧 UNKNOWN 恢复及普通 restart 不覆盖所有窗口。 | 部分已验；未关闭。 |

## P28 — 3 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P28-1 | TA 仅处理真实已付款订单；关联原 taRequestId／原正文／资源，可信回执精确校验；scenario 来自受信 demo 配置，客户不能 forced result；shares／NAV 保留原文本。 | 844 的 `BankTaApplicationSpec` unpaid／discovery 用例，以及 `BankPaymentJointSpec` TA confirm／repeat／wrong-resource／conflicting-body，实际消费 MockTA 权威回执。806–811 真实生产页面确认 `80.0000` shares／`1.2345` NAV；817 `exactDecimals=true`。 | 已验入站／正文／相关性范围不必重做；register／submit 等耐久间隙的全跨 JVM证据在 P28-3／P31-1，阶段依赖与整包核签仍欠。 | TA 可信边界局部成果已验；不提前计包 pass。 |
| P28-2 | 付款成功、TA accepted、technical effect confirmed 均不等投资成功；只有相关 TAConfirmed 成功，UNKNOWN 保留恢复，可信拒绝才进入退款路径。 | 844 的 `BankTaApplicationSpec` accepted-only／deferred-UNKNOWN，`BankPaymentJointSpec` accepted-only／unknown-confirm；`BankPagesSpec`、`BankBrowserPagesSpec` 保留 payment／TA／refund 分层及 UNKNOWN／水位。真实 806–811 经页面等待 TA 终态；首次缺 tick 的 accepted 未误判成功。 | 本行已验语义保持；尚不能由这些用例宣布全部 TA 中断恢复或 P28 整包通过，相关指定持久窗口仍欠 P28-3／P31-1。 | 可见终态判定成果已验；不提前计包 pass。 |
| P28-3 | MockTA 显式不可变配置，无旧 scratch 硬编码；原 register→submit→accept→ingest 间隙均保同身份；恢复从耐久订单查原 TA，worker／应用重启不重复提交。 | 844 的 `BankTaApplicationSpec` discovery／delayed／deferred-UNKNOWN／close，`BankPaymentJointSpec` 实际 MockTA process close／journal reopen、lost submission response 查询。数据库／浏览器使用新 803 TA journal，847／848 新应用 JVM重入保持原请求；853 保护旧 journal。 | 每个间隙／ACK 丢失组合的观测栅栏与跨 JVM 强杀回执、唯一提交／原 effect checkpoint 逐项对照；现有 worker reopen 与普通应用重启不能合计为全部窗口。 | 部分已验；未关闭。 |

## P29 — 3 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P29-1 | 仅已付款＋相关可信 TARejected 才发唯一独立反向退款 Saga；保留原付款成功；全本金实际返回才完成。早拒绝／补偿／UNKNOWN 不能假作本金已退。 | 844 的 `BankRefundApplicationSpec` success／rejected-before-effects／compensated，`BankPaymentJointSpec` TA-rejected／REFUND-success 及 SIP refund-count-boundary。810／811 真实浏览器拒绝后独立退款，已有两期投资不被退，最终仍 880.00／120.00、预留 0。退款三故障测试成功后为 1000.00／0.00，见 BROWSER-RECOVERY 与 853。 | 已验反向 Saga 与边界保留；退款各持久窗口自动恢复的完整证据归 P29-3／P31-1，阶段依赖与整包核签未关。 | 独立本金退款局部成果已验；不提前计包 pass。 |
| P29-2 | 同原 refund intent／parent／transaction／反向账户与本金，重复／冲突／替换不得二次退款；未知状态仅恢复已有身份，不允许客户端指定退款目的地。 | 844 的 `BankRefundApplicationSpec` success 用例验重复／冲突 resume 不二次退款、UNKNOWN 用例核原 parent；`BankPaymentJointSpec` REFUND repeat／substitute；`BankAutomaticRecoverySpec` refund uncertain／completed／interrupted-commit／foreign。810／811 同 key 重复及异正文 409。 | 退款结果已存但 ACK 丢失、intent 耐久但未装配后的跨 JVM 原身份／原目标／零第二退款证据；现有 DTO 拒绝与普通重复不能替代这些窗口。 | 部分已验；未关闭。 |
| P29-3 | 启动补扫＋持续 loop 从真实 refund PB 发现并自动恢复同身份；募集户 Prepare、募集户 Commit、投资人 Commit 的耐久收据不确定时，业务测试不得手发 Reconcile；补齐 intent／装配／结果间隙。 | 820 为修复前真实反例：新增三例停 RecoveryRequired。844／845 最终 `BankRefundApplicationSpec` 的 automatic-recovery durable prepare／collection-commit／investor-commit 三例通过：隐藏真实收据→终止 actors 并等待→真实 BankRecoveryLoop 自动 resume；唯一 intent／RunStarted、资金事件及 result 各一次，1000.00／0.00。 | **三例是同 ActorSystem testkit，不是跨 JVM／SIGKILL。** 三 phase 指定栅栏跨 JVM、refund intent 后未装配、成功结果已存 ACK 丢失的完整组合尚欠；新增工具尚未通过。 | 同系统自动退款修复已验；指定跨 JVM 矩阵 not-run，未关闭。 |

## P30 — 4 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P30-1 | 完整有限创建意图先持久；受信金额／日程校验，Create／Append／Seal 可重入；恢复仅补原完整 vector 的精确前缀，乱序／重复／越界／冲突 fail-closed，不依赖客户重发或内存日程。 | 844 的 `BankApplicationAssemblySpec`、`BankSipApplicationSpec` create／invalid schedules，`BankSipRecoverySpec` 实际覆盖 intent-only、create-only、各 append prefix、pre-seal、伪造 wire、错序／gap／extra／重复／不完整 sealing；从生成 actor 恢复状态核证。 | 已验各 actor 持久间隙不能升级为不同 JVM；完整创建意图／部分 append 指定跨 JVM 栅栏及最终同源集成回执仍欠 P31-1。 | 完整日程及精确前缀恢复局部成果已验；不提前计包 pass。 |
| P30-2 | tick 单调；revision 只作用未来区间；暂停保 backlog、跳过 paused dues、in-flight 继续，恢复不复活跳期；无首 tick 不虚构墙钟。 | 844 的 `BankSipApplicationSpec` ticks／pause interval／future revision／lower tick preflight／first manual tick，`BankSipStateSpec`、`BankSipRecoverySpec` backlog／revision／pause 恢复。805 首 tick 前 pause 409 是保留的正确规则反例；806 先 tick 后完成真实 pause／resume 与两期。 | 相关精确耐久点的跨 JVM 恢复与原 revision／occurrence 快照核证仍欠；805 失败保留，不能把修改测试顺序写成修改业务政策或原失败已通过。 | 时钟／revision／暂停政策局部成果已验；不提前计包 pass。 |
| P30-3 | occurrence 稳定身份先持久再 dispatch；按序补期、不等前一期 TA；通过原现金入口／原资金参数真正启动 parent，恢复发现来自 journal，不由页面猜。 | 844 的 `BankSipCatchupJointSpec`、`BankSipApplicationSpec` real cash dispatch，`BankSipRecoverySpec` durable pre-dispatch gap／real parents start once／no second debit／unavailable earlier occurrence 不阻后期／conflicting snapshot 拒绝。806–809 与 847／848 真实两期及新 JVM 重入，817 `occurrencesEqual=true`。 | occurrence 耐久后未 dispatch、原 parent 未 start、资金结果耐久未回桥等指定跨 JVM 栅栏、唯一 parent／RunStarted／资金效果完整对照。 | 部分已验；未关闭。 |
| P30-4 | 只核可信相关首 terminal 并计一次；付款／accepted／UNKNOWN／退款未完成不计终态；失败总数不清零，三败不自动暂停；晚到／重复 terminal 零计数。 | 844 的 `BankSipApplicationSpec` correlated confirmation／three genuine failures，`BankSipRecoverySpec` retained terminal 相关性拒绝，`BankSipStateSpec` first-terminal guard；`BankPaymentJointSpec` success／late-terminal／refund noncompletion／no-effects failure。真实浏览器及新 JVM后 successTotal=2、failureTotal=0，817／853 核期次与计数。 | 已验单元／真实成功两期不能覆盖所有故障窗；结果已存／回桥 ACK 丢失及跨 JVM 重放后的首次计数完整证据仍欠 P31-1，整包依赖未关。 | 首可信终态计数局部成果已验；不提前计包 pass。 |

## P31 — 4 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P31-1 | request／payment／TA／refund／SIP 各指定耐久点有可观测故障栅栏；旧 JVM退出并 wait 后新 JVM恢复同 journal，校真实 PB、Saga identity／decision、Monarch checkpoint、零第二资金效果与零重复计数。包括原请求已存未 start、refund intent 已存未装配、结果已存 ACK 丢失。 | 数据库 787–791、浏览器 807／809／847／848 是真实新 JVM普通恢复；817 比较完整业务字段。844／845 的 request／payment／TA／SIP actor 恢复与退款三 phase自动 loop 为局部证据，853 明确不认证 full cross-JVM crash matrix。 | 全部指定持久点的跨 JVM 强杀／故障注入组合与逐窗实际回执。**当前新增跨 JVM 工具正在写、尚未通过；没有可引用的成功执行。** 不以普通 restart 或同 ActorSystem testkit 顶替。 | 核心指定跨 JVM矩阵 not-run；普通重启成果已验，原包未关。 |
| P31-2 | CQRS 从真实日志清洁重放；event／state／index／checkpoint 同事务，按 PID＋seq 去重、冲突拒绝、gap 不跳水位、早到关联可重试；精确 SQL／金额，查询授权；页面区分未知／未追平／不存在／失败，关闭排空后 frontier 失效。 | 844／845 的 `BankReadsideProjectionSpec` 实际覆盖 duplicate／gap／冲突／事务回滚／早到关联／namespace；`BankQueryAuthorizationSpec` 覆盖查询授权；`BankReadsideShutdownSpec`、`BankResourceCleanupSpec` 验排空与失败仍清其余资源。真实 MySQL空库 815／816→817 五表精确重放通过，851 最终全字节／生命周期核验通过。列表无全局 discovery frontier 仍 unknown，单对象按相关 PID 水位表达。 | 清洁重放本身已验，不列为待做。真实 MySQL 下事务失败／重复冲突／乱序早到负例的逐项故障回执尚未在本次材料中核到，不能将 H2 rollback 自动扩称 MySQL 故障矩阵全验；最终统一集成总门仍欠。 | 空 MySQL 重放及最终关闭成果已验；完整 CQRS 包证据仍待核齐。 |
| P31-3 | 同份完整正式输入分别走 BC独立 typed 与 JS公共链；准入反例在写目标前拒绝，非金融 fixture 防硬编码；双链 compile／Test compile／应用测试；相同源另新目录稳定再生，最终同一集成版本总门。 | 645／675 正式 14 产品输入、双链骨架与 ext挂载通过；754 的 `release-pages-721`、公共 BC1067／JS2332、validate／roundtrip、独立 schema反例有记录。844／845 为最终银行外部源码窗口，两链应用全部测试；853确认公共源码可继承795／754，而非声称重跑。 | 最终冻结输入／公共源码／手写 ext 的统一集成回执、相同源新空目标稳定再生及输出对账；不能把旧目标上重新编译的 classes 当成最终 fresh generation。新增代码必须重新纳入实际源码窗口。 | 双链本地生成／测试成果已验；最终稳定再生与总门未关闭。 |
| P31-4 | 最终生成文件实际 SHA＋1:N 源指针／版本；手写实现锚与源引用单列；一次合法真源增量穿过双链生成、运行、锚对账，证明手写区未被覆盖。 | 批准计划记录旧 P24／P25 有限定文件回锚；853核旧目标、真源／正式输入保护及 frozen runtime 不变。此保护／历史回锚不是当前 V1最终锚或源增量证据。 | 当前 V1最终1:N文件锚清单／实际SHA、手写独立锚，以及合法源增量到两链新目录、运行和锚写回的实际回执。旧 P24／P25 不重做，也不挪作本项通过。 | 最终1:N及源增量闭环 not-run；未关闭。 |

## P32 — 3 个原内分项

| 原内分项 | 要求（批准内容归档，非另起包名） | 已有实际证据 | 尚欠证据 | 当前状态 |
|---|---|---|---|---|
| P32-1 | 生成器／手写 ext／依赖组成可搬移闭包，无本机或 `.rounds` 硬编码；正常发行以独立 ext源包／制品承载，不复制手写源码进 generated；冻结三 runtime制品原 SHA与许可证准确。 | 754明确实际 options仍有本机外部 source root及 P23 file Maven路径；844／845本机缓存编译通过、853冻结runtime保护通过。这些恰好限定为本机成果，不证明可搬移发行。 | 可搬移 ext／依赖／配置与许可证清单、路径解析及新位置实测回执；排除旧 scratch／宿主缓存／工作区绝对路径的发行依赖。不能为换绿下载、publish或修改冻结引擎。 | blocked：可搬移闭包尚未认证；本机编译不可替代。 |
| P32-2 | 干净缓存只消费已核现存制品；缺依赖明确阻塞，不回退宿主缓存或下载；正式产物按空目标预检进入 `dist/v1`，交付可复演实际构建／运行所需闭包。 | 844／845是作者机器已有 sbt／Coursier缓存与外部 test source／H2／play-test显式挂载；675／754均披露新clone依赖闭包未认证。853不包含 clean delivery通过记录。 | 干净缓存／搬移目标下完整依赖供给及构建／测试／部署回执、受控 dist产物／清单；尚未核到具体缺失依赖，不臆称“某 jar不存在”。生产 Mongo兼容性不能用4.4隔离运行洗绿。 | blocked／not-run：闭包前置未认证，干净交付未执行。 |
| P32-3 | 正式 `tools/v1-release.mjs` 一条受控 gate串完整真源／准入／双链生成／测试／恢复／锚／交付；原25包及所有 required均无 blocked／unexecuted才关闭V1。保留保护面、失败和资源退出，不以新guard替代成果。 | 已有645／675／754／795／853阶段证据、851资源生命周期、本文25行定位；853交接明确正式release、最终锚／源增量／可搬移交付仍欠。现有浏览器／数据库专用工具不是全release gate。 | 正式release工具及完整执行回执、原25包逐项整包核签、P31最终锚与源增量、P32干净制品／可搬移闭包；当前未通过的跨JVM工具不能预先并入成功链。 | not-run：总release与V1终验未关闭。 |

## 853后实测增量：八类精确LevelDB跨JVM窗口

以下增量更新上表的具体欠门，不改原25包要求。完整说明见[CRASH-RECOVERY.md](CRASH-RECOVERY.md)。863JS/872BC同源build及131tests各通过；JS864–871与BC873–880分别逐窗通过，共16次首JVM SIGKILL、48个独立JVM。第二JVM只由真实BankRecoveryLoop启动恢复，第三JVM完整金融事实、PB及全部持久事件字节等recover，未新增技术事件。所有case独占新LevelDB fsync/local snapshot与TA journal；不是Mongo故障窗验证。

| 影响原内分项 | 本轮已补的实际窗口 | 仍欠，不计原包关闭 |
|---|---|---|
| P26-3、P31-1 | request-before-start：真实客户source持久，settlement/RunStarted为0；强杀后自动发现完成唯一付款。864/873。 | 并发、HTTP ACK丢失及其余指定窗口。 |
| P27-4、P27-5、P31-1 | payment-prepare / payment-investor-commit / payment-collection-commit：原资金phase已耐久、收据不可达、Saga RecoveryRequired；强杀后同身份向前完成。869–871/878–880。 | 结果已存但交付ACK丢失、完整五kind及其他原组合。 |
| P29-2、P29-3、P31-1 | refund-before-assembly：付款成功＋TA拒绝＋唯一退款intent，尚无退款RunStarted；恢复自动装配。865/874。 | 结果已存ACK丢失及其他组合。 |
| P29-3、P31-1 | refund-prepare / refund-collection-commit / refund-investor-commit：将此前testkit三phase推进到真实LevelDB三JVM强杀恢复。866–868/875–877。 | 不扩称Mongo强杀、所有退款结果交付窗口或整P31完成。 |

本轮不再把上述八类窗口写成not-run。上表853截止的原欠门是历史基线；TA/SIP及结果ACK窗口、最终统一再生/1:N锚/源增量、可搬移闭包和P32仍欠。881 Node23/23；最终源/字节码/日志/历史保护/进程退出以`E/CRASH-VERIFICATION-883.json`实际通过回执为准。失败861及其Jackson数值节点修复的最小复现862保留，没有更改金融oracle或历史journal。

## 883后实测增量：TA、交付ACK与定投原持久点

本节在保留853历史表与883八窗记录的基础上更新实际欠项，不新增业务包。精确屏障、失败与修复见[CRASH-RECOVERY.md](CRASH-RECOVERY.md)。最终结果由`E/RECOVERY-VERIFICATION-934.json`核验实际回执，不以本文预记成功。898 JS完整133/133，932 Node43/43；BC915与916–931应在总核验中逐一确认。

| 原内分项 | 新增窗口和实际证据 | 仍保留的边界 |
|---|---|---|
| P28-3、P31-1 | JS899–904／BC916–921：TA Intent-before-submit、register-before-assembly、external submitted/bank accept前、accepted/effect reply前、confirmed ingest前、rejected ingest后ACK前。 | 不是所有confirmed/rejected前后组合；MockTA外部submit与accepted同一记录，不能编造独立窗口。 |
| P27-2、P29-2/3、P31-1 | JS905–906／BC922–923：付款／退款结果PB已存，实际非空Accepted被扣，host delivery ACK与parent checkpoint未存；恢复补原交付而不重做资金。 | 这是内部结果交付ACK，不冒HTTP响应丢失、所有五kind交付组合。 |
| P30-1、P31-1 | JS907–910／BC924–927：完整创建意图、create-only、append精确前缀、seal前四窗；恢复同一完整[10,20]日程。 | 无tick保持currentTick=-1、无occurrence、无付款；不以恢复时间当业务时钟。 |
| P30-2/3、P31-1 | JS911–912／BC928–929：持久tick20但未classify，以及原两个occurrence已存但未dispatch；恢复两个原parent各一次。 | 两期各100实际800/200，accepted-only且计数0；不是停机期间继续推进的外部时钟政策。 |
| P30-4、P31-1 | JS913–914／BC930–931：订单TAConfirmed后尚未写计数桥，首terminal计数已存但桥ACK丢失。 | 单期100后900/100、successTotal1/failureTotal0；旧三败不暂停等政策由原测试保留，不扩称全部失败terminal强杀组合。 |

**修复成果而非单纯加测试**：895首JVM实际SIGKILL后，继任从TA原host Intent只能query，外部没有submission，直到deadline失败。银行binding将严格的可信REQUEST_NOT_FOUND形成durable absence；应用核原host Intent/absence后请求既有Reconcile retry，binding再次核当前权威证据与原身份；原host记录RetryAuthorized再execute。没有改冻结引擎，没有直接submit绕过host，没有将一般UNKNOWN当不存在。897的旧测试oracle禁止retry误报保留，最终精确核absence→authorized retry→原confirmed，不松资金断言。892关闭用例时序失败改为实际callback进入屏障后再取pending，不改生产close。

本轮16窗逐例必须满足三独立JVM、旧进程wait/worker退出、真实Loop零客户重发、第三JVM完整financial和全部serialized journal相等。已有883八窗与这些新增窗不再写为not-run；仍不据局部窗口数量关闭原25包或P32。

## 934后实测增量：当前双链稳定再生与实际源回锚

935复核934全部3756源码、1214历史文件、898/915实际classpath、旧目标/runtime与六HEAD/index通过。936由正式service入口捕获新完整14产品/25文件；核心request/compiled/options/files字节等721，无新业务政策或真源修改。

- JS938/940各193个生成文件；BC939/941各192个。944构建前、949构建后完整库存和全部源字节一致，包含ledger；只归一anchors的显式target repo。每目标JS781 keys/2464 locations，BC787 keys/2469 locations，均通过公共anchor verifier与actual SHA、完整source pointer/content version核验。
- 945–948四个fresh目标compile/Testcompile/完整tests各133/133，不是旧target上重编classes；手写/测试仍生成区外挂载。公共源码未改，公共回归继承934/754已核窗口，不冒新全量运行。
- 35个手写文件独立完整库存、实际SHA及owner声明的source关系核验。区分implements/supports/legacy-adapter，SQL schema只有readSide支持关系，不冒真源已有完整SQL模型。详[RELEASE-PROVENANCE.md](RELEASE-PROVENANCE.md)与[HANDWRITTEN-SOURCE-MAP.json](HANDWRITTEN-SOURCE-MAP.json)。
- 950补闭既有716合法增量：与631前版本canonical比较，唯一变化为`/artifactContracts/2/deployment/service/pages`；当前atom SHA等716 afterSHA，公开validate零hard、roundtrip287 atoms逐字节恒等，完整输入→四fresh生成→实际测试→生成1:N/手写renderer锚齐。复用已合法创作的增量，不为测增量再改业务政策。实际页面路由/renderer测试与历史真实浏览器证据分别保留，不将本次纯测试冒新的生产部署。
- 951 Node52/52，包含生成边界/坏source pointer/漏额外文件/改源/ledger不对称等负例和原恢复/浏览器/输入43。命令误列不存在的`v1-browser-check.test.mjs`被Node22忽略；该文件无suite，不计覆盖。952以准确存在的五个测试文件列表重新执行52/52，零skip/cancel/fail。

以上将P31-3稳定再生与P31-4文件级回锚/合法增量从not-run更新为**限定成果已验**。不自动关P31完整集成、原25包或P32。

### 本次定向核证的原P26细项

- `BankSeedAuthoritySpec:45–46` 已有冲突seed拒绝且日志不增加的实际断言，945–948均执行；不能继续把冲突seed笼统列未测。并发seed及初始化ACK故障尚需独立证据。
- `BankRequestHttpSpec` 为DTO读取器/常量测试；`BankPageRouterSpec` 为generated EssentialAction加services/queries fixture。它们不是socket HTTP ACK丢失或真实actor持久零事件证明。
- `BankApplicationAssemblySpec:43–65` 核真实actor原source/冲突/恢复，但顺序执行，不证明并发请求。883 request-before-start及934内部delivery ACK分别为真实跨JVM补充，不能替代HTTP响应丢失。
- 三个只读/审查代理均上游422且未返回结论，不记独立审查通过。

## 954后实测增量：HTTP、seed竞争与付款五类结果

955复核3787源/1901历史证据及六仓/保护/实际classpath通过。本次只新增银行测试、验收工具和说明，业务Scala/真源/公共生成器/冻结runtime保持，不重跑883/934已验窗口。

- **P26-1**：新`BankSeedConcurrencySpec`三例以真实actor/PB验证并发同配置仅一次初始化、异配置一个胜出一个失败、实际非空Accepted丢失后原authority超时重读PB，以及reserve后不补款；968 BC/970 JS完整tests均执行。
- **P26-2/3**：新`BankHttpAcceptanceMain`独立短寿命socket＋LevelDB/H2，969 BC/971 JS各exercise/replay两JVM。真实HTTP未认证/越权/CSRF/机器字段及重复key拒绝零持久事件；8同正文同ACK、8异正文仅一组成功另一组409；代理丢全部成功响应后同身份重试、完整ACK与原请求GET/全16条持久流跨JVM相等。每原order source/settlement与parent start/checkpoint/complete各一次；独立金额预期从提交正文及胜出响应位置取得。详[HTTP-ACCEPTANCE.md](HTTP-ACCEPTANCE.md)。这不冒生产Factory/Mongo/MySQL或额外SIGKILL。
- **P27-1/2/3/4/5限定补证**：新`BankPaymentDeliveryAcceptanceSpec`四例覆盖真实五kind。payment compensated由真实reserve后public Abort获得；无Uncertain的recovery-required由真实query＋预算1耗尽获得，不构造假Saga状态。每类原target PB/identity/完整host序列、decoy零变、更换正文/身份/结果拒绝与同PID恢复完整事件不增。成功完整checkpoint包含七输入、txid、cursor/metadata及encoded snapshot；拒绝/补偿业务失败、unknown/recovery保持Pending而无checkpoint/失败。详[PAYMENT-DELIVERY-ACCEPTANCE.md](PAYMENT-DELIVERY-ACCEPTANCE.md)。
- **P31-3/4**：新完整输入936经公开入口生成956 JS/963 BC；968/970两链compile/Testcompile/全部140tests通过。975新目标actual file anchors和各自938/939全库存/字节稳定（仅repo归一），35手写实际锚保持。当前外部tests单独记录，未手改generated。
- **Node**：974九个实际文件96/96，零fail/skip/cancel；972冷缓存测试临时目录别名被plainPath拒绝，已用实际canonical临时根纠正，旧失败保留。
- **P32仍未验收**：新增supply collector/cold executor/release检查工具及tests；977裸`--check`准确返回2/blocked，没有执行生成或dist。这只是可运行检查骨架，不是已完成完整release总执行；实际供应闭包/许可证/clean-cache/迁移仍待核。

上述精确细项已不再not-run，不因此自动认证25包。965代理文件写入中编译失败、958/960夹具准入失败、976未知`--report`拒绝均保留。最终源码和资源收口以新的独占整合回执为准。


## 1053后终局核签：双链全量、MySQL负例、冷交付与最终再生

本节为 2026-11-01/02 收口窗口的最终增量；编号回执均在本证据根。逐包最终判定见下方汇总，不改变上文各行的历史定位。

- **P27-1**：新增 `BankSinglePaymentOracleSpec`（1053 锚 tests/31 之一），单笔 100.00 从 1000.00/0.00 至 900.00/100.00，三 participant 逐 phase PB 收据序列（reserve/deduct×investor、credit×collection，同 txid、资源与金额逐一断言）、无 release、Saga identity＝operation identity、Monarch checkpoint 同 txid、order last commit 与重放/异正文拒绝零新增。JS 1047 与 BC 1049 完整 **141/141**（140 旧＋本 oracle）全绿。
- **P31-2**：独占容器 bank-v1-59o-1017-mysql（image mysql:8 = 实际 8.4.11，标签 bank.owner=bank-v1-59o-1017，临时端口 61416）上 `BankMysqlNegativeMain`（1025）六情景全过：重复投递零效果、冲突/身份不匹配拒绝、gap 不跳水位、早到 occurrence 可重试 join、索引写故障全事务回滚、五表终态核对。容器已 stop/rm 归还（MYSQL-NEGATIVE-RETURN-1026.json）；仅认证该版本 SQL 语义。
- **P32-1**：supply-983（captured-blocked）＋ SUPPLY-CONFIG-991/997 递归元数据闭包（992→supply-992 捕获；commons-lang3:3.7、httpcore:4.4.10 为 evicted-only POM，998 捕获）；portable-984 输入双链生成 portable-995/999（JS）与 portable-1013（BC）；迁移位置实测 migrated-1016 与 portable-985 逐文件相等（仅 anchors 位置字段）。4 个插件许可证据（sbt-twirl 1.5.1、javaagent 0.1.5、js-engine 1.2.3、sbt-web 1.4.4）本地无任何许可声明/嵌入/源码包，保持诚实 blocked。
- **P32-2**：冷构建双链通过——JS 1010（update/compile/fullClasspath）与 1012（含 Test/update、Test/compile、test 23/23）于 portable-1011 空缓存；BC 1015 于 portable-1013 同标准 23/23。空 HOME/boot/global/Ivy/Coursier/tmp、file-only 仓库、BankColdNetworkGuard 全程零网络、源码与供应清单前后不变。compiler-bridge 决断＝预填供应内声明派生件（2.13 桥 SHA ed3b92…，记录于 result.json prefilledDerivedBridges；derived-rebuild-unverified 保留）；已发布 2.12 预编译桥直接由捕获 Maven 仓解析。
- **P32-3**：`v1-release.mjs` 新增四类执行回执验证器（supply-manifest@1/cold-build@1/portable-generation@1/mysql-negative@1，分别映射 P32:1/P32:2/P31:2；Node 22/22 过）。真实 manifest RELEASE-MANIFEST-1026：--check 1031 与 --run 1032 均 exit 2 诚实 blocked——三 slot 均 partial+subset-verified，accepted/dist 恒 false；portable-supply 许可与 87 元数据 POM 缺口如实列示。
- **P31-3/4 终版**：final-1052-a/b 双新空目标与 final-956 三方逐文件相等（仅 anchors 位置字段）；FINAL-ANCHORS-1053.json 收 195+195+194 生成文件、35 手写、31 测试实际 SHA 清单。

### 25 包最终判定汇总

| 包 | 判定 | 收口依据 |
|---|---|---|
| P26-1/2/3、P27-1..5、P28-1..3、P29-1..3、P30-1..4 | pass | 844/845 全量基线＋883/934 跨 JVM 窗口＋968–971/974/975 增量＋979 检查点＋本窗口 1047/1049 141/141（含 P27-1 oracle、五 kind、seed 竞争、HTTP 丢响应/并发）；MySQL 负例（1025）补齐 P31-2 所欠 SQL 故障矩阵 |
| P31-1..4 | pass | 115/116 八类＋TA/SIP 跨 JVM、112/114 读侧、117/949/950 双链与锚、1051/1053 终版再生与锚清单、1025 MySQL 负例 |
| P32-1 | pass（带披露） | portable 双链＋迁移实测＋冷构建双链 1010/1012/1015；4 插件许可与 87 evicted-only POM 为**披露性缺口**（见未关闭原因 7），不否定可搬移闭包本身 |
| P32-2 | pass（带披露） | 空缓存双链构建＋测试零网络通过；compiler-bridge 采用供应内声明派生件预填，derived-bridge 冷重建未验证保持记录 |
| P32-3 | blocked | 1031/1032 release 总门如实 blocked：P32:1/:2 仅 partial（subset-verified），且全 25 包整包认证与 twirl 许可闭环未达成；V1 终验不宣称完成 |

## 已验成果不得被重新列为普通待做

- 两链真实生产页面完成现金100＋两期10、pause／resume、TA确认、可信拒绝后的独立退款、原请求重复／正文409及普通新JVM重入；最终880.00／120.00、预留0、SIP成功2／失败0。
- 空MySQL重建保持原Mongo／TA历史，817五表精确相等；847–850最终同源浏览器／只读历史与851关闭排空／字节比较通过。
- 自动退款loop修复由820三红到844／845三phase actor恢复通过；这是真实修复成果，但仍不是跨JVM强杀认证。

## 未关闭原因与不得扩大之处

1. **原整包核签状态**：883八窗/934十六窗、968–975/979 增量、1025 MySQL 负例与 1047/1049 双链 141/141 已汇入「1053后终局核签」逐包判定（P26–P31 与 P32-1/2 pass、P32-3 blocked）；该判定以本表证据链为准，不因历史行文中的「尚需完成」表述而回退。
2. **最终生成的限定成果已验**：949四fresh目标完整库存稳定、生成1:N/实际SHA/35手写独立锚，950既有合法pages源增量闭环已验；P31整体仍依赖原细项和统一总核签，后续任何相关源码变化需更新认证窗口。
3. **交付闭包状态**：可搬移闭包与冷缓存构建已由 portable-984/995/999/1013 与 1010/1012/1015 认证；受控 dist 与 release 终验因第 6/7 项缺口保持 blocked，不生成 dist/v1。
4. **数据库支持边界必须真实**：764的Mongo6.0.3＋锁定驱动失败为`Unsupported OP_QUERY command: find`／code352；Mongo4.4已EOL，仅有独占隔离演示证据，**不是受支持的现代Mongo或生产部署认证**。MySQL实测镜像为8.4.11，不能因标签`mysql:8`改称实测8.0。现代Mongo兼容性仍欠，不能靠修改冻结runtime洗绿；这项披露不创设新业务包，也不把原部署／交付要求缩成H2或transport桩。
5. **失败与局限保留**：805首tick前pause409、818编译失败、819隔离门拒绝、820三红、827粗全表断言失败、832关闭日志失败、833／834中间失败都不回填绿。829只证明限定字段／资金与checkpoint不变，最终关闭正确性采用847–850／851。830的既有KB断链与20 freshness欠账不称全仓green。
6. **P32 许可与元数据披露缺口**：4 个 sbt 插件（sbt-twirl 1.5.1、sbt-javaagent 0.1.5、sbt-js-engine 1.2.3、sbt-web 1.4.4）在本地缓存无任何 license 声明、嵌入文件或 sources 包（ivy.xml 无 <license>、jar 无 LICENSE、无 Maven POM 本地副本）；87 个 evicted-only 元数据 POM 本机从未拉取。以上是精确资源需求：需一次性联网拉取对应 POM/sources/LICENSE 或等价上游声明后按同一验证器复评。P32-1/P32-2 的 pass 判定不包含这些项。
7. **范围不扩大**：仅消费`0.2.1-p23.20261027.1`冻结运行库；单活动应用写者不等于分布式fencing；没有认证生产多写者、规模性能或真实基金公司集成。MockTA属于允许的模拟边界。853资源已归还的证据不意味着现在允许启动服务，也不意味着新的提交／push／publish授权。

**结论：P26–P31 全部 21 包与 P32-1/2（带披露）已核签 pass；P32-3 release 终验保持 blocked，精确缺口为第 6 项（4 插件许可＋87 evicted-only POM）与 25 包整包认证器。已验页面、Mongo/MySQL 资金闭环、空 MySQL 精确重放、自动退款 actor 恢复、冷缓存双链交付与最终关闭排空均为实际成果；不生成 dist/v1，不按测试数量或滚动 guard 宣布 V1 完成。**
