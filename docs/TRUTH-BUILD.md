# 当前真源服务的离线编译验证

`tools/verify-truthsrc-build.mjs` 验证一个**当前 JS 真源项目生成的、尚未构建过的银行服务目录**，连同原始 `v1/handwritten/scala/` 编译。它不是旧发行复演脚本，也不导入 `v1-release-cold.mjs`。

默认只运行服务 `compile`。可显式增加 **生成测试源码的 `Test / compile`**；本工具不执行 `test`、`testOnly`、`run`、`runMain`、HTTP 验收或历史 Scala acceptance suites。编译成功不表示应用已启动、业务验收通过或完整1134重新签收。runtime retry/backoff/deadline 设计仍为 **OPEN**。

## 最终实际构建：passed

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

这证明新OS边界可用，**不证明完整build已通过**。主会话完成最新源码的core检查并冻结输入后，才通过公共入口生成全新candidate，安排下述编译验证。

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

这只证明本次静默启动阻断已修复及空dummy的sbt启动成功，**尚未证明银行服务compile、生成测试compile或任何业务验收通过**。下一次完整编译仍须主会话冻结输入、经公共生成入口生成全新candidate并使用全新evidence；尝试1/2及本诊断全部保留，不能复用。

## 前置与独占约定

- 固定银行作者入口是根 `truthsrc.project.json`，当前树是 `truth/bank-wealth/`，生成器是 sibling `metarch-truthsrc` 的 `scala-cqrs-play-service@1`。不使用 BC、共享 `metarch-app`/`ingested-app` 或旧 `.scratch`。
- 先由当前公共 JS pipeline 生成自己的 candidate。验证器只在内存重新取得当前 plan，**不执行 apply、不重写 build.sbt/config/source、不拷贝或追加历史测试**。手写源码必须已由生成的 build 挂载；验证器不补挂载来掩盖生成器缺陷。
- 生成前所需 `.local/truthsrc-runtime/` 继续由已有 `tools/prepare-truthsrc-runtime.mjs` 准备。验证器只读取并盘点这个目录，不修改该 helper，不重建、安装或发布 runtime。
- 使用本地 Node、`/usr/bin/sandbox-exec`、`/usr/bin/python3` 标准库和 JDK11；sandbox不可用、profile加载失败或实际拒绝probe失败均为blocked，不降级隔离。默认 JDK 是 `/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home`；可用 `--java-home` 指定其他已安装的 **Darwin x64 JDK11**。归档的 protoc 是 osx-x86_64；Apple Silicon 需要能实际运行该工具链的 Rosetta 环境。不会自动下载工具链。
- 所有 CLI 路径必须是规范绝对路径，父目录已存在；不接受空格、符号链接、大小写/Unicode 别名、`.`/`..` 或 `.scratch` 路径分量。不根据调用者的 `JAVA_HOME`/`PATH` 自动选择 JDK。
- candidate 只允许位于本银行 `generated/` 或 `target/` 内；evidence 必须是本银行 `target/` 下**尚不存在的新目录**。两者不得包含对方，不得包含输入归档。
- candidate 必须没有任何 `target/`、`project/target/`、`project/project/target/`。不接受混入文件、旧 ledger 条目、MANUAL 修改或预编译 build class。需要新一轮验证时，生成到另一个新目录，而不是让本工具清理或覆盖旧产物。
- 整个调用期间独占 candidate/evidence，冻结作者输入、JS 工具源码、手写源码和本地冻结 runtime。工具用新建 candidate `target/` 及其中的 `truthsrc-build-owner.json` 做协作占用标记，留下它作为构建产物；这不是对所有进程的强制锁。

## 推荐调用

以下是**等待主会话完成core检查并冻结最新源码后**的推荐下一轮；本次未执行。必须先确认两个新路径均未被占用。旧 `20261105-01` / `20261105-02` candidate/evidence及所有probe目录不能复用；示例 `20261105-03` 若已存在，选另一个全新名称。不要在源码仍变化时生成/编译。

```bash
node /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/tools/truthsrc-project.mjs generate \
  --out /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-service-build-candidate-20261105-03
```

然后默认只编译服务及原手写源码。

