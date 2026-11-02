# 指定持久点跨 JVM 恢复验证

最后更新: 2026-11-01

## 范围与证据边界

这是原 P31 的故障窗口验证，不增加新的里程碑，不代替原 P26–P32 共25包终验。接续853；854已重核3750个源文件、六仓HEAD/index、历史目标与冻结运行库不变。现有Mongo/MySQL容器保持停止。

测试使用独占 LevelDB（fsync开启、纯Java实现）及独占本地snapshot，真实生成actor、银行应用服务、Saga/Monarch与原PB日志。它不认证Mongo强杀恢复、机器断电、磁盘损坏或多个活动写者。所有业务判断仍来自生成actor的事件应用，屏障只阻止调用/收据继续，不保存第二套资金状态。

## 执行合同

- 新 `v1/test/scala/BankCrashRecoveryMain.scala` 是显式集成测试入口，不加入普通ScalaTest suite发现，不替换生产Loader/Factory。
- 新 `tools/v1-crash-recovery.mjs` 接收完整显式配置：synthetic、caseName、namespace、fresh ownedRoot、实际generated target、Java/Node/worker路径、成功build回执及其实际classpath。
- 首次JVM只在真实日志证实指定前缀后写 `barrier.json`；父进程核case/namespace/实际child PID后对该child发送SIGKILL，等待退出。不能以sleep延迟猜测持久点。
- 第二JVM使用同journal及原TA日志，仅启真实恢复发现，不重发客户购买来掩盖启动扫描缺口。
- 第三JVM再次恢复，比较完整原请求、资金效果计数和持久事件字节，证明没有第二次业务效果。
- 正常继任JVM必须写结果和关闭回执；首JVM不得有正常关闭回执。所有子进程命令、PID、退出信号、wait、日志SHA及前后源码/classpath指纹保留。
- 每case独占新目录；工具拒绝已存在根，不删除/复用旧journal或覆盖失败证据。所有重型执行串行，旧JVM退出和worker消失后才允许下一JVM。

## 计划故障窗口

| 窗口 | 首JVM耐久前缀 | 恢复须证明 |
|---|---|---|
| request-before-start | 完整客户source已存，settlement与RunStarted尚无 | 自动扫描原source，仅创建一次付款 |
| refund-before-assembly | 原付款成功、可信TA拒绝、唯一退款intent已存，退款graph未启动 | 从原intent装配同一退款，不需操作员或客户重提 |
| refund-prepare | 退款募集账户Prepare耐久，收据不可达 | 恢复原退款，不重复预留或返款 |
| refund-collection-commit | 退款募集账户扣款耐久，收据不可达 | 同身份forward reconcile，仅一笔募集扣款 |
| refund-investor-commit | 退款投资人入账耐久，收据不可达 | 投资人仅收一次退款，技术checkpoint最终完成 |
| payment-prepare | 付款投资人Prepare耐久，收据不可达 | 原付款恢复，不重开另一购买 |
| payment-investor-commit | 付款投资人扣款耐久，收据不可达 | 原commit决定向前完成，投资人仅扣一次 |
| payment-collection-commit | 付款募集账户入账耐久，收据不可达 | 募集仅入一次，订单最终结果和技术checkpoint完成 |

上表八类窗口已在JS和BC两链分别完成，具体证据如下；这不等于P31全部request/payment/TA/refund/SIP故障矩阵已齐。

## 验证记录

- 855：新控制器配置/报告归属/重复效果负例9/9。
- 856：上述9项＋既有浏览器9项＋正式输入2项，共20/20；859进一步收紧证据完整性后12/12。
- 858实际compile/Testcompile/131 tests通过，但附加字节码捕获将合法但缺席的Play输出目录当文件读取，作者失败。860捕获明确absent标记，不造占位文件。两记录保留。
- 861原请求窗口的真实SIGKILL和第二JVM自动付款成功；第三JVM证据比较失败。862用相同Jackson依赖最小复现：LongNode(1)序列化再解析变IntNode(1)，JSON完全相同但node equals为false。仅规范化报告整数节点，保留原事件及序号/hash强断言；新目录重跑，不复用失败journal。
- 最终863 JS、872 BC：compile、Testcompile、全部单元tests各131/131。显式追加已有`org.iq80.leveldb:leveldb:0.12` Test依赖；只消费缓存，不下载。成功build后保存全部classpath目录、JAR及缺席目录指纹；实际执行绑定这些字节和外部手写/测试源码。
- JS八窗864–871、BC八窗873–880，顺序均同上表。每例三个独立JVM：首进程SIGKILL且无closed；继任exit0/closed，真实BankRecoveryLoop零客户重发；第三进程exit0/closed。合计16次强杀、48个JVM，逐个wait，worker在首JVM管道EOF后退出或正常close后wait。
- **每例recover→verify的完整持久事件序列/实际serializer字节、完整金融事实、原TA journal均相等；没有额外技术事件。** Parent RunStarted/StageDone各一次，无第二资金效果。独立单笔付款900.00/100.00，退款1000.00/0.00，预留清空。
- 881最终Node23/23：控制器12＋浏览器9＋完整输入2。父runner审查发现的空evidence与旧字节码关联缺口已补；child窄审未发现blocker（静态审查，不冒独立运行）。
- 最终核验入口为本证据根`CRASH-VERIFICATION-883.json`及`CRASH-HANDOFF-883.md`；通过状态以文件实际结果为准。

