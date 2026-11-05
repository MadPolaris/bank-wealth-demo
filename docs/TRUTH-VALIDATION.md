# 银行统一真源验证记录

日期：2026-11-05。验证来源为本轮实际命令，不替代或扩大1134运行发行签收。

## 已完成

- 根 `truthsrc.project.json` 指向 `truth/bank-wealth`，单context `bankwealth`。
- 当前树303原子（另有inbox README），validate 0hard/37notice，roundtrip成功。
- 原V1全部执行家族与新源逐项相等；14个正式编译产品payload逐项相等。
- 4故事、4用例、6读模型、3角色、1上下文范围说明被实际编译读取；旧重复
  大JSON由冻结file/pointer引用替代，执行规则不复制到新说明中。
- 新技术输入为8份具名绑定；execution中的重复Saga副本由公共union派生。
  当前输入不消费`payment-376`或旧`*-authored-*`。
- 暂停runner未启动；旧模糊CLI在未显式historical时拒绝，缺省无历史兜底。

## 实际命令

```bash
node --test --test-concurrency=1 test/unified-truth.test.mjs
BANK_TRUTHSRC_INTEGRATION=1 node --test --test-concurrency=1 test/unified-truth.test.mjs
```

第一项4通过/1显式集成跳过，exit0；完整opt-in项5通过/0跳过，exit0，约290秒。
完整项生成193源码＋4证据，检查plan不创建目标、apply真实文件锚、ReserveFunds
正反查及nextN仅候选。在自有临时作者副本修改正金额guard的错误码，不改资金
predicate/身份/顺序，然后观察changed、预览并执行update、源码新错误码、最后
repeat零写。原当前树和V1源保持不变。日志为本次会话
`/private/tmp/truthsrc-bank-integration-1.log`，不是发行包必需输入。

```bash
node tools/prepare-truthsrc-runtime.mjs --archive dist/bank-wealth-v1-darwin-x64-1134.tar.gz
```

exit0，验证干净归档SHA并提取6个固定JAR/POM至`.local/truthsrc-runtime`。
没有访问远程、编译或重发runtime。旧归档SHA与1134一致。

## 最后一次定向修订

独立叙事审阅指出TA/SIP用例使用execution-port字符串作technical-port引用。
已仅修正描述性引用为 `BankTaEffectExecute` / `BankSipDispatchExecute`，新增
全部当前故事引用解析门及公共缺失/歧义引用诊断。当前＋历史v1-inputs/
service-inputs/joint回归11通过/1完整集成跳过，exit0；公共统一suite再次
379通过/1显式BC oracle跳过，0失败。执行家族与14产品不变。

## 最终生成候选

当前教学生成输出 `generated/current/` 已由公共入口创建并重复执行：197entry
首次写入、repeat零写，status synchronized=true。包脚本/教程统一使用此处，
旧`generated/`根与target候选保留为历史验证输出。

`target/truthsrc-service-build-candidate-20261105-02` 已由当前根公共入口生成：
193源码＋4证据，`status-project`为inputs=current、evidence=verified、
synchronized=true。TA故事正向关联40文件、SIP故事35文件、ReserveFunds4文件，
叙事引用diagnostics均为空。它不同于首次构建失败留下的旧`generated/`快照；
旧目录保留，未清理或覆盖。最终公开`compile`返回14产品及1557条来源记录。

最终工具统一suite381项中380通过/1显式BC oracle跳过；银行源合同5通过/
1完整集成跳过，0失败。完整生成/变更的此前opt-in测试5/5是独立实际结果。

## 公共工具验证

`metarch-truthsrc` 的最终定向统一suite 381项中380通过/1显式BC oracle跳过，
正式产品回归70通过。独立实际BC oracle另73通过，五产物与BC编译器保真；
新作者迁移发现7个历史stage冲突并拒绝，未改BC源。具体见工具仓
`PROJECT-UNIFICATION-ACCEPTANCE.md` / `COMPATIBILITY.md`。

## 编译验收进展

