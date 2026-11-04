# 银行 V1 原 P26–P32 当前验收矩阵

最后更新：2026-11-04

## 判定与证据边界

**这是唯一现行25行矩阵；1134已完成既定本地demo范围的V1 release签收。** P26–P31为22项，P32为3项；阶段数量保持3/5/3/3/4/4/3。下表要求逐字保留修复前矩阵，不缩减合同、不另造业务政策。编号只是原阶段内的归档序号，不是新包名。原阶段依赖和整体验收仍按[CONTRACT.md](CONTRACT.md)执行。

原25项当前均proven。依据为正式入口的候选完整执行、`dist/v1`安装位置独立完整复演和最终对账；此前被撤回的整包pass历史不追认。详见[1134签出与平台边界](RELEASE-SIGNOUT-1134.md)。

证据根`E=.scratch/p26-p32-bank-v1-59o__arv`；最终`F=E/release-final-1134`，旧修复`D=E/repair-1056`保留。机器签收`dist/v1/RELEASE-ACCEPTANCE.json`，总执行`F/execution/REPORT.json`，安装复演`F/installed-replay/execution/REPORT.json`，最终保护／产物／退出核验`F/FINAL-VERIFICATION.json`。

- 候选和安装位置各自双链全空缓存、零bridge预填、file-only完整141测试，JS30/BC29套件；actual源／classes-JAR／classpath绑定，非暖缓存替代。
- 两位置各自两链24类三JVM故障窗、真实HTTP exercise/replay、生产Loader/Factory Mongo4.4/MySQL8.4.11浏览器initial/restart/refund/replay和MySQL五表5情景全部实际通过。
- 每链独立稳定再生仅归一anchors.repo；193/192代码配置文件、781/787键、2464/2469锚位置及35手写关系重算；既有合法pages增量串入最终运行。
- 非金融库存服务两公共生成入口各96文件，目标写入前反例各2；许可证实际入包，4134文件安装库存一致。
- 干净可分发归档`dist/bank-wealth-v1-darwin-x64-1134.tar.gz`排除数据库／凭证／journal／缓存；不可递归打包含本机复演证据的整个dist目录。JDK/Python/Docker镜像/Playwright/Chromium仍是明确外部前置，不冒整个运行系统分发。
- 10037保护文件、六仓HEAD/index及冻结作者保持；8独占数据库容器停止，失败和旧journal保留，无新commit/push。旧回执与历史事故仍按下节解释。

## 当前25项

下表旧编号证据保留为来源；**所有条目另统一绑定1134候选与安装位置的新执行**：两链`BUILD.json`中逐suite实际测试名、HTTP完整报告、24类恢复完整PB／日志核验、生产数据库浏览器与MySQL五表反例、最终回锚／合法增量／准入，以及`RELEASE-ACCEPTANCE.json`逐项结论。不能把旧编号单独当1134同版本证据。下列边界是未扩大的认证范围，不是把原要求改写为较弱合同。

