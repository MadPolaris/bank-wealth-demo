# 当前真源候选：20261105-01 独占运行窗口

日期：2026-11-05。状态：**完成并归还资源：冷编译02、24个跨JVM恢复窗及最终数据库/页面窗口11全部通过。BC七项owner语义裁决独立待定。**

这是用户要求继续解决运行阻断后，本轮实际计划采用的资源合同，不是旧1134复演或新发行签出。机器可读配套为 [truthsrc-runtime-window-20261105-01.json](../target/truthsrc-runtime-window-20261105-01.json)。本文及配套JSON为本次docs-only新建；不启动任何进程或资源，不修改包、源码、测试、协调板或旧回执。后续执行、结果更新与资源签出由main负责。

## 1. 已登记事实与未执行状态

- 执行owner：`truthsrc-unification-runtime-20261105`；本轮资源前缀：`truthsrc-runtime-20261105-01-`。
- BC [AGENT_COORDINATION.md](../../backkend-codegen/AGENT_COORDINATION.md) 第127行运行位、第156行心跳已登记；开始时间为 `2026-11-05 08:23 +08:00`，状态是 `preparing,no service started`。本任务仅读取这两项登记，不修改或代签出。
- main交接的最近现场检查为 **2026-11-05 08:24:28 +08:00**：无JVM、18761/18762/18763监听、容器或网络冲突，MySQL/Mongo固定镜像已在本地缓存。本docs任务未重新执行进程、端口或Docker检查；该时点检查不是启动时的持续锁。
- **重型执行位总数为1**。构建、运行阶段及恢复JVM依次执行，不因委派helper增加并发重型位。
- 初始准备阶段只记录计划；当时未采集的摘要/PID/计数不由历史证据代填。现已完成的实际结果见文首及验收说明：冷02、crash02和最终database11均有本轮独立回执，准备段落不再代表当前执行状态。

## 2. 独占路径与离线供给

银行根为 `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo`。下表均为规范绝对路径。