首次Java-only隔离尝试在sbt.TrapExit替换SecurityManager时被拒绝，Scala/Test
编译未开始；`target/truthsrc-build-20261105-01/result.json` 保留blocked。
未放行替换：实际字节码证明无禁用开关，且sbt部分文件权限检查不委托旧guard。

后续OS sandbox probe实际23项网络/越界文件/符号链接拒绝通过，移除Java
manager及native子孙进程仍受内核限制。新验证器据此重试candidate02的离线
compile/Test compile的尝试2仍在sbt启动exit2（1.885秒），未输出具体异常，
尚未进入Scala编译。23项内核探针、供给提取、源码/runtime/手写与canary
前后检查通过，全部子进程回收。`target/truthsrc-build-20261105-02/result.json`
为blocked。后续真实字节码/两次启动探针查明sbt Unix boot socket拒绝后
非交互forcestart=false返回Exit2；仅改`forcestart=true`允许无socket继续。
固定后about/exit0、同样23项OS拒绝，未开放任何网络。当前输出的第三次离线编译已 **passed / exit0**，回执
`target/truthsrc-build-20261105-03/result.json`。在新空缓存/本地file仓/OS沙箱下，
9protobuf、499应用Scala源及6生成测试源编译完成；build耗时59.665秒。
13条弃用/外部引用warning和依赖eviction提示保留，没有执行Scala测试。
199候选输入、35手写、7runtime、1065供给以及current input、canary/control
前后全部相同；所有阶段直接子进程已回收，无遗留group。旧两次失败保留。

## 续接：生成测试执行与剩余运行门

2026-11-05用户要求继续未完成任务。新增默认关闭的`--run-generated-tests`，仅执行当前候选已准入生成单元测试，保留原compile-only模式、空缓存、固定供给及OS禁网/写根。未修改公共生成器、银行作者/手写源码、旧测试或runtime。

第一轮新候选`target/truthsrc-unit-candidate-20261105-01`经公共入口生成197entry，执行回执`target/truthsrc-unit-20261105-01/result.json`为passed/exit0。9protobuf、499应用Scala及6测试Scala编译成功，随后真实fork的五Suite共23项测试成功，零失败/取消/忽略/pending/abort；build阶段71.624秒，ScalaTest执行1.757秒。199候选、35手写、7本地runtime、1065供给和current inputs均未变，原23次OS拒绝probe成功，全部子进程回收。

日志显示sbt从本轮`global/staging`副本加载项目。第一轮结束后已实际逐文件核对副本的199输入与准入candidate相同；该轮原回执不改写。随后将装载根/副本完整对账纳入正式验证器，另建第二轮候选和证据复验。

**最终第二轮通过：**`target/truthsrc-unit-candidate-20261105-02`，回执`target/truthsrc-unit-20261105-02/result.json`及`generated-tests.json`为passed，退出0。9protobuf／499应用Scala／6生成测试源重新在空缓存编译；23测试成功、5Suite完成、零失败/跳过/取消/忽略/pending/abort。build阶段71.053秒，ScalaTest执行1.735秒。`actual-build-sources.json`机器核对实际staging的199文件与准入candidate完全相同；`sourceBound=true`及全部11项checks=true。35手写、7本地runtime、1065供给、原candidate、当前输入和OS控制/canary保持字节不变。全部阶段正常退出、直接子进程回收、无残留group/timeout/取消/终止错误；最终仅按pid/comm核对无Java/sbt残留。

```bash
node tools/verify-truthsrc-build.mjs \
  --project-output "$PWD/target/truthsrc-unit-candidate-20261105-02" \
  --archive "$PWD/dist/bank-wealth-v1-darwin-x64-1134.tar.gz" \
  --evidence "$PWD/target/truthsrc-unit-20261105-02" \
  --run-generated-tests
```

这是已执行命令记录，不可重复使用这两个目录；复现必须选新candidate/evidence。第一轮成功及之前compile03/失败尝试/探针均保留。13条编译warning及依赖eviction提示仍在，未以修改业务消除。

### 执行器审阅与反例

