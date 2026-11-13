# 当前真源服务的离线编译与生成单元测试

## 2026-11-12 当前入口：已发布 0.3.0 的显式供给

当前 `verify-truthsrc-build.mjs` 必须同时传入 `--archive` 和
`--runtime-supply "$PWD/.local/truthsrc-runtime-0.3.0"`。后者是已取得的
`receipt.json`＋六个 0.3.0 JAR/POM；必须与根项目选择一致。验收不调用 prepare、
不下载、不回退 P23。原 clean1134 归档保持原字节，只在新独占供给中排除36个旧引擎
成员，再加入六个新制品；有效供给1035文件，实际 sbt classpath 另核三引擎坐标与SHA。
当前回执为 `bank.truthsrc-build/v2`／`bank.truthsrc-runtime-build/v2`。

当前手写源码为 `handwritten/scala/`。完整操作使用[银行工作坊](BANK-WORKSHOP.md)；
下文11月5–6日的数量、路径和成功/失败记录保留原时点，不是0.3.0完整服务签收。

## 2026-11-06 兼容分层与生成读侧

用户选择任务108兼容迁移后，候选03通过534份main/11份Test编译、47测试/10Suite；
候选04通过534份main/14份Test编译、64测试/13Suite。对应读侧14项和actor15项来源/
隔离检查全部true，两候选229份源码/配置逐字节相同。当前教学输出233项计划同步。
详见[实施与验收](TRUTH-COMPATIBLE-COMPOSITION.md)，前期结果仍保留其时点。

新增显式`--run-readside-tests`与其余执行模式互斥：原23生成测试加五份SHA固定的旧
读侧/鉴权/DTO/页面suite共24项，使用Test-scoped H2 2.2.224内存数据库。仍走原
fork和OS禁网，仅明确11份源码，不挂全目录，不创建TA worker，不启动HTTP/真实数据库。
`npm run test:readside-verifier`只测Node准入/报告合同。构建准入现完整验证同一知识在
同一文件中的多个真实span及其字节，不再假设一文件只有一个锚。

## 2026-11-06 紧凑真源与图链候选

本轮 `target/truthsrc-minimal-candidate-20261106-02` 由压缩后的当前作者树经
知识图导出AST生成，保留旧公开签名并新增规则核心/参数分层。
`target/truthsrc-minimal-actor-20261106-01/result.json` 为 **passed**：505份main
Scala和14份测试源码编译完成，64测试/13Suite全部通过（41业务＋23生成），15项来源、
冻结依赖、实际staging、隔离和进程检查均true。没有启动HTTP/数据库或重签1134。
下文2026-11-05记录保留其原时点，不被本次结果覆盖。

`tools/verify-truthsrc-build.mjs` 验证一个**当前 JS 真源项目生成的、尚未构建过的银行服务目录**，连同原始 `v1/handwritten/scala/` 编译。它不是旧发行复演脚本，也不导入 `v1-release-cold.mjs`。