| 原内分项 | 原要求（保留原文） | 已有实际证据 | 剩余缺口／适用边界 | 当前判定 |
|---|---|---|---|---|
| P26-1 | 固定可信 principal／账户／fund 映射及 seed 版本；核原 `AccountInitializedPB` 而非当前余额；相同初始化零写、冲突 fail-closed，竞争／ACK 丢失后重读原事实；客户不能 seed。 | 1134候选与安装目录同版双链冷构建、原suite、HTTP和恢复／真实数据库浏览器总门均已核；此前证据继续保留。 | 原PB、冲突、同/异配置竞争和初始化ACK丢失均有断言；原包依赖及最终同版本认证已完成。 | proven；1134本地demo签收 |
| P26-2 | 服务端创建 principal；客户仅闭集 cash DTO，账户归属来自受信配置；精确 Money／Decimal 字符串；未认证、越权、机器字段注入零业务事件；查询先授权，GET 无副作用，页面写动作认证／CSRF／Origin。 | 969/971真实socket＋LevelDB/H2拒绝零事件；页面/DTO/查询鉴权suite在修复双链复跑。 | 生产Factory/Mongo/MySQL不是该socket负例的环境；不得扩大为所有部署安全认证。 | proven；1134本地demo签收 |
| P26-3 | principal＋clientRequestId 稳定身份，不以正文铸新操作；完整原请求及来源先原子持久，再 ensure／start 唯一现金图；同正文重入、异正文 409；并发、ACK 丢失、持久未 start、重启均保持原身份；集中 PID／装配与启动追平。 | 883 request-before-start三JVM窗；969/971各exercise/replay的并发、409、全部成功响应丢失和完整16流不增。 | 这些是指定故障窗与本地socket证据，未认证生产多写者fencing。 | proven；1134本地demo签收 |
| P27-1 | 真实三 participant 付款，订单 last commit；本金／预留守恒。原 oracle 为 1000.00／0.00，单笔 100.00 后 900.00／100.00，不用技术成功替代业务结果。 | 修复后的BankSinglePaymentOracleSpec：真实三participant六类prepare/commit PB、1000/0→900/100、扣住募集commit ACK时订单未提交；订单commit入口核两个资金PB。 | 完整输入、txid、Monarch三事件/快照与重入全部六流序列化字节已核；属于本地testkit，不是生产资金认证。 | proven；1134本地demo签收 |
| P27-2 | 原 identity、资金参数与原目标不可替换；重复／冲突不二次扣款；保留五 kind 原目标投递及耐久 Monarch checkpoint，结果 ACK 丢失仍同身份交付。 | 968/970五kind真实交付矩阵；934付款内部结果ACK丢失；969/971另验HTTP响应丢失；修复全测复跑。 | 内部delivery ACK与HTTP ACK为不同窗口，不用一个顶替另一个。 | proven；1134本地demo签收 |
| P27-3 | 应用取消 fence、早拒绝、late Prepare 零资金效果；已补偿与未发生资金效果不能误报付款／退款成功。 | BankOrderCancelSpec／BankPaymentJointSpec取消fence、late Prepare、compensated与rejected-before-effects边界；修复全测复跑。 | 保留实际actor范围，不把测试数量计成全故障组合。 | proven；1134本地demo签收 |
| P27-4 | Prepare／付款收据 unavailable 时保持 UNKNOWN 与原父流程；授权查询真实 identity 后 reconcile，不铸新现金，不提前终结或重扣。 | 883 payment-prepare/investor-commit/collection-commit三JVM指定窗；真实Loop同身份恢复；相关suite复跑。 | LevelDB指定屏障恢复，不冒Mongo故障/断电或任意收据不可用组合。 | proven；1134本地demo签收 |
| P27-5 | 耐久 commit decision 后必须原 identity forward reconcile，不能重新 Prepare／补偿；Preparing／Committing 中断也可被启动补扫与持续恢复发现。 | 883 commit指定窗和BankPaymentJointSpec耐久decision后forward；934内部结果交付窗。 | 不改变冻结runtime，不扩称所有Preparing/Committing时序组合。 | proven；1134本地demo签收 |
| P28-1 | TA 仅处理真实已付款订单；关联原 taRequestId／原正文／资源，可信回执精确校验；scenario 来自受信 demo 配置，客户不能 forced result；shares／NAV 保留原文本。 | BankTaApplicationSpec／BankPaymentJointSpec可信MockTA、原资源/正文、unpaid拒绝；817真实页面精确shares/NAV；修复全测复跑。 | 基金公司/TA为允许的模拟边界，非真实外部金融集成。 | proven；1134本地demo签收 |
| P28-2 | 付款成功、TA accepted、technical effect confirmed 均不等投资成功；只有相关 TAConfirmed 成功，UNKNOWN 保留恢复，可信拒绝才进入退款路径。 | accepted-only／UNKNOWN／相关confirmed/rejected分层suite及817页面证据，修复全测复跑。 | 付款/technical accepted不等投资成功；终态相关性规则保持。 | proven；1134本地demo签收 |
| P28-3 | MockTA 显式不可变配置，无旧 scratch 硬编码；原 register→submit→accept→ingest 间隙均保同身份；恢复从耐久订单查原 TA，worker／应用重启不重复提交。 | 934六个TA指定三JVM窗：Intent、register、submitted、accepted、confirmed ingest前、rejected ingest后ACK前。 | 不声称所有confirmed/rejected前后笛卡尔组合；MockTA提交与accepted为同一记录。 | proven；1134本地demo签收 |
| P29-1 | 仅已付款＋相关可信 TARejected 才发唯一独立反向退款 Saga；保留原付款成功；全本金实际返回才完成。早拒绝／补偿／UNKNOWN 不能假作本金已退。 | BankRefundApplicationSpec／BankPaymentJointSpec真实反向Saga及早拒绝/补偿边界；810/811页面退款；修复全测复跑。 | 保留原付款成功，仅全本金返回才完成；不是所有生产故障认证。 | proven；1134本地demo签收 |
| P29-2 | 同原 refund intent／parent／transaction／反向账户与本金，重复／冲突／替换不得二次退款；未知状态仅恢复已有身份，不允许客户端指定退款目的地。 | 883 refund-before-assembly；934退款结果PB已存内部ACK丢失；原identity/金额/反向账户拒替换suite复跑。 | 客户端不能指定退款目的地；不铸第二退款。 | proven；1134本地demo签收 |
| P29-3 | 启动补扫＋持续 loop 从真实 refund PB 发现并自动恢复同身份；募集户 Prepare、募集户 Commit、投资人 Commit 的耐久收据不确定时，业务测试不得手发 Reconcile；补齐 intent／装配／结果间隙。 | 883退款prepare/collection-commit/investor-commit三JVM窗，真实RecoveryLoop；934退款delivery ACK窗。 | 旧844/845三例仅同ActorSystem，跨JVM依据883，不再写not-run。 | proven；1134本地demo签收 |
| P30-1 | 完整有限创建意图先持久；受信金额／日程校验，Create／Append／Seal 可重入；恢复仅补原完整 vector 的精确前缀，乱序／重复／越界／冲突 fail-closed，不依赖客户重发或内存日程。 | 934完整意图/create-only/append精确前缀/seal前四个三JVM窗；BankSipRecoverySpec复跑。 | 恢复原有限日程，不以墙钟或客户重发代替。 | proven；1134本地demo签收 |
| P30-2 | tick 单调；revision 只作用未来区间；暂停保 backlog、跳过 paused dues、in-flight 继续，恢复不复活跳期；无首 tick 不虚构墙钟。 | 934 tick20耐久但未classify窗口；时钟/revision/pause/backlog/首tick suite复跑；817页面pause/resume。 | 没有外部墙钟补期承诺，不扩称每个revision/pause边界均做过强杀。 | proven；1134本地demo签收 |
| P30-3 | occurrence 稳定身份先持久再 dispatch；按序补期、不等前一期 TA；通过原现金入口／原资金参数真正启动 parent，恢复发现来自 journal，不由页面猜。 | 934两个occurrence耐久未dispatch三JVM窗；BankSipCatchupJointSpec真实现金parent；817两期新JVM重入。 | 唯一原parent/资金效果范围已验，不引入手写资金状态机。 | proven；1134本地demo签收 |
| P30-4 | 只核可信相关首 terminal 并计一次；付款／accepted／UNKNOWN／退款未完成不计终态；失败总数不清零，三败不自动暂停；晚到／重复 terminal 零计数。 | 934 TAConfirmed未回桥、first-terminal已存桥ACK丢失三JVM窗；首次计数、三败不暂停/晚到拒绝suite复跑。 | 不扩称全部失败terminal的强杀组合；UNKNOWN/退款未完成仍不计终态。 | proven；1134本地demo签收 |
| P31-1 | request／payment／TA／refund／SIP 各指定耐久点有可观测故障栅栏；旧 JVM退出并 wait 后新 JVM恢复同 journal，校真实 PB、Saga identity／decision、Monarch checkpoint、零第二资金效果与零重复计数。包括原请求已存未 start、refund intent 已存未装配、结果已存 ACK 丢失。 | CRASH-VERIFICATION-883与RECOVERY-VERIFICATION-934：8＋16类指定窗，双链独立JVM恢复与完整序列化库存核验。 | 指定强杀/socket与生产浏览器均在1134候选和安装位置重跑；强杀仍使用LevelDB，不冒Mongo故障或生产多写者。 | proven；1134本地demo签收 |
| P31-2 | CQRS 从真实日志清洁重放；event／state／index／checkpoint 同事务，按 PID＋seq 去重、冲突拒绝、gap 不跳水位、早到关联可重试；精确 SQL／金额，查询授权；页面区分未知／未追平／不存在／失败，关闭排空后 frontier 失效。 | 817/851真实MySQL五表清洁重放/关闭；本次新MySQL五情景修复：独立schema、固定五表全列/主键、事务快照、精确水位/PB、回滚重试及保数据。 | 1134固定8.4.11五表故障情景以真实actor testkit PB执行；另有生产Factory的真实Mongo日志到新MySQL schema清洁重放与页面核验，不混称同一故障环境。 | proven；1134本地demo签收 |
| P31-3 | 同份完整正式输入分别走 BC独立 typed 与 JS公共链；准入反例在写目标前拒绝，非金融 fixture 防硬编码；双链 compile／Test compile／应用测试；相同源另新目录稳定再生，最终同一集成版本总门。 | 936完整正式输入；本次新JS/BC各compile/Testcompile/141tests；每链另新目录实际稳定再生，仅归一anchors.repo。 | 1134候选与安装位置均同版完整冷构建；非金融库存服务两公共入口96files及两类目标前拒绝实测；不冒所有公共生成器测试重跑。 | proven；1134本地demo签收 |
| P31-4 | 最终生成文件实际 SHA＋1:N 源指针／版本；手写实现锚与源引用单列；一次合法真源增量穿过双链生成、运行、锚对账，证明手写区未被覆盖。 | 本次公共verifier核四新目标实际文件SHA、source pointer/content version/1:N、35手写声明关系；950既有pages合法源增量闭环保留。 | 仅file-level，不认证symbol/span；手写关系为owner显式声明；既有合法pages增量在1134最终输入、双生成、运行和锚关系重新串验。 | proven；1134本地demo签收 |
| P32-1 | 生成器／手写 ext／依赖组成可搬移闭包，无本机或 `.rounds` 硬编码；正常发行以独立 ext源包／制品承载，不复制手写源码进 generated；冻结三 runtime制品原 SHA与许可证准确。 | 1065逐边分类、三桥冷重建、1112双生成器搬移；现两链在capsule内新生成并[完整冷构建各141通过](RELOCATED-APP-COLD-1123.md)，actual源锚、类/JAR、classpath与隔离拒绝均核。 | twirl许可证实际入包；候选与安装位置独立ext／生成／冷构建／生产数据库页面通过。JDK/Python/Docker镜像/浏览器为明确外部前置；仅macOS x86_64本地demo，不冒完整OS镜像或跨平台；历史声明unknown不删。 | proven；1134本地demo签收 |
| P32-2 | 干净缓存只消费已核现存制品；缺依赖明确阻塞，不回退宿主缓存或下载；正式产物按空目标预检进入 `dist/v1`，交付可复演实际构建／运行所需闭包。 | BC1079／JS1082完整冷unit各141；现两链1121在搬移位置新生成、独立全空缓存、无bridge预填、file-only，完整各141通过，33次worker退出和实际classpath均核，详[搬移冷测试](RELOCATED-APP-COLD-1123.md)。 | 1134空目标提升到dist/v1并从安装位置完整再生／冷构建／HTTP恢复／生产数据库浏览器复演。干净归档按发行库存排除私有数据，详情[签出](RELEASE-SIGNOUT-1134.md)；旧1012/1015仍仅预填23测试。 | proven；1134本地demo签收 |
| P32-3 | 正式 `tools/v1-release.mjs` 一条受控 gate串完整真源／准入／双链生成／测试／恢复／锚／交付；原25包及所有 required均无 blocked／unexecuted才关闭V1。保留保护面、失败和资源退出，不以新guard替代成果。 | 正式v2 --execution串起实际生成／准入／构建／HTTP／恢复／数据库浏览器／源锚／certifier／dist及安装位置复演，1134退出0。 | 25项同版证据核验并签收；旧v1摘要仍recorded-summary-only，不用于自动通过。最终10037保护文件／六HEAD-index／资源退出独立核验。 | proven；1134本地demo签收 |