独立审阅的七项问题已处理：固定23项清单仅限执行模式；symlink入口不再静默exit0；末尾同步盘点后处理待决取消；来源/供给/边界复核后才封存source-bound测试回执；进程失败与成功日志合成反例；日志不可用的执行事实记unknown；初始验证器hash失败也进入blocked回执路径。

`node --test --test-concurrency=1 test/truthsrc-build.test.mjs`当前41/41通过，包含真实自有Node超时、残留process group、SIGINT/SIGTERM、CLI别名和实际sbt装载源差异。第一次监督反例发现`kill(-pgid,0)`返回EPERM导致预留阶段回执未填；失败目录`/private/var/folders/09/lh3_46994bl20qlyt9kwv9sh0000gn/T/truthsrc-verifier-supervision-xfevWW`保留。已改为EPERM不代表退出、终止错误入回执并阻止passed；后续反例通过，无残留。未为通过而跳过该测试。

同期银行源合同5通过/1完整生成集成显式跳过，0失败；包含validate/roundtrip、V1冻结字节、14产品payload及完整叙事引用。没有把这次跳过写成重复完整生成变更闭环。

### 覆盖边界

23测试包括空状态actor查询、protobuf/精确值转换、配置/JSON与内存testkit快照恢复。`GeneratedFiniteHostSpec`为零测试Suite，**不算四流业务或finite host覆盖**；不是付款/TA/退款/定投、HTTP、真实数据库、浏览器或跨JVM恢复复测。

剩余适配与资源边界已定点整理到 [TRUTH-RUNTIME-ACCEPTANCE.md](TRUTH-RUNTIME-ACCEPTANCE.md)：尤其旧TA worker/path及默认旧snapshot不能隐式借用来宣称完整新源运行验收。BC七项owner裁定和现役切换仍未完成；未启动服务/容器、没有新提交/推送、重签1134或重发runtime，retry/backoff/deadline保持OPEN。

## 续接：四流actor业务回归

用户再次要求继续后，新增固定`--run-actor-tests`，不是放开任意测试目录。
八个冻结业务Suite（41项）与当前生成五Suite（23项）共13Suite／64测试，
均使用新候选main和原35手写源；原`v1/test`文件只读挂载，不修改断言。

**实际通过：**`target/truthsrc-actor-candidate-20261105-01`由公共入口生成
193源码＋4证据；`target/truthsrc-actor-20261105-01/result.json`及`actor-tests.json`
为passed，退出0。9protobuf、499应用Scala、14测试Scala在新空缓存编译成功；
64测试全部成功，零失败/取消/忽略/pending/abort；build89.037秒，ScalaTest16.172秒。
报告中`generatedTests.requested=false`表示没有单独选择生成-only模式，不能把它的
`passed=false`读成23项失败；本轮23项在`actorTests`的64项完整结果内逐名核对通过。

| 业务范围 | 项数 | 实际承接 |
|---|---:|---|
| 付款 | 6 | 三participant本金1000/0→900/100、订单last commit、五kind交付、原身份/目标及保留请求装配。 |
| TA | 8 | 未付款拒绝、相关可信回执、accepted/unknown非终态、原提交恢复与真实worker重开。 |
| 独立退款 | 7 | 全本金反向独立Saga，付款事实保留；原身份与重复拒绝，三phase由原RecoveryLoop自动恢复，取消不假报本金已退。 |
| 有限定投 | 20 | 完整有限vector、精确前缀恢复、tick/修订/暂停、真实现金派发、首terminal及三败不暂停。 |

`actual-build-sources.json`核对sbt本轮staging中的199输入；fork前/后完整
`Test / sources`十四文件对账。原八测试、显式TA配置/fixture/core/worker及Node
二进制共17输入逐文件复核，连同手写/runtime/供给/current输入/OS控制，共15项
checks全部true。TA位于新`.local/mock-ta/truthsrc-actors-truthsrc-actor-20261105-01`：
15个独占journal、16次worker启动（delayed例同journal重开一次），所有worker均
收到close、exit0且已wait，无残留锁；独立配置摘要、关闭回执和客户端transcript
逐一对账。全部阶段子进程回收，无timeout/取消/残留group，最终无Java/sbt残留。