```bash
node /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/tools/verify-truthsrc-build.mjs \
  --project-output /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-service-build-candidate-20261105-03 \
  --archive /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/dist/bank-wealth-v1-darwin-x64-1134.tar.gz \
  --evidence /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-build-20261105-03
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

- 根路径通过既有alias/symlink preflight及 `realpath` 校验，profile使用规范路径。系统临时目录、用户HOME/cache、作者输入、生成源码/build/config和外部手写树均不在write allowlist中。新建的symlink也不能把允许的写入根变成外部写入口；实际symlink逃逸probe必须被内核拒绝。
- 在解包/sbt前，用同一个wrapper运行 `javac -proc:none` 和独立 `TruthsrcSandboxProbe`。只有JDK11移除自身manager后真实网络/文件syscall仍拒绝、native子孙进程继承拒绝、evidence写入成功，才能继续。网络只探测loopback数字地址；不建立listener或外部连接，不使用DNS。不能把ECONNREFUSED、timeout、地址族不支持或Java `SecurityException` 当作OS拒绝证明；Python须为EPERM/EACCES，Java须为对应的OS socket/filesystem异常。
- canary由验证器在sandbox启动前，以 `mkdtemp` 创建在evidence的**新临时兄弟目录**中，不在任何允许写入根内。只对自有canary做实际写入/删除probe；不以任何用户源码作破坏性目标。evidence的 `boundary/escape` 是唯一明确记录的诊断symlink。probe、build前和finally都核对canary文件集/字节、该链接及profile/probe源摘要；保留目录，不自动清理。
- **所有顶层子进程**（javac、Java probe、Python供给提取、sbt）均由强制的 `/usr/bin/sandbox-exec -f <profile> <command>` 启动，native protoc、fork JVM与其他exec后代自动继承同一内核边界。receipt记录真实wrapper命令和profile SHA256；每次启动前检查profile未变。删除或替换SecurityManager、清空JAVA_TOOL_OPTIONS，均不能撤销继承的OS策略。
- 移除原Java-only `TruthsrcBuildGuard` 的启动安装。显式 `JAVA_TOOL_OPTIONS` 只传播本次缓存/配置位置，不承担隔离；`-XX:-UsePerfData` 避免外部perfdata写入，JVM错误文件指向evidence。sbt server autostart/supershell继续关闭。没有无效的 `sbt.trap.exit` 开关。
- sbt `set` 显式限定 Test unmanaged sources 为当前生成计划中的 `src/test/scala/*.scala` 文件，资源仅取生成的 `src/test/resources`。只在指定flag时运行 `Test / compile`，绝不挂载旧银行测试树。删除了编译不需要的 `set Test / fork`、`set Test / javaOptions` guard覆盖；不执行或改写 `UnitTestMain`。
- 提取supply的完整文件集/字节在build前后必须相同。自有缓存记录 `cache-before.json`（全空）和 `cache-after.json`（完整摘要）；缓存允许正常增长，**不是要求编译后的缓存仍为空**，也不访问或补用用户缓存。

**边界限制：**这是macOS当前可用Seatbelt的进程级网络/写盘隔离，不是通用容器或来源签名。读取和其它未禁止的OS操作仍是allow default；Node父验证器及admission的当前本地JS工具仍须受信任。JDK/Python/供给/native工具现在也在同一network/file-write策略内，但不声称防御任意恶意代码、OS漏洞或通过未覆盖的IPC攻击其他服务。evidence内的供应和缓存属于可写范围，故仍需摘要核对；文件盘点、协作独占与preflight也不是抗敌对并发替换的事务。

## 为什么仍不提供 generated test 执行

本次范围是服务编译和可选的生成测试源码编译，CLI保持 `--project-output` / `--archive` / `--evidence`、可选 `--java-home` / `--compile-generated-tests`。没有 `--run-generated-tests`、`--test`、`testOnly` 或通用sbt task参数。

原Java-only guard与生成 `UnitTestMain` / final `UnitNoNetwork` 的身份冲突不再是OS隔离机制的限制：Java manager更换不能放开内核网络/写盘边界。不过本次**没有运行生成测试或证明其完整运行兼容性**，不能把sandbox probe/编译回执升级为测试成功证据。将来若单独授权执行，仍须核查生成测试入口与存储配置、保持OS拒绝probe及后代继承，只运行已admission的生成测试，不追加历史测试或发布runtime。

## 回执、超时与失败处理

每个阶段以异步 `spawn` 启动独立 POSIX process group，stdin 关闭，stdout/stderr 直接进入 `wx` 独占文件；对应 JSON receipt 也在启动前独占预留。

- 阶段严格顺序执行：sandbox内javac上限45秒、真实OS边界probe30秒、extraction480秒、sbt480秒；任一失败即停止后续执行。
- 超时或 SIGINT/SIGTERM 向整个当前 group 发 SIGTERM，15 秒宽限后 SIGKILL；等待直接子进程 `close`/回收，不用 Promise.race 把仍运行的 JVM 遗留在后台。
- 直接子进程退出后仍有 group 成员也会清理并阻止 passed；另有最多5秒 group 消失轮询。只有直接子进程能由 Node 回收，不能声称回收任意脱离 process group 的后代。内核不能及时终止的进程也使这不是严格的总墙钟时限。

主要证据文件如下。

- `input.json`：本轮参数、当前真源/工具指纹、工具链（含sandbox-exec）摘要、初始空缓存记录。
- `sources-before.json` / `sources-after.json`：生成文件、手写树、本地 runtime 的 byte inventory；后者也包含提取 supply 的后盘点。
- `extract.stdout.log` / `supply-before.json`：整包校验及1065个实际提取文件的摘要。
- `cache-before.json` / `cache-after.json`：仅本次自有可变缓存的前后完整摘要。
- `sandbox.sb` / `boundary/` / `sandbox-before.json` / `sandbox-after.json`：真实OS profile、探测源码/类、允许路径、外部canary和控制文件摘要核对。
- `sandbox-probe.json`：实际syscall拒绝、移除Java manager后仍生效及native子孙继承的通过证明；不是build成功证明。
- `repositories` / `sbt.boot.properties` / `build-plan.json`：本轮离线配置、wrapper/profile摘要和真实sbt tasks。
- `{javac,sandbox-check,extract,build}.{stdout.log,stderr.log,json}`：实际sandbox wrapper命令、退出码/信号、timeout/cancellation/group状态和日志SHA256。
- `result.json`：本轮 `passed` 或 `blocked`、实际阶段、OS probe通过、源码/供给/canary/控制文件未变检查及有限scope。只有退出码0且最终回执为passed才是本轮build成功；空/缺失回执是未完成，不是成功。

路径/JDK/既有输出等最早前置失败可能发生在 evidence 创建之前，此时只返回 stderr 与非零退出码。创建 evidence 后的失败尽量留下 blocked 回执和盘点；没有 rollback、自动重试、全事务或自动删除。

若被阻断，先看该阶段stdout/stderr，再区分：输入/ownership漂移、supply缺失、JDK/架构不符、OS sandbox不可用/拒绝、Scala编译错误、超时或文件被改变。保留证据，回到相应真源/生成器/手写实现的授权修改面处理，再生成新candidate；不要手改生成build、放宽网络/源码write边界、借用旧缓存、启动数据库/服务或重新发布runtime来把本轮变绿。