## 历史与事故保全

旧矩阵的853底稿、逐轮增量和被撤回的pass段完整保存在`D/preimages/bank-wealth-demo/v1/integration/ACCEPTANCE-MATRIX.md`，其SHA由`D/BASELINE.json`绑定；不继续与当前表混排。旧恢复语义详[CRASH-RECOVERY.md](CRASH-RECOVERY.md)、[HTTP-ACCEPTANCE.md](HTTP-ACCEPTANCE.md)、[PAYMENT-DELIVERY-ACCEPTANCE.md](PAYMENT-DELIVERY-ACCEPTANCE.md)、[RELEASE-PROVENANCE.md](RELEASE-PROVENANCE.md)。

1. 979登记136历史文件在修复基线均匹配，综合回执再次核对；不据此宣称整个文件系统无损。final-956/963旧test-classes在修复前各已有15条增量，本次不再改它们，也不伪恢复原库存。
2. 原1026多次重建、1027/1028报告及部分harness输出缺失，是无法以本次测试补回的历史损失。保留当前证据，不伪造原始版本。
3. `1b7f0ea`误纳13个保护路径；`778a3fb`含撤回的验收结论。旧提交未改写。用户授权后修复以Bank `49b2642`／BC `c612626f`本地提交，回执为`E/commit-repair-1064/COMMIT-RESULT.json`，未push；13路径已按[1128处置](AUTHORIZED-DISPOSITION-1128.md)裁定保留跟踪／原字节／暂停状态，未改index或历史；该决定不是草稿实现验收。精确清单见`D/INCIDENTS.json`及[修复交接](FINAL-HANDOFF-1054.md)。
4. 旧测试凭证曾进入工具输出，不复述其值。[1128处置](AUTHORIZED-DISPOSITION-1128.md)核旧760数据库已停止、restart=no、凭证文件600，并将其限定为不得复用的离线历史证据；未轮换密码，人工重启归档时旧凭证仍可能有效，外部复用未知。后续必须新资源／新凭证，不以离线处置冒密码撤销；旧数据／日志保持。
5. 本次1057路径反例失败、classpath初次捕获对可选web输出的误拒、首次provenance手写根路径误传，均保留原失败日志；后续使用新回执，不覆盖。