新worker只消费`test/fixtures/truthsrc-actor-ta.json`七场景冻结测试fixture，其历史
原文SHA/pointer已核，明确不是当前作者树输出。原模拟状态机原样移入纯配置core，
旧snapshot默认入口保留兼容包装；没有第二套状态机。运行sandbox仍全禁网，并拒绝
读取旧两树、`.scratch`、`dist/v1`和旧loader；新配置禁止写，只有本轮TA根可写。

```bash
node tools/verify-truthsrc-build.mjs \
  --project-output "$PWD/target/truthsrc-actor-candidate-20261105-01" \
  --archive "$PWD/dist/bank-wealth-v1-darwin-x64-1134.tar.gz" \
  --evidence "$PWD/target/truthsrc-actor-20261105-01" \
  --run-actor-tests
```

这是已执行记录；复现必须用新candidate/evidence，不能复用上述目录或删除journal。
13条Scala warning及eviction提示保留，不改变业务消警告。`npm run test:actor-verifier`
实际135/135通过、0跳过（原执行器41、新actor闭包8、TA core/worker86）。独立审阅
发现重开日志为UUID而非数字，已修校验器/假样本并完整复测，原冻结测试不改；
初次旧源码字符串断言因结果字段重构失败，已改为两模式真实字段路径的同等检查。
当前源合同再次5通过/1完整生成集成显式跳过，validate/roundtrip与14产品保真仍成立。

**范围仍有限：**这是四流actor回归，不是全部25行矩阵新签收。银行持久化是内存
testkit，SIP的部分TA终态由内部测试命令驱动，部分恢复为显式Reconcile，未认证
HTTP、生产Factory、Mongo/MySQL、浏览器或跨JVM窗口。未启动服务/容器、没有新
提交/推送、重签1134或重发runtime。retry/backoff/deadline和BC七项裁定仍OPEN。

## 续接：解决运行窗口阻塞（2026-11-05）

用户要求解决阻塞后，银行运行线和BC语义裁决分开处理。BC七项已追到既有合并消费的矛盾合同，不能自行对齐；精确源/ID/seq/SHA与推荐裁决见工具仓 `BC-STAGE-DECISION.md`。银行必要独占Docker集成按既有测试分层授权建立本轮资源合同，并在BC协调板仅新增本人两行。

### 固定运行编译与交接

- runtime01：9PB/499main/11test实际编译成功，sbt exit0/66.190秒；验证器因将Play的`target/web/public/test`误认成`public/main`拒绝classpath。原candidate/evidence完整保留，不能拿sbt成功冒称source-bound。
- 修正为实际目录后，新runtime02由公共入口重新生成，空缓存重新编译：9PB/499main/11test，build66.540秒，验证器exit0。`target/truthsrc-runtime-build-20261105-02/result.json`及`runtime-build.json`全部14checks通过。
- 五个runtime main按固定SHA只读挂载，与六个生成文件共11来源；当前193源码+4证据+ledger/anchors共199实际staging输入逐文件匹配。实际classpath194项/189JAR/2真实class目录/3显式不存在目录。JAR manifest四个相对引用均为供给内固定不存在的Xalan/Serializer兄弟地址，已单独记录且运行前后检查，不能暗中补入JAR。
- `admitRuntimeBuild`实际消费runtime02通过；它重新准入公共当前项目并核对完整来源、所有构建回执/进程/日志、工具链/供给/bytecode/缓存。首次消费遇到系统Python launcher有78个硬链接；仅针对root拥有且不可组/其它写的`/usr/bin/python3`保留真实系统身份和hash，其他输入继续拒绝硬链接。

### 隔离与监督反例