### 日志与权限限制

正常JVM stderr保留三行既有SLF4J初始化重放notice，不称stderr为空；stdout还含既有ObjectIdOffset serializer注册warning，不是Mongo连接。核验不能仅按“Mongo”子串误判连接，也不能忽略真实ERROR/异常。首JVM强杀时没有worker正常wait回执，父工具仅确认其PID已消失，不能把它说成Java完成正常清理。

精确比较政策区分PID等临时过程字段和耐久事实；允许清单内非金融技术追加必须显式记录，但本次48JVM均未发生此追加。报告JSON只作观察与同步，第二JVM恢复不消费barrier作为业务输入。第三JVM读recover报告作断言，不用它修改actor状态。

## 883后新增：TA、结果交付与SIP窗口

这组实现接续884源码/字节码复核，仍属原P31。`BankSipCrashRecoveryMain`为外部银行测试入口，原`BankCrashRecoveryMain`增加TA/交付窗口；两个入口复用同一正式父控制器。测试actor代理只转发真实命令、屏蔽指定调用/实际Accepted，不生成业务事实。所有正常继任仅启动真实`BankRecoveryLoop`，无客户重发、测试手发Reconcile或追加tick；应用内部原身份恢复照常执行。

| 窗口 | 首JVM精确屏障 | 后续业务oracle |
|---|---|---|
| ta-intent-before-submit | 原TA host Intent与parent Start已存，实际execute委托前阻断，外部submission=0 | 持久权威absence后授权原host retry；唯一外部提交，900/100，accepted不计投资成功 |
| ta-register-before-assembly | 注册PB=1，ensureTa委托前阻断，host/parent/submission=0 | 自动装配原图并提交一次 |
| ta-submitted-before-bank-accept | MockTA原提交耐久，RecordFundTAAccepted委托前阻断 | 查询原回执，银行accepted和原checkpoint各一次 |
| ta-accepted-before-effect-reply | 真实Installed.execute完成后扣Future，银行accepted=1，技术结果/StageDone=0 | 恢复原effect，不再次提交 |
| ta-confirmed-before-ingest | 真实外部advance1，RecordFundTAConfirmed委托前阻断 | 原份额80.0000/NAV1.2345精确摄入，900/100 |
| ta-rejected-after-ingest-before-ack | 实际非空Rejected Accepted被扣，拒绝PB=1，同时阻断退款intent命令 | 自动独立退款一次，1000/0，原付款仍成功 |
| payment-succeeded-before-delivery-ack | 真实付款结果PB=1，结果Accepted未返，host ACK/parent StageDone=0 | 补原交付ACK与checkpoint，不重扣 |
| refund-succeeded-before-delivery-ack | 真实退款结果PB=1，结果Accepted未返，host ACK/parent StageDone=0 | 补原交付ACK与checkpoint，不重复返款 |
| sip-intent-before-create | 完整创建intent=1、Create=0 | 恢复原完整[10,20]日程，无tick不付款 |
| sip-create-before-append | Create=1、append=0 | 仅补原日程后缀 |
| sip-append-before-next | 原position0/due10已存，position1尚未转发 | 原顺序补due20并seal |
| sip-before-seal | 两个append已存、seal=0 | 仅封存原完整日程 |
| sip-tick-before-catchup | operator tick20已存，首Observe尚未转发 | 自动补两期各100，800/200，accepted不计终态 |
| sip-occurrence-before-dispatch | 原两个occurrence已存，ensureSipDispatch委托前阻断 | 两个原parent各一次，800/200 |
| sip-terminal-before-bridge | due10原订单TAConfirmed已存，plan计数命令尚未转发 | 900/100，successTotal=1/failureTotal=0 |
| sip-terminal-ack-lost | 实际首terminal非空Accepted被扣，terminal PB和计数已存 | 零新增terminal、零重复计数 |