| 用途 | 本轮唯一位置 |
|---|---|
| 新候选 | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-runtime-candidate-20261105-01` |
| 冷构建证据/独占空缓存 | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-runtime-build-20261105-01` |
| 运行证据及本轮私有运行子目录 | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-runtime-run-20261105-01` |
| 新TA round | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.local/mock-ta/truthsrc-runtime-20261105-01` |
| 只读冻结依赖归档 | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/dist/bank-wealth-v1-darwin-x64-1134.tar.gz` |

归档唯一允许的完整SHA256为：

```text
95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade
```

供给提取、fresh candidate准入、空缓存、实际sbt staging来源对账、classpath封存及原输入字节保护沿用 [TRUTH-BUILD.md](TRUTH-BUILD.md) 和固定runtime编译清单的合同。不使用用户warm缓存、旧发行scratch、旧运行数据或下载兜底，不重建/发布冻结runtime。main在生成和构建前冻结最终输入；本文件没有声称已计算本轮输入摘要。

上述候选/证据/TA目录首次使用前必须由main检查不存在且父目录真实、无路径别名或symlink越界。已存在则停止，不清空或复用；后续尝试另取新窗口。运行阶段只读消费本轮封存classpath，不临时挂入旧class或追加测试源。

## 3. 数据库、端口和实际命名合同

**必要的Docker集成属于本轮明确允许的测试存储层，不是把所有单元测试改为Docker。** 单元继续使用testkit/禁网；跨JVM恢复使用本轮独占LevelDB、snapshot和TA journal；生产存储/Factory验证使用下列全新Mongo/MySQL。

| 服务 | 唯一允许的宿主端点 | 已登记的本地镜像pin |
|---|---|---|
| HTTP/API/页面 | `127.0.0.1:18761` | 本轮冷构建的新候选，不运行共享应用 |
| MySQL | `127.0.0.1:18762` | `sha256:8eccfc5e5aebbf3a49375b13956a88cd244d13ac6b25b52dec792b7526363b19` |
| Mongo | `127.0.0.1:18763` | `sha256:0010f63d26952bd3960fac5513c64a1cf7d6299f31fa7b54ac1b36633ee04333` |

- 数据库helper只新建两套资源：MySQL、Mongo各一个新容器、各一条**彼此分离的internal网络**，各自全新数据、数据库/schema及凭据。不得接入共享/default外联网、共享volume或旧数据库；不把两套数据库接在同一网络。
- Docker资源携带 `bank.owner=truthsrc-unification-runtime-20261105` 与随机的本轮 `bank.runtime` 标签。实际名称为 **`truthsrc-runtime-20261105-<本轮随机标识>-<kind>`**，两数据库各自独占网络。控制器只按亲自捕获的ID和两标签检查/停止，不按前缀认领已有资源；具体ID和数据目录以本轮回执为准。
- 所有Docker启动使用 **`--pull=never`**；只消费上述缓存pin。缺镜像、pin不符或无冲突确权失败即blocked，不pull、不build镜像、不下载依赖。
- 宿主只监听上述127.0.0.1端口，不绑定`0.0.0.0`或其它地址。当前Docker Desktop在`--internal`网络没有实际发布宿主端口：database03两库ready后，正向连接probe确实ConnectionRefused，未放宽为默认外联网络。database04起保留两库各自internal网络、取消无效publish，使用本轮Node的18762/18763 loopback socket经仅针对已核容器ID的`docker exec`双向字节流进入容器localhost；通道不保存协议内容/密码、不增加容器网络。停止时先关闭并wait全部本轮relay exec，再停容器，仍保数据。不得占用/操作宿主 `9000/2551/27017/3306`、共享容器/网络或共享应用。
- 新数据、LevelDB/snapshot、私有配置/凭据放入本轮自有运行私有子目录，TA只写表中round。main/helper在资源启动前封存具体路径与权限；不因此开放整个`target`、`.local/mock-ta`、用户HOME或旧scratch写入。

## 4. 固定验收范围，不以数量替代结果

### 冷编译

新候选的应用及原手写实现编译，另以 `--compile-runtime-tests` **只编译**六个当前生成测试源和以下五个只读冻结main，精确核对实际11文件测试源码闭包及classpath。该模式不执行单元测试，也不启动服务。

五个main均位于 `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/v1/test/scala/`，package为 `example.bankwealth.service`：

1. `BankProductionHttpMain.scala`
2. `BankMysqlNegativeMain.scala`
3. `BankHttpAcceptanceMain.scala`
4. `BankCrashRecoveryMain.scala`
5. `BankSipCrashRecoveryMain.scala`

名单依据 [truthsrc-runtime-tests.mjs](../tools/truthsrc-runtime-tests.mjs)。不挂整个`v1/test`，不全仓discovery，不运行暂停qualifier、旧domain-runner或旧发行总编排。

### 冷编译通过后的独立运行门

| 门 | 本轮计划及证据要求 |
|---|---|
| 指定跨JVM恢复 | **计划24个case、每case三次JVM，共72次JVM**，顺序执行。保留原case/oracle，逐case绑定原身份、barrier、崩溃与后继恢复、资金/终态断言和退出证据；72不包含构建/其它运行JVM，也不是已启动计数。不能以手发替代业务恢复冒充原恢复路径。 |
| 生产Loader/Factory与真实存储 | 使用新候选的生产Loader/Factory及本轮Mongo/MySQL，验证付款、TA、独立退款、有限SIP四流和持久化/读侧/API；不以手工composition、testkit或配置解析通过替代。 |
| HTTP/API及页面 | 在18761验证真实入站、权限、GET无副作用、水位和四流反馈。浏览器仅使用已安装工具；无已安装浏览器时如实记`not-run/unavailable`，不安装、不下载，也不用API结果冒充浏览器通过。不得为浏览器增加调试监听端口。 |
| MySQL负例 | **计划5个固定负例情景**，只作用于本轮新数据库/配置，逐例保留预期拒绝与实际观测；不是MySQL版本号，也不是已通过计数。 |

TA继续使用获准模拟，不要求真实基金公司对接。付款成功不等于投资成功；退款保持独立反向事务；有限SIP及原首terminal/身份/oracle不得简化。

原业务源码、冻结测试/oracle及runtime保持只读。执行适配仅限main另行负责的新控制器和必要的最小actor协议抽取，不改变业务语义、原测试或断言，不修复/重发runtime。本docs任务不实施任何这些源码改动。

## 5. 隔离、凭据和证据

- 冷构建、原生成单元/actor窗口继续使用**全部网络拒绝**的原OS profile；不临时改它来运行HTTP或数据库，不关闭原fork/UnitNoNetwork。
- live HTTP/DB使用独立的 `host-local-reserved-ports` profile，按方向只允许本机IPv4的18761/18762/18763，禁止远程地址、IPv6、UDP/DNS及其它端口；冷构建和跨JVM恢复仍全禁网。**这台macOS的Seatbelt只支持localhost主机谓词，它也匹配wildcard及本机接口地址，不能冒称内核精确强制127.0.0.1。** 已固定的应用源码/配置以及实际listener和Docker发布检查另行要求127.0.0.1。该窗口针对受信任的来源绑定代码，不是恶意代码exact-IP沙箱。独立实际探针已通过57项EPERM拒绝、父子孙继承和18761 loopback往返，证据`target/truthsrc-runtime-network-probe-a6388f71ceb4/final-check.json`；没有无sandbox回退。
- 只生成本轮新凭据；secret文件权限为 **0600**，私有目录限制为0700。不读旧凭据、进程args/env或泄露配置，不把秘密放在可记录的命令行或回执中。
- stdout/stderr、数据库错误、API/浏览器材料必须**先脱敏再持久化**；不能先落raw log再删除/覆盖。回执只存非秘密元数据、必要的脱敏断言、源码/profile/制品摘要与生命周期证据。凭据、原始journal、数据库数据和私有配置不进入Git、回执正文或可转交归档；不递归重打包运行后的`dist/v1`。

## 6. 有界生命周期、失败保留与归还

1. main在每阶段启动前重查本轮占用、freshness、实际资源名/pin和隔离边界。只记录本轮创建的PID/PGID、启动身份、case及资源ID；不能凭同名进程认领所有权。
2. **指定崩溃信号只能发送给THIS main-owned crash JVM，并且必须先验证并记录该case的确切barrier。** 不能根据sleep推定到达barrier，不能杀共享/旧JVM，也不能用全局`pkill`/按名称清理。
3. 各阶段必须有明确有界timeout。超时/取消仅回收当前自有process group；先SIGTERM、有限宽限后才按既有控制器规则升级，并等待直接子进程、检查残留。超时清理与有意barrier崩溃分开记账，前者不能计作恢复case通过。构建时限沿用TRUTH-BUILD；运行具体时限由main在启动前固定。
4. 正常或失败均在finally中优先graceful stop本轮HTTP、TA worker及其它自有服务，并stop本轮自有数据库容器，核对退出/残留。无法确认停止则如实记录未归还，不签出成功。
5. **永不删除journal、数据库/data、网络或旧回执。** 容器停止后保留，失败目录、快照和新证据也保留；不`rm/prune`、不重置数据、不清理旧资源。新尝试使用新名字，不覆盖任何既有exclusive receipt。
6. main完成实际清点后更新本轮结果并在协调板归还自己资源；本docs任务不更新结果或签出运行位。缺证据、未运行、失败和unknown保持区别，不发布虚构通过数量。

## 7. 已执行的准备门与保留失败

- 首次runtime01编译9PB/499main/11test成功，classpath校验误将Play的public/test期待为public/main而blocked；修正只涉及新校验器，旧回执保留。
- 最终runtime02（candidate/evidence均为`20261105-02`）重新冷编译通过，build66.540秒、14checks true，194classpath/189JAR已封存，真实运行消费者准入通过。本文第2节的01路径是首次计划，不覆盖该新结果。
- Node明确合同组合`npm run test:runtime-verifier` 371/371通过，无跳过；银行当前源合同5通过/1完整生成集成显式跳过，保留validate/roundtrip/14产品检查。不是重跑前轮完整文件变更教学集成。
- crash01首case达到barrier并按许可SIGKILL，TA EOF正确关闭，但监督器把过渡期EPERM当终止错误，失败保留。修正为仍可能存活并等待真实ESRCH后，新crash02启动全部固定24窗；运行期间应用/测试/工具输入冻结，不用01补跑或改回执。

- crash02已实际24/24通过，72主JVM/72TA worker、509.445秒，全部来源/输入/进程检查通过，无timeout/锁，全部归还。
- database01只到MySQL初始化：容器内Unix socket放在macOS宿主bind数据目录，出现MY-010270 `Bind on unix socket: Invalid argument`，未到Mongo/HTTP/browser。该MySQL容器及内部网络保留、容器已停止，owner/run双标签及Running=false核验，未删除数据。仅把新一轮socket/PID移到容器local `/tmp`，不改数据库文件或应用；新的database02独占根继续验证。

- database04的Python连库probe通过后，生产Java NIO栈被tcp4限制拒绝（EPERM）。同profile独立JDK A/B明确默认栈失败、preferIPv4Stack=true往返成功且port1仍拒绝；显式选择IPv4，不扩大policy。首独立probe发现证据目录扩展名regex转义不正确，改`[.](class|jar)$`并加入实际父子孙新建拒绝验证。原class/config显式保护及冷编译交接不变。

- database07已实际完成initial生产浏览器/现金+SIP、随后正常新JVM重启的GET-only查询；restart前后Mongo全数据库摘要相同（没有GET副作用）。其余退款/重放/MySQL负例未完成前仍不记全通过。

- 当前exec relay使用Docker本地Unix socket API的无TTY二进制流，不再每连接启动Docker CLI，exec ID逐一检查归属容器并等待Running=false。网络边界与凭据不变。旧CLI relay的真实字节/EOF测试单列历史；当前API控制路径拒绝反例和实际数据库消费分别验证。

## 8. 独立未决事项

**BC仍需owner明确七项作者阶段中`origin.stage`与`payload.stage`的语义/选择及现役切换写面；这不阻塞银行本轮独占运行窗。** 银行运行成功也不能代替BC裁定或证明BC现役已切换。

retry/backoff/deadline继续 **OPEN**，不因本窗口改为已接受限制；1134原签收、冻结P23制品及共享应用不变。此合同不授权Git操作、发布、下载或扩大业务范围。初始PREPARING状态已由实际冷02/crash02/database11回执更新为完成，最终归还另记独占回执，不追改初始机器记录。