- 新`host-local-reserved-ports`策略不同于unit/actor全禁网：只开放登记的IPv4本机端口。实际平台Seatbelt localhost还包括wildcard/本机接口，不能误称exact-IP恶意代码边界；固定生产源/配置及真实listener检查另限127.0.0.1。独立正向probe18761往返与父子孙57次EPERM全部成功，PID归还，原canary/control不变，证据`target/truthsrc-runtime-network-probe-a6388f71ceb4/final-check.json`。
- 监督器对显式AbortSignal仍安装OS信号清场，stop单次进入，回调完成立即撤销控制，尾部完成不误判timeout，日志流先脱敏再写盘。显式barrier SIGKILL与超时不同；前者允许有限TA EOF退出窗口但不删除锁，只有后续实际进程消失才通过。
- crash01首case确实达到barrier，main按许可SIGKILL，TA正确EOF关闭、无锁，全部PID消失；监督器却把过渡期EPERM记作终止错误。该失败回执保留，修为EPERM按仍可能存活继续等待真正ESRCH；29项监督器合同复测通过，另建crash02开始24窗验证。
- HTTP helper首轮mock失败暴露异步IIFE漏调用，补调用后真实mock请求/超时/脱敏/四流视图五项通过，不修改业务断言。

`npm run test:runtime-verifier`首轮实际 **371/371通过、0失败/0跳过**，约59.751秒；补上数据库私有控制文件漂移、取消阻止后继容器创建、未知创建不假报归还三个反例后，最终组合 **374/374通过**（57.149秒，零跳过）。包括原135合同、runtime源码/显式classpath/JAR/准入/监督/隔离/TA/HTTP/DB控制器反例。TA runtime99项、actor兼容86项均在这次组合中执行；其中Node SIGKILL surrogate只证明worker EOF机制，不冒称JVM恢复。实际服务、数据库、跨JVM结果另记，不以Node绿代替。

加入默认不监听的relay测试后，最新包命令为 **379项：378通过、1个显式网络opt-in跳过、0失败**（59.379秒）；这个跳过没有冒充运行。独立授权执行 `BANK_RELAY_NETWORK_TEST=1 node --test --test-concurrency=1 test/truthsrc-runtime-db-relay.test.mjs` 已 **5/5通过**，18762实测双向任意字节/EOF/关闭且端口归还，不启动Docker/JVM。

### 实际跨JVM恢复：24/24通过

`target/truthsrc-runtime-crash-20261105-02/result.json` 为passed/exit0，总509.445秒。
24case各crash/recover/verify，实际72主JVM、72worker均独立，24次确切barrier后main-only SIGKILL；
每case继承原本金/身份/PB前缀/唯一TA提交/原父checkpoint/定投首terminal断言，后继均原RecoveryLoop。
全部72个process passed，无timeout/取消/终止错误；worker正常EOF/close且不存在，无锁。
最终sourceBound/inputsUnchanged均true，前后完整来源与封存classpath保持。首次crash01失败不覆盖。
这是LevelDB fsync/本地snapshot/外部TA journal的固定恢复范围，不是Mongo故障注入或retry策略通过。

### 生产数据库首次部署失败的保留记录

- database01：MySQL在macOS宿主bind数据目录创建Unix socket时MY-010270 `Invalid argument`；没有进入Mongo/HTTP/浏览器。自有容器已停止保数据，回执`database-stop.json`确认Running=false、无未知创建。只将新窗口socket/PID移到容器自身`/tmp`。
- database02：MySQL已完成初始化并ready，但用于创建新账户前的TCP root@localhost控制连接被1130拒绝；没有进入Mongo/HTTP。自有容器同样已停止。新控制面改用容器local socket，不读/打印密码，同时检查`@@global.skip_networking=0`以避免把临时初始化server当ready；对外应用仍是独占loopback JDBC。两失败回执/数据保留。

- database03：两数据库初始化/auth/schema均通过，进入独立kernel probe；所有预期拒绝和HTTP正向通过，宿主DB正向connect返回ConnectionRefused。当前Docker Desktop不发布internal网络端口，不能用docker exec内部ready替代hostready。两容器已停止保数据；database04保留两个internal网络，增加只绑定本轮18762/18763的owner-ID固定exec字节通道，不接默认外联网络、不保存协议正文。