创建四窗的最终currentTick=-1，没有墙钟补单；“停机tick”仅指已耐久tick后的处理间隙，不擅加停机期间的外部时钟权威。MockTA一次RequestSubmitted已经包含accepted，不能把外部submit/accepted虚构成两个独立耐久点。confirmed-before-ingest与rejected-after-ingest分别覆盖不同后续路径，不冒所有终态的前/后笛卡尔组合。

### 真实恢复缺口与修复

895先实际强杀首JVM，第二JVM在TA Intent-before-submit停滞：原付款成功而外部只有Initialized，无TA提交。892同系统actor红测也复现submitted未恢复accepted；失败journal/日志均保留。修复只落银行`BankTaEffectBindings`与`BankTaRefundApplication`，不修改冻结host/runtime或生成区：

1. 仅可信MockTA同原requestId、REQUEST_NOT_FOUND、合法tick、无request、空canonical/receipt/conflict的完整权威查询可以形成技术`absent`；一般unknown/transport failure不成立。
2. 原host持久`ObservationStored(absent)`后，应用核同host原完整Intent再发原`Reconcile(retry)`。
3. binding校内部受信授权、原operation/request、真实已付款订单、耐久absence与当前权威查询相等。原host持久`RetryAuthorized`后才重新execute，不直接submit绕过host。
4. 测试拒绝错授权、错decision、空/unknown/伪proof、替换operation/request及外部已提交后的陈旧absence。第三JVM原absence/授权/confirmed所有序列和字节也必须相等。

897因child旧断言禁止所有retry而失败；修复仅将该case改为精确核`Intent→absence→RetryAuthorized→confirmed`，没有放宽金融oracle或重写旧记录。旧close测试892的时序失败改为等待真实terminal callback进入屏障，再取得pending future；没有改生产close。

### 本轮执行证据

- 891：误用生成target禁用的testOnly被隔离门拒绝，无用例执行；随后用正常test入口，保留GeneratedUnitStorageSpec和no-network门。
- 894：两child compile/Testcompile通过，compile-only不冒tests。896完整132/132；最终898 JS完整133/133，包含新增未提交恢复与授权反例。
- JS899–914按上表顺序16窗全部三JVM通过。BC915构建与916–931相同16窗的最终结果以`RECOVERY-VERIFICATION-934.json`逐项核验为准，文档不是运行回执。
- 888 Node28/30抓住SIP terminal屏障计数缺约束；88930/30。独立父控制器审查指出完整journal恒等和缺订单列表两个量具缺口，修复后89332/32；932最终恢复/浏览器/正式输入Node43/43。
- TA实施代理完成归还；SIP实施代理写1137行后422，由主会话完整读回、编译、实际运行接管。SIP独立窄审38工具后422，没有返回结论，不记review通过；TA恢复生产修复另有12工具独立静态审查无blocker，不冒实际运行。
- 933 KB仍旧#201断链与20freshness，未fix，不称全库green。

新SIP恢复日志还保留`scenario for a foreign original order`暂时拒绝告警：TA发现可早于测试组合根从原occurrence登记现金句柄，下一轮真实发现后完成；这不是资金结果、不是数据库连接，也不声称日志全空。最终核验逐行收录这些WARN，禁止忽略真实ERROR。该测试组合根的暂时拒绝不等同生产Factory的固定受信scenario函数故障。

## 原矩阵仍欠

本轮限定16新窗与883八窗不再列not-run。原P26–P32逐项总核签、HTTP ACK/并发与其余明确要求的证据关联、最终统一再生/1:N锚/合法源增量、P32可搬移闭包与release总门仍欠；不将LevelDB进程故障扩大为Mongo强杀、断电耐久或生产多写者认证。

## 保持不变

冻结runtime版本 `0.2.1-p23.20261027.1`；生成目标源码/build/spec均不手改，业务测试以外部目录挂载。公共生成器、银行正式输入和真源不因测试新增而修改。没有下载、发布、新commit/push或共享应用写入。最终文件1:N锚、合法源增量双链再生、P32可搬移依赖与release gate仍需原计划验收。