默认只运行服务 `compile`。`--compile-generated-tests` 只增加生成测试源码的 `Test / compile`；`--run-generated-tests` 隐含该编译步骤，并通过生成 build 的固定 `Test / test` 执行已准入的生成单元测试。另有独立`--run-actor-tests`模式，按固定清单增加八个冻结业务Suite，不是整目录历史测试；它仍用原fork/runner和OS禁网，详见[四流actor窗口](TRUTH-RUNTIME-ACCEPTANCE.md#四流actor窗口独立于服务数据库)。两个执行模式互斥，均无任意task、`testOnly`、`run`、`runMain`或HTTP入口。通过不表示完整1134重新签收，runtime retry/backoff/deadline设计仍为 **OPEN**。

## 当前运行源码闭包与classpath交接：冷编译02 passed

新增默认关闭的 `--compile-runtime-tests`，与两个测试执行模式互斥。它只编译六个当前生成测试文件和五个固定、按冻结SHA准入的集成main；额外的LevelDB 0.12/H2 2.2.224仅为Test依赖，仍只从固定1134供给解析，不执行任何main或测试。

2026-11-05实际最终冷02：`target/truthsrc-runtime-build-20261105-02/result.json`、`runtime-build.json` passed/exit0。9PB、499main和11test冷编译成功，build66.540秒；199实际staging输入、35手写、7runtime及1065供给不变，全部14项checks true。`Test / fullClasspath`有194项：189个供给JAR、2个实际class目录及3个显式不存在的Play目录（包括`target/web/public/test`）。runtime01已编译成功但校验器误认该目录为public/main，原blocked回执保留，未补改。

classpath目录的文件和空子目录均封存。Python在OS沙箱下逐个解析JAR manifest，记录Xalan/Serializer四个隐式相对引用均为固定位置不存在；运行前后复核，不能在这些地址放新JAR而仍通过。不存在的引用不是授权隐式下载或搜索旧缓存。

独立 `tools/truthsrc-runtime-admission.mjs` 已对实际冷02进行完整准入成功，核对当前公共项目plan、原candidate/实际staging、11来源、构建进程及stdout/所有独占回执、toolchain/控制文件、classpath/供给/缓存。系统 `/usr/bin/python3` 是root拥有且不可组/其它写的多硬链接平台launcher；只对这个精确系统路径承认该事实，源码/测试/JAR仍拒绝硬链接。

```bash
node tools/verify-truthsrc-build.mjs \
  --project-output "$PWD/target/truthsrc-runtime-candidate-<new-id>" \
  --archive "$PWD/dist/bank-wealth-v1-darwin-x64-1134.tar.gz" \
  --runtime-supply "$PWD/.local/truthsrc-runtime-0.3.0" \
  --evidence "$PWD/target/truthsrc-runtime-build-<new-id>" \
  --compile-runtime-tests
npm run test:runtime-verifier
```

真正运行由独立 `verify-truthsrc-runtime.mjs` 消费成功交接，不能用编译回执冒称运行已验。范围和资源见 [运行验收说明](TRUTH-RUNTIME-ACCEPTANCE.md) / [本轮资源合同](TRUTH-RUNTIME-WINDOW-20261105.md)。不改原单元禁网profile、生成build或历史发行回执。

## 当前跨JVM恢复：24/24 passed

独立运行消费者读取runtime冷02后，`target/truthsrc-runtime-crash-20261105-02/result.json`
实际通过24个固定窗口、72次JVM，所有原业务/恢复断言及来源对账通过；无网络/数据库服务，
全部worker/journal锁正常归还，数据保留。该运行成果与本页compile-only结果分开，详见
[运行验收边界](TRUTH-RUNTIME-ACCEPTANCE.md)。不能据此关闭HTTP、Mongo/MySQL或retry策略门。

## 最终四流actor执行：passed

`target/truthsrc-actor-candidate-20261105-01`在新空缓存和相同禁网边界下通过
9protobuf／499应用Scala／14测试源码编译，**64测试／13Suite全部成功、exit0**。
其中付款6项、TA8项、独立退款7项、有限SIP20项，另有23生成测试；build89.037秒。
15个新TA journal、16次正常worker启动/关闭/wait，全部15项保护检查true。
回执位于`target/truthsrc-actor-20261105-01/`的`result.json`、`actor-tests.json`、
`actor-workers.json`及`actual-build-sources.json`。没有运行HTTP/真实数据库/浏览器/
跨JVM恢复，不改变1134签收。详见[验证记录](TRUTH-VALIDATION.md)。

actor模式额外允许写本轮`.local/mock-ta/truthsrc-actors-<evidence-name>`，只用显式
冻结fixture；旧作者、旧scratch和loader读取被OS禁止，新config写入被禁止。
默认模式和生成-only模式不创建TA目录或挂载业务测试。原生成-only两次通过记录
仍保留，不能把actor结果填回旧回执。

## 最终生成单元执行：passed

用户要求继续剩余任务后，`target/truthsrc-unit-candidate-20261105-02`在全新
`target/truthsrc-unit-20261105-02/`完成冷编译及生成单元测试，**passed／exit0**。
9protobuf、499应用Scala、6生成测试源码编译成功，真实fork运行23测试全部成功，
5Suite完成、零失败/取消/忽略/pending/abort；build71.053秒，ScalaTest1.735秒。
`GeneratedFiniteHostSpec`为零测试Suite，不将它作为finite host业务覆盖。

`result.json`、`generated-tests.json`与`actual-build-sources.json`记录全部11项
checks=true；实际sbt staging的199输入与准入candidate完整对账，sourceBound=true，
35手写/7本地runtime/1065供给/当前输入/沙箱控制与canary均未变。进程全部回收，
无timeout、取消、残留group或终止错误。第一轮unit01同样23测试成功；发现staging
后补上机器对账才新建unit02复验，unit01原回执及历史compile/失败证据没有改写。

没有运行四流业务/HTTP/数据库/浏览器/多JVM恢复，未启服务或容器，未重签1134。
详细命令与失败修正记录见 [验证记录](TRUTH-VALIDATION.md)。

## 已保留的仅编译结果：passed

2026-11-05 第三次，当前`generated/current/`在全新
`target/truthsrc-build-20261105-03/`验证 **passed、exit0**。
9个protobuf编译、499应用Scala源（包括原35手写源及派生源）编译、6个生成
测试Scala源编译全部完成。sbt阶段59.665秒，无timeout/signal/遗留process group。
有13条弃用/外部引用warning及依赖eviction提示；本轮不为清警告改变生成模板
或手写业务。没有执行测试、启动服务或重发runtime。

回执`target/truthsrc-build-20261105-03/result.json`记录全部保护检查true：
OS内核边界、199输入文件、手写/runtime/供给、当前真源/工具、canary/control
均未变，缓存初始为空且最终盘点完成。首次和第二次失败目录保留。

本成功只证明当前服务及生成测试源码可在上述限定环境编译，不是新1134
全四流HTTP/数据库/恢复/浏览器签收；retry/backoff/deadline仍OPEN。

## 已保留的 Java-only 阻断与 OS 边界验证

2026-11-05 尝试1：当前service实际生成199个文件（193源码、4证据、2回执），归档SHA/1065供给文件/Java guard编译与permission probe通过。sbt 1.4.9在 `TrapExit.installManager` 替换SecurityManager时被guard拒绝，因此验证器exit2、build exit1，**尚未进入Scala或Test编译**。199候选、35手写、7runtime及1065供给文件前后相同；所有本轮进程回收，未启动服务或执行测试。

证据仍保留在 `target/truthsrc-build-20261105-01/result.json` 及同目录 `build.stderr.log`。不能重用失败目录或将该回执改成成功。

### 为什么不能仅允许替换 Java guard

对上述 evidence 已提取的实际 supply 使用 JDK11 `javap -c -p -l`，而非根据其它 sbt 版本或文档猜测：

- `supply/maven/org/scala-sbt/main_2.12/1.4.9/main_2.12-1.4.9.jar`：`sbt.StandardMain$.runManaged` 在字节码 offset 0/3 无条件调用 `TrapExit.installManager`，对应 `Main.scala:189`；退出时还调用 `uninstallManager`（`Main.scala:203`）。
- `supply/maven/org/scala-sbt/run_2.12/1.4.9/run_2.12-1.4.9.jar`：`sbt.TrapExit$.installManager` 仅判断现有 manager 是否为 `sbt.TrapExit`；否则 offset 24 构造 wrapper，offset 32 调用 `System.setSecurityManager`，对应 `TrapExit.scala:54`。没有属性判断；`uninstallManager` 也直接调用 `setSecurityManager`（第59行）。
- 在提取 supply 的 JAR class 中未找到候选属性 `sbt.trap.exit`。该固定启动路径**不支持 `-Dsbt.trap.exit=false`**。
- `TrapExit.checkPermission` 虽然委托原 manager，`checkWrite` / `checkDelete` 却立即返回。因此不能只允许替换 manager，就声称原来的源码写入保护仍有效。

独立类级 probe 的历史证据在 `target/truthsrc-trapexit-probe-20261105-03/`：`trapexit-bytecode.stdout.log`、`standard-main-bytecode.stdout.log`、`property-{unset,false}.stdout.log` 和 `probe-result.json`。当时在属性缺省及 `false` 时调用 `TrapExit.installManager()`，两次均在第54行得到 `truthsrc build guard cannot be replaced`；guard身份不变。它只确认阻断可复现，不表示构建通过。此前设置失败的probe也保留。

### 已观察到的安全替代：继承的 macOS Seatbelt

当前验证器用本地 `/usr/bin/sandbox-exec` 在**启动进程之前**施加 OS profile，替代可被 sbt 替换的 Java-only guard。Java manager可以由sbt安装/卸载，但不能撤销父进程继承的内核限制。每次正式调用仍须先通过真实 syscall probe；没有 Java-only 或无 sandbox 回退。

该独立边界probe阶段只运行自有临时目录的测试，**未生成候选、解包归档、启动sbt或编译应用**；后续实际build结果见文首。独立driver使用验证器同一份profile构造、内嵌Java/Python probe和超时/回收函数，不调用candidate admission或build入口。

成功证据目录：`target/truthsrc-os-sandbox-probe-20261105-zmmuSW/`。`independent-result.json` 为 `passed`，`sandbox-check.stdout.log` 记录：

- JDK11先安装全放行Java manager，再调用 `System.setSecurityManager(null)`；随后真实IPv4 connect和listen的bind步骤均得到 `Operation not permitted`。
- Java启动的Python子进程及其再次exec的孙进程**不另加sandbox wrapper**，仍各自得到IPv4/IPv6 connect、listen-bind的 `errno=1`（EPERM）。没有成功建立连接或监听；Python一旦bind成功即判失败，不再调用listen。
- Java及两个native后代的外部自有canary写入/删除、经evidence内symlink逃逸的写入均被内核拒绝；Python还验证外部新建与symlink删除拒绝。共23次拒绝（10次网络、13次文件操作），不是调用SecurityManager方法的permission probe。
- 三个进程都能写自己的evidence文件；两个外部canary及profile/probe源字节前后相同。javac与probe均exit0，耗时分别592ms、509ms；没有timeout、signal或遗留process group，直接子进程均已回收。

首次OS probe `target/truthsrc-os-sandbox-probe-20261105-jrrZhB/` 也保留：网络/文件拒绝已生效，但Python `subprocess.DEVNULL` 以 `O_RDWR` 打开 `/dev/null` 被拒绝，尚未启动孙进程。只增加**精确literal `/dev/null`**后才获得上述成功；没有放开 `/dev`、系统临时目录或网络。

独立probe本身只证明OS边界可用，不证明完整build；随后尝试3的实际完整编译结果已在文首记录。

## 尝试2的静默 exit2：已定位并修复启动配置

正式尝试2保留在 `target/truthsrc-build-20261105-02/`：23次真实OS拒绝probe通过，sbt在1885ms后exit2、stdout及boot update日志为空，源码/供给未变。它没有进入服务或生成测试编译，不能改写为成功。

本次独立诊断的全新证据根为 `target/truthsrc-startup-diagnosis-20261105-2zcXpG/`。只引用尝试2已提取且重新逐文件对账的1065个非秘密supply文件，作为**只读仓库**；两个新dummy分别使用全空自有缓存，没有借用旧boot或用户缓存。没有生成银行candidate、修改作者/生成器/runtime或调用完整compile。

### 实际字节码与异常链

`analysis/` 保存对实际supply执行的sandbox内 `javap -c -p -l` 及独占receipt；不是根据其它sbt版本猜开关。

1. `boot-server.stdout.log`：`BootServerSocket.socketLocation` 在Darwin使用相对路径 `project/target/sbt-load.sock`。`newSocket` offset 82构造 `UnixDomainServerSocket`；offset 88–99把**任何IOException**包装为 `ServerAlreadyBootingException`（`BootServerSocket.java:347–348`）。不是 `sbt.boot.lock`、FIFO或终端输出权限问题。
2. `unix-domain.stdout.log`：`UnixDomainServerSocket.bind` offset 82调用native provider的bind（第134行），成功后才在offset 98调用listen；NativeErrorException在offset 112–123被包装为IOException（第138行）。该次javap另请求了一个不存在的辅助类，receipt为exit1并保留stderr；这里使用的 `UnixDomainServerSocket` 完整反汇编已成功输出，不把整个命令记为通过。
3. `xmain.stdout.log`：`xMain.run` 在正常非client路径先调用 `getSocketOrExit`，**不读取 `sbt.server.autostart` 来跳过boot socket**。后者捕获 `ServerAlreadyBootingException`，仅有console时打印原因；无console且 `forceServerStart=false` 时offset 192–214构造 `Some(Exit(2))`（`Main.scala:134`），尚未进入 `StandardMain.runManaged`。
4. `sysprop.stdout.log`：`SysProp.forceServerStart` 明确读取 `sbt.server.forcestart`。在 `getSocketOrExit` offset 167–189，该属性为true时返回 `(None, None)`，即**无boot socket、无提前退出结果，继续本地sbt**。它不授予bind权限，也不覆盖后续编译错误。
5. `probe01/jvm-exceptions.log` 捕获真实传播链：`NativeErrorException: [1] Operation not permitted` → `UnixDomainServerSocket.bind` → `IOException` → `BootServerSocket.newSocket` → `ServerAlreadyBootingException` → `xMain.getSocketOrExit`。socket路径本就在允许写入的candidate artifact根内；失败点是受 `deny network*` 限制的Unix socket bind，而不是需要扩大write根。
6. `probe01/startup.stderr.log` 的窄诊断SecurityManager只阻止并打印exit，允许sbt替换manager，OS策略始终保留。它确认 `consolePresent=false` 和首次 `System.exit(2)` 的调用栈：`System.exit` → `scala.sys.package$.exit(package.scala:40)` → `xsbt.boot.Boot$.exit(Boot.scala:96)` → `Boot$.$anonfun$runImpl$1(Boot.scala:78)`。后续诊断引起的launcher exit1也保留；harness最终返回首次exit2。此manager不进入正式验证器。

### 两次有界启动验证

| 新目标/证据 | 启动内容 | 结果 |
|---|---|---|
| `dummy01/`、`probe01/` | 原 `forcestart=false`，诊断exit manager + JVM exception logging；仅 `about` / `exit` | exit2，2079ms，stdout空；复现原阻断 |
| `dummy02/`、`probe02/` | `forcestart=true`，正常 `xsbt.boot.Boot`，**无诊断manager**；仅 `about` / `exit` | exit0，7058ms；实际打印sbt 1.4.9、项目及Scala版本 |

两次均限时30秒，未超时/收到signal，直接子进程已回收且无遗留process group。每次启动前均重新通过原23次真实OS拒绝probe；两套profile除自有路径外完全相同，network/write规则没有放宽，supply及dummy源字节、外部canary和profile/probe控制文件前后相同。`probe02/jvm-exceptions.log.0`（JVM自动轮转的首段，亦保留）仍记录相同EPERM bind及异常链，证明成功来自无socket继续，而不是允许网络。

**唯一正式行为修改：**验证器设置 `-Dsbt.server.forcestart=true`，保留 `-Dsbt.server.autostart=false`、关闭supershell、强制OS sandbox、原write根及新candidate独占要求。该fallback也会跳过真实“已有boot server”的失败，所以不能用于共享/既有candidate，更不能取消freshness/协作占用检查。没有network例外、额外write根、manager保护降级或终端权限例外。

上述启动probe只证明静默阻断已修复及空dummy启动成功，不单独证明应用编译或业务验收。后续尝试3已完成文首的应用/测试源码编译；每次新执行仍需冻结输入、新candidate和新evidence，尝试1/2及诊断全部保留。

## 前置与独占约定

- 固定银行作者入口是根 `truthsrc.project.json`，当前树是 `truth/bank-wealth/`，生成器是 sibling `metarch-truthsrc` 的 `scala-cqrs-play-service@1`。不使用 BC、共享 `metarch-app`/`ingested-app` 或旧 `.scratch`。
- 先由当前公共 JS pipeline 生成自己的 candidate。验证器只在内存重新取得当前 plan，**不执行 apply、不重写 build.sbt/config/source、不拷贝历史测试**。默认/生成-only模式不追加业务测试；actor模式只按固定清单用绝对路径挂载八个冻结测试文件，额外摘要对账。手写源码必须已由生成的 build 挂载；验证器不补挂载来掩盖生成器缺陷。
- 生成前所需 `.local/truthsrc-runtime/` 继续由已有 `tools/prepare-truthsrc-runtime.mjs` 准备。验证器只读取并盘点这个目录，不修改该 helper，不重建、安装或发布 runtime。
- 使用本地 Node、`/usr/bin/sandbox-exec`、`/usr/bin/python3` 标准库和 JDK11；sandbox不可用、profile加载失败或实际拒绝probe失败均为blocked，不降级隔离。默认 JDK 是 `/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home`；可用 `--java-home` 指定其他已安装的 **Darwin x64 JDK11**。归档的 protoc 是 osx-x86_64；Apple Silicon 需要能实际运行该工具链的 Rosetta 环境。不会自动下载工具链。
- 所有 CLI 路径必须是规范绝对路径，父目录已存在；不接受空格、符号链接、大小写/Unicode 别名、`.`/`..` 或 `.scratch` 路径分量。不根据调用者的 `JAVA_HOME`/`PATH` 自动选择 JDK。
- candidate 只允许位于本银行 `generated/` 或 `target/` 内；evidence 必须是本银行 `target/` 下**尚不存在的新目录**。两者不得包含对方，不得包含输入归档。
- candidate 必须没有任何 `target/`、`project/target/`、`project/project/target/`。不接受混入文件、旧 ledger 条目、MANUAL 修改或预编译 build class。需要新一轮验证时，生成到另一个新目录，而不是让本工具清理或覆盖旧产物。
- 整个调用期间独占 candidate/evidence，冻结作者输入、JS 工具源码、手写源码和本地冻结 runtime。工具用新建 candidate `target/` 及其中的 `truthsrc-build-owner.json` 做协作占用标记，留下它作为构建产物；这不是对所有进程的强制锁。

## 推荐调用

以下是仅编译模式的路径示例。必须先确认候选和证据路径均不存在；旧 `20261105-01`／`02`／`03` 和所有probe目录不能复用。将`<new-id>`替换为本轮新名称，不要在源码仍变化时生成/编译。

```bash
node /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/tools/truthsrc-project.mjs generate \
  --out "/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-service-build-candidate-<new-id>"
```

然后默认只编译服务及原手写源码。

```bash
node /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/tools/verify-truthsrc-build.mjs \
  --project-output "/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-service-build-candidate-<new-id>" \
  --archive /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/dist/bank-wealth-v1-darwin-x64-1134.tar.gz \
  --evidence "/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-build-<new-id>"
```

若同一轮还要编译生成测试源码，在**首次调用**末尾加 `--compile-generated-tests`。它不是测试运行授权，也不会在上一次已经构建的 candidate 上补跑。需要指定 JDK 时增加以下参数。

```text
--java-home /Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home
```

帮助命令仅打印用法，不启动 Python/JVM。

```bash
node /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/tools/verify-truthsrc-build.mjs --help
```

## 编译前的 admission

仅有一个 `build.sbt`，或者伪造一个同名 ledger，都不足以进入构建。

1. 必须有 `truthsrc.ledger.json`、`anchors.json` 和四个 `.truthsrc/{inputs,canonical,request,compiled}.json`。
2. 从固定 sibling JS 工具的注册生产器重新取得当前 plan；不从 candidate、归档或 JSON 中动态选择/导入可执行脚本。校验当前项目、树、技术绑定和工具文件指纹，拒绝旧生成输入。
3. ledger 每个文件必须由本银行当前项目文件和该 JS generator 所有，实际字节 SHA256 必须匹配记录。除 `inputs.validation` 的历史 roundtrip 结果外，文件字节还必须等于当前内存 plan；`inputs` 的 sources/sourceIndex/generatedFiles/canonicalId 逐项对账，原生成的 validation/roundtrip 必须成功。验证器不为了对账另写临时真源树。
4. anchors 的项目输出路径、生成器/版本、source association、已验证状态和文件指纹双向对账。文件集合必须恰好等于计划文件加 ledger/anchors，不能附加其他 `.sbt`、源码、测试或缓存。
5. 确认生成 build 已使用 sbt **1.4.9**、Scala **2.13.14**，且 main unmanaged roots 恰为 root `app` 加原始 `v1/handwritten/scala/`。
6. 构建前与构建后记录 candidate 全部非构建产物文件、完整手写树及本地冻结 runtime 的字节/文件集。失败、超时和取消也进行后盘点；公共工具的输入指纹另行复核。

这是针对受信任的当前本地 JS 工具和作者输入的文件级 admission，不是给任意外部仓库执行 build 的通用沙箱，也不是来源签名或业务语义认证。并行修改应停止并重新生成，而不是放宽 admission。

sbt 1.4.9在本机实际从本次`global/staging/<hash>/<candidate-basename>`副本装载项目（此前compile03也如此）。验证器不能只盘点原candidate：它从已核摘要的构建日志定位唯一装载根，只接受原candidate或本次自有staging的限定形状，并排除规定构建目录后将全部输入文件集合/字节与准入快照逐项对账。`actual-build-sources.json`记录实际根、199输入的完整摘要及结果；未知根、缺文件、多文件或任何字节变化阻止最终通过。缓存初始为空，副本来自本轮sbt，没有借用旧源码或warm build。

staging位于允许写入的evidence内；这里增加的是受信构建的实际来源对账，不宣称它是恶意进程不可修改的源码挂载或抗敌对并发事务。原candidate、作者及外置手写源仍受OS写入禁令保护。

## 独立离线 supply 与继承的 OS 边界

唯一允许的归档 SHA256 是：

```text
95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade
```

Node 在解包前流式计算**整个归档** SHA256。窄 Python 脚本以 `-I -S` 运行，并在解析/提取前再校验其打开的归档，在完成后复核摘要与文件身份。

Python 先检查全部 member 的有效名称、PAX 名称、文件/目录类型、重复路径、文件/目录冲突、大小写和 Unicode 别名，拒绝 symlink/hardlink、设备、FIFO、稀疏文件和路径越界。之后只用 `extractfile()` 读取以下普通文件，用 `xb` 写入新的 evidence `supply/`；从不调用 `extract()`/`extractall()`，不恢复归档所有者/时间戳/特殊权限。

| 归档前缀 | 必须匹配的普通文件数 |
|---|---:|
| `bank-wealth-v1/supply/maven/` | 1048 |
| `bank-wealth-v1/supply/ivy/` | 16 |
| `bank-wealth-v1/supply/launcher/` | 1（`sbt-launch.jar`） |

不提取旧 boot/global 缓存、编译桥、旧应用、BC 产物、测试支撑或旧 sandbox。sbt 自身使用 Scala **2.12.12** 启动，应用仍为 **2.13.14**。冷缓存缺依赖或不能重新生成编译桥时，必须报告 blocked，不能偷用用户缓存补齐。

每个 evidence 拥有初始空的 `home/cache/ivy/coursier/boot/global/tmp`。子进程只收到显式构造的环境，不继承 shell 的代理、凭据、CLASSPATH、SBT_OPTS、JAVA_TOOL_OPTIONS 或 JDK_JAVA_OPTIONS。HOME/XDG/Coursier/sbt boot/global/ivy/Java temp/preferences 均指向自己的目录。

- `sbt.repository.config` 和 `sbt.boot.properties` 仅列出本次提取的 `file:` Maven/Ivy，没有 `local`、Maven Central 或任何 HTTP(S) 仓库。`sbt.override.build.repos=true` 使生成 build 原有 resolver 不能绕过这份仓库配置。不把 `offline := true` 当作隔离证明；冷缓存仍需解析本地文件仓库。
- profile顺序固定为 `(version 1)`、`(allow default)`、**`(deny network*)`**、**`(deny file-write*)`**，再允许下表中的写入。没有允许loopback、DNS或特定端口的网络例外。

| write规则 | 唯一允许的位置 |
|---|---|
| `subpath` | 本次全新evidence根 |
| `subpath` | candidate的 `target/`、`project/target/`、`project/project/target/` |
| `literal` | candidate的 `project/project` 目录自身，不能写它的任意其他子文件 |
| `literal` | `/dev/null`，仅为已观察到的subprocess重定向需求 |
| actor模式独有`subpath` | 本轮新`.local/mock-ta/truthsrc-actors-<evidence-name>`；根内`actor-ta.json`另以literal拒绝写入。默认/生成-only没有此规则。 |

actor模式另外以`deny file-read*`禁止旧两树、`.scratch`、`dist/v1`和旧truth loader；独立额外probe验证旧loader读取拒绝、config写拒绝以及本轮TA根允许写。此规则不是放开网络，原23次网络/越界写拒绝探针继续执行。

- 根路径通过既有alias/symlink preflight及 `realpath` 校验，profile使用规范路径。系统临时目录、用户HOME/cache、作者输入、生成源码/build/config和外部手写树均不在write allowlist中。新建的symlink也不能把允许的写入根变成外部写入口；实际symlink逃逸probe必须被内核拒绝。
- 在解包/sbt前，用同一个wrapper运行 `javac -proc:none` 和独立 `TruthsrcSandboxProbe`。只有JDK11移除自身manager后真实网络/文件syscall仍拒绝、native子孙进程继承拒绝、evidence写入成功，才能继续。网络只探测loopback数字地址；不建立listener或外部连接，不使用DNS。不能把ECONNREFUSED、timeout、地址族不支持或Java `SecurityException` 当作OS拒绝证明；Python须为EPERM/EACCES，Java须为对应的OS socket/filesystem异常。
- canary由验证器在sandbox启动前，以 `mkdtemp` 创建在evidence的**新临时兄弟目录**中，不在任何允许写入根内。只对自有canary做实际写入/删除probe；不以任何用户源码作破坏性目标。evidence的 `boundary/escape` 是唯一明确记录的诊断symlink。probe、build前和finally都核对canary文件集/字节、该链接及profile/probe源摘要；保留目录，不自动清理。
- **所有顶层子进程**（javac、Java probe、Python供给提取、sbt）均由强制的 `/usr/bin/sandbox-exec -f <profile> <command>` 启动，native protoc、fork JVM与其他exec后代自动继承同一内核边界。receipt记录真实wrapper命令和profile SHA256；每次启动前检查profile未变。删除或替换SecurityManager、清空JAVA_TOOL_OPTIONS，均不能撤销继承的OS策略。
- 移除原Java-only `TruthsrcBuildGuard` 的启动安装。显式 `JAVA_TOOL_OPTIONS` 只传播本次缓存/配置位置，不承担隔离；`-XX:-UsePerfData` 避免外部perfdata写入，JVM错误文件指向evidence。sbt server autostart/supershell继续关闭。没有无效的 `sbt.trap.exit` 开关。
- sbt `set` 显式限定 Test unmanaged sources，默认/生成-only为当前生成计划六文件，actor模式再加入固定八业务文件，并核对实际`Test / sources`十四文件集合；资源只取当前生成`src/test/resources`。不挂整个旧银行测试树。执行模式只增加fork前完整suite集合断言、actor所需具名属性与固定 `Test / test`；不覆盖生成的fork、network manager或测试task，不改写 `UnitTestMain`。
- 提取supply的完整文件集/字节在build前后必须相同。自有缓存记录 `cache-before.json`（全空）和 `cache-after.json`（完整摘要）；缓存允许正常增长，**不是要求编译后的缓存仍为空**，也不访问或补用用户缓存。

**边界限制：**这是macOS当前可用Seatbelt的进程级网络/写盘隔离，不是通用容器或来源签名。读取和其它未禁止的OS操作仍是allow default；Node父验证器及admission的当前本地JS工具仍须受信任。JDK/Python/供给/native工具现在也在同一network/file-write策略内，但不声称防御任意恶意代码、OS漏洞或通过未覆盖的IPC攻击其他服务。evidence内的供应和缓存属于可写范围，故仍需摘要核对；文件盘点、协作独占与preflight也不是抗敌对并发替换的事务。

## 生成单元测试的独立执行门

2026-11-05用户要求继续未完成任务，本轮只推进无网络、无服务/容器的生成单元测试；并未因此批准新HTTP/数据库/浏览器/恢复发行窗口。`--run-generated-tests` 默认关闭，保留所有新candidate/evidence、来源准入、固定离线供给、真实OS拒绝probe与后代继承检查。它隐含 `Test / compile`，随后只调用生成 build 原有的 `Test / test`；不替换 `UnitTestMain`、`UnitNoNetwork`，不禁用fork，不挂载历史测试。

当前六个生成Scala文件为五个Suite及一个配置/启动支撑文件，共23项显式测试：

| Suite | 项数 | 实际覆盖 |
|---|---:|---|
| `GeneratedActorStateSpec` | 3 | 三个真实生成actor的空状态查询，计算端口为query-only。 |
| `GeneratedDomainRoundtripSpec` | 5 | 三个空状态protobuf字节往返，Money/AmountDecimal wire、PO及protobuf转换。 |
| `GeneratedFiniteHostSpec` | 0 | 仅构造时验证unit配置，没有finite host或四流业务测试。 |
| `GeneratedServiceConfigurationSpec` | 11 | 合成生产配置的正反向准入；不初始化driver或连接数据库。 |
| `GeneratedUnitStorageSpec` | 4 | 错误/JSON、缺配置、禁用生产存储/socket、自造String actor的testkit快照恢复。 |

存储固定local actor＋内存PersistenceTestKit journal/snapshot，真实执行事件溯源actor和序列化，不是LevelDB、Mongo、MySQL或跨JVM恢复。socket负例要求Java manager拒绝，强制OS sandbox另外防止manager替换或native后代绕过。

验证器仅在执行模式从已准入生成源码提取当前固定Suite/测试名字和摘要，显式记录零测试Suite；两种仅编译模式不受固定23项清单限制。fork前核对 `Test / definedTests` 完整集合；执行后同时核对日志摘要、独立unit JVM、配置marker、每个Suite与测试名字、23成功/零失败取消忽略pending及五Suite完成/零abort。编译exit0、单独的“all passed”、漏跑Suite或不完整日志不能签出测试成功。回执区分requested、JVM started、run started、completed、passed；日志不可读取/不再匹配摘要时启动/完成记`null`未知，不记成未执行。所有来源、供给、沙箱和进程退出检查完成后才封存source-bound测试子回执；原始`outputPassed`不等于最终`passed`。退出失败、超时、取消及残留process group仍阻止passed。此解析针对固定生成风格与ScalaTest版本，不是通用Scala语法解析或第三方日志认证。

执行器的轻量合同测试为：

```bash
npm run test:build-verifier
```

实际JVM运行必须使用下面示例中的**全新路径**，既有路径不可复用；不能清理`generated/current`再补跑：

```bash
node tools/truthsrc-project.mjs generate --out "$PWD/target/truthsrc-unit-candidate-<new-id>"
node tools/verify-truthsrc-build.mjs \
  --project-output "$PWD/target/truthsrc-unit-candidate-<new-id>" \
  --archive "$PWD/dist/bank-wealth-v1-darwin-x64-1134.tar.gz" \
  --evidence "$PWD/target/truthsrc-unit-<new-id>" \
  --run-generated-tests
```

生成单元测试不包括付款本金oracle、TA、独立退款、有限SIP业务、HTTP/读侧/页面、数据库或多JVM恢复。M10完整运行门、BC七项作者阶段裁定及现役切换保持独立；原1134不重签。

## 回执、超时与失败处理

每个阶段以异步 `spawn` 启动独立 POSIX process group，stdin 关闭，stdout/stderr 直接进入 `wx` 独占文件；对应 JSON receipt 也在启动前独占预留。

- 阶段严格顺序执行：sandbox内javac上限45秒、真实OS边界probe30秒、extraction480秒、sbt480秒；任一失败即停止后续执行。
- 超时或 SIGINT/SIGTERM 向整个当前 group 发 SIGTERM，15 秒宽限后 SIGKILL；等待直接子进程 `close`/回收，不用 Promise.race 把仍运行的 JVM 遗留在后台。
- 直接子进程退出后仍有 group 成员也会清理并阻止 passed；另有最多5秒 group 消失轮询。`kill(-pgid,0)`的EPERM按仍可能存活处理，不当作已退出；终止错误进入回执并阻止passed，不因异常丢掉已经预留的阶段回执。只有直接子进程能由 Node 回收，不能声称回收任意脱离 process group 的后代。内核不能及时终止的进程也使这不是严格的总墙钟时限。
- 最后同步来源/缓存盘点后先让事件循环处理待决SIGINT/SIGTERM，再封存最终回执；收到取消不得只因build已经exit0而通过。小回执落盘和外部并发仍不是跨文件原子事务。

主要证据文件如下。

- `input.json`：本轮参数、当前真源/工具和验证器本身指纹、工具链（含sandbox-exec）摘要、初始空缓存记录；执行模式另含完整生成测试manifest。
- `sources-before.json` / `sources-after.json`：生成文件、手写树、本地 runtime 的 byte inventory；后者也包含提取 supply 的后盘点。
- `actual-build-sources.json`：sbt日志中实际装载的项目根及完整输入对账；区分本轮staging副本与原candidate，不以原目录未改代替编译输入验证。
- `extract.stdout.log` / `supply-before.json`：整包校验及1065个实际提取文件的摘要。
- `cache-before.json` / `cache-after.json`：仅本次自有可变缓存的前后完整摘要。
- `sandbox.sb` / `boundary/` / `sandbox-before.json` / `sandbox-after.json`：真实OS profile、探测源码/类、允许路径、外部canary和控制文件摘要核对。
- `sandbox-probe.json`：实际syscall拒绝、移除Java manager后仍生效及native子孙继承的通过证明；不是build成功证明。
- `repositories` / `sbt.boot.properties` / `build-plan.json`：本轮离线配置、wrapper/profile摘要和真实sbt tasks。
- `{javac,sandbox-check,extract,build}.{stdout.log,stderr.log,json}`：实际sandbox wrapper命令、退出码/信号、timeout/cancellation/group状态和日志SHA256。
- `generated-tests.json`：仅生成-only执行时产生；完整来源/边界复核后的source-bound结论、独立JVM、预期与观察Suite/测试名及数量、原始输出/进程结果、执行事实未知状态。必须同时检查整体`result.json`；不能截取`outputPassed`当完整验收。
- `actor-tests.json`：仅actor执行时产生，记录完整64项、生成/业务分组及相同source-bound检查；该模式不生成另一份重复的generated-tests回执。
- `actor-inputs-before/after.json`、`actor-workers.json`、`actor-journals-after.json`：八冻结测试及worker/fixture/config/Node输入，15journal/16次worker完整正常退出与配置摘要，以及保留的本轮TA文件库存。
- `result.json`：本轮 `passed` 或 `blocked`、实际阶段、OS probe通过、源码/供给/canary/控制文件未变检查及有限scope。只有退出码0且最终回执为passed才是本轮请求范围成功；生成-only还必须有`generatedTests.passed=true`，actor模式必须有`actorTests.passed=true`及worker/外置输入检查。空/缺失回执是未完成，不是成功。

路径/JDK/既有输出等最早前置失败可能发生在 evidence 创建之前，此时只返回 stderr 与非零退出码。创建 evidence 后的失败尽量留下 blocked 回执和盘点；没有 rollback、自动重试、全事务或自动删除。

若被阻断，先看该阶段stdout/stderr，再区分：输入/ownership漂移、supply缺失、JDK/架构不符、OS sandbox不可用/拒绝、Scala编译错误、超时或文件被改变。保留证据，回到相应真源/生成器/手写实现的授权修改面处理，再生成新candidate；不要手改生成build、放宽网络/源码write边界、借用旧缓存、启动数据库/服务或重新发布runtime来把本轮变绿。