- database04：两个exec relay的实际监听为127.0.0.1:18762/18763，两库连接正向probe通过；生产Loader/Factory已真实进入Mongo驱动，但Java NIO默认IPv6-mapped socket在tcp4 profile下EPERM，随后PrimaryUnavailable，未进入HTTP/浏览器。不是把缺KQueue类的DEBUG fallback当主因：真实`SocketChannelImpl.connect`栈明确Operation not permitted。该轮两容器/relay全部关闭且输入未变；后续只显式选择IPv4栈，不扩大IPv6或端口规则。relay独立opt-in真实TCP字节往返/EOF/关闭5/5已通过，无Docker或JVM，端口归还。

- 独立JDK11 NIO A/B同profile实测：默认connect18761为EPERM；`-Djava.net.preferIPv4Stack=true`完成PING/PONG；同flag连接port1仍EPERM，2.159秒，所有进程/端口归还。证据`target/truthsrc-runtime-jdk11-nio-probe-20261105-KPxLK3/result.json`。首个诊断另发现证据目录新建`.class`拒绝规则转义错误，原explicit classpath写入仍拒绝；已只改新runtime策略为`[.](class|jar)$`并增加父子孙实际新建拒绝，Node反例通过，首失败保留。

- database05：IPv4修正后，Mongo认证、真实SQL读侧和生产Loader/Factory已进入，HTTP实际监听18761；随后新验证器手工BSON编码不兼容Mongo4.4 shell而失败，未执行四流/browser。改为Mongo原生`tojsononeline`结果作为外层JSON中的不透明字符串排序/hash，不eval或转Number；snapshot先自测Long最大值、BinData、Decimal文本完整保留。增加各回调阶段的脱敏失败回执，下一新窗口复验；两库/relay已停止、输入未变。

- database06：Mongo快照/HTTP拒绝门通过，真实Chromium首轮现金付款＋两期SIP完整页面断言通过（browser process exit0，162.078秒；88000/12000、shares80.0000/nav1.2345）；随后驱动额外GET观察时，库DEBUG日志超过监督器16MiB上限，进程被终止且总体blocked。不能把单个browser绿色当四阶段通过。所有2容器/2relay已关闭，数据保留；新窗口仅通过独立immutable logback.xml选择WARN，不提高日志上限或改资金实现。

- database07：WARN日志后initial浏览器+GET及正常restart都通过，restart前后Mongo全库摘要相同；refund在cash-original追平阶段达到原浏览器75秒界限。全轮4492MySQL+112Mongo CLI转发会话增加了测试开销。未延长oracle等待或改业务，后续将相同exec隧道改成Docker本地API的二进制流，记录容器内exec IDs并等待结束，避免每连接新CLI。
- database08：本地API relay下initial再次通过；restart前positive probe因已关闭连接的TIME_WAIT，bind18761报EADDRINUSE，未启动restart JVM。所有服务已关/端口最终free。仅给新probe设置SO_REUSEADDR，不用SO_REUSEPORT、不共享活跃listener；下一新窗口仍需所有断言/前后来源完整通过。

### 实际生产四阶段：database09通过

`target/truthsrc-runtime-database-20261105-09/result.json` 实际passed/exit0。initial、正常restart、refund、replay均按固定生产Loader/Factory及新独占Mongo/MySQL通过；三个真实Chromium流程共107次页面HTTP观察（60/34/13），额外API32次GET。21鉴权/CSRF/注入拒绝均无journal影响，5/5原MySQL负例成功。金额最终88000/12000、预留0，两期SIP成功；原付款成功事实保留，TA拒绝才独立退款，原身份在重启与重放一致。

restart与全新SQL schema replay均GET-only，Mongo全库hash前后相等；journal分别147→147、213→213。sourceBound/inputsUnchanged/controlsUnchanged通过，无timeout/输出上限错误；应用serializer warning与service-stop阶段5000ms warning保留，实际正常主进程close/exit0和worker回收另经验证。