## 已交付P32与保留的平台限制

- supply-998的87 missing-pom已由1065完成可复算逐边分类：5原生Ivy、1cross-built Maven、44provided、26报告替代版本、11bootstrap替代版本；原87 blocker未删除，所有冷resolver需求仍unknown。433条非显式版本与2条未解析managed表达式单列，不称完整Maven解析。旧清单唯一missing-license-evidence为`com.typesafe.sbt:sbt-twirl:1.5.1`；[1128](AUTHORIZED-DISPOSITION-1128.md)已从官方1.5.1固定提交取得Apache-2.0和插件声明，正式材料在`v1/third-party/sbt-twirl-1.5.1/`，原清单不回写。原3个derived bridge blocker不回写，独立2.12.12/2.12.13探针及双链2.13.14现均有源码冷重建证据，详[桥变体](BRIDGE-VARIANTS-1090.md)。
- 旧1012/1015各23生成测试、预填bridge且cachesInitiallyEmpty=false；BC1079/JS1082零预填全空缓存141，actual桥含exact util-interface1.4.0。双生成器搬移生成见[1112](GENERATOR-RELOCATION-1112.md)；现两链1121在搬移位置新应用完整冷unit也各141通过，actual源锚/新类JAR/全部classpath/33次worker退出与7项隔离拒绝均核，详[搬移冷测试](RELOCATED-APP-COLD-1123.md)。1134在候选和实际dist位置完成完整生成、冷构建、恢复、HTTP和生产数据库页面，许可证实际入包；外部运行前置明列，不冒整个OS／数据库镜像交付。
- 旧四类release摘要分支继续recorded-summary-only、executionVerified=false；新v2正式执行入口和dist writer已1134实际运行，25项由实际同版证据认证。干净归档4137files排除运行私有数据，`ARCHIVE.json`逐成员核验。具体[发行签出](RELEASE-SIGNOUT-1134.md)。
- 现代Mongo OP_QUERY不兼容、Mongo4.4 EOL、既有KB #201/freshness与平台边界保持；单活动writer不是分布式fencing，MockTA不是实际基金公司集成。三个runtime仍只消费冻结`0.2.1-p23.20261027.1`，不改源或重发。