两个容器/两个relay全部停，8019个容器exec（7863SQL/156Mongo）均closed/exit0，16记录host PID消失、三端口归还；数据/网络/09成功及旧失败均保留。

独立审阅指出验证器exec的关闭异常、数据库侧EOF与截断frame处理不足，已收紧并新增反例，不改应用。database10复验首进程因新shell后台stdin继承错误停止，完整blocked保留；修为显式stdin和容器Bash的wait-next双向回收，最终版本另以database11新窗口验证。09成功不追认为后改验证器已经运行。

最新定向Node组合 **384项：383通过、1显式socket opt-in跳过、0失败**（55.798秒）；新增Docker帧逐字节拆分/截断、保留错误流仅计数等反例通过。socket opt-in此前另5/5通过，不计成默认已执行。

### 最终工具版本：database11 passed

后续真正用最终版本重新执行完整窗口：`target/truthsrc-runtime-database-20261105-11/result.json`
passed/exit0，databasePassed/sourceBound/inputsUnchanged全部true，四个阶段和五个MySQL负例
全部成功。三个Chromium流程分别53/35/14条实际HTTP观察（initial GET42/POST11、refund
GET30/POST5、replay GET14），额外API32GET；21鉴权拒绝无journal变化。restart/replay
前后完整Mongo摘要一致，journal147→147/213→213，原身份/本金/TA/SIP终态保留。

四个服务进程正常exit0、均close，四个worker正常close/wait；8051个exec（7891SQL/160Mongo）
全部closed/exit0无帧错误。两容器和relay全部停、控制文件不变、无未知创建，最终PID/端口
清场由独立只读检查确认。未覆盖任何旧回执或清除失败数据；09/10与11分开记。

## 未等同于本次通过的事项

当前离线Scala与生成测试源码编译、固定actor和24个跨JVM恢复窗各有实际独立回执。
HTTP、生产数据库和浏览器已由database09新窗口验证；最终工具的后续新回执单列，不把1134历史签收改写成新输入下已复测。
手写根未被生成器覆盖，文件级来源不冒称符号级认证。retry/backoff/deadline
保持 **OPEN**。BC全量作者切换尚需其owner裁定7项原stage冲突并协调现役消费。

## 保护与失败

V1逐文件SHA按`TRUTH-MIGRATION-EVIDENCE.json`复核；旧根树/六绑定/正式输入/
compiled/qualification/isolation/暂停runner/1134签出当前Git diff为空。README与
continuation的他人dirty未覆盖。实施验证期间未提交推送，也没有删除旧产物/日志。
2026-11-05用户先授权作者统一成果本地提交；随后两次续接完成生成单元及四流
actor验收，并再次明确授权提交这两轮成果。上文“没有新提交”是各轮执行验证
结束时的状态，不是当前提交授权状态。此次只纳入验收工具、显式TA核心/worker/
fixture、对应测试和文档；README与continuation继续排除，不推送/发布，提交号
以本仓Git记录为准。

随后“解决阻塞问题”完成本页runtime冷02、crash02和最终database11；这批执行期间仍未提交。
用户在验收完成后再次明确要求本地提交，授权只覆盖本轮本人运行工具/测试/文档；银行
37个明确文件、工具仓三份兼容/验收文档按清单核对。派生候选、缓存、数据/凭据、旧回执、
README和continuation不进入提交，不推送。BC本人两行协调记录虽可与旧dirty精确分离，但该仓提交门仍阻塞：2026-11-05无fix的KB lint实跑exit1（412文档、1error/1warning），既有`BACKLOG.md:955`指向缺失的`ingested-frontend/docs/UX_ROADSHOW_FINDINGS.md`；该仓还要求提交前sbt compile通过，本次未运行。BC不提交、不绕门、不捎带其已有改动；资源签出本身已完成，最终归还回执不受Git提交状态影响。

初次建树时缺bindings父目录，保留新树后续建；新增角色阶段初缺system
sessionOrder，结构门拒绝后只更新新系统声明；收紧decompose后遇macOS临时
目录别名，由工具使用真实temp路径修复。最终上述测试全部复跑通过。
