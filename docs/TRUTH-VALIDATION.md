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

## 未等同于本次通过的事项

当前离线Scala与生成测试源码编译另记其实际回执。未重新启动HTTP、生产
数据库、浏览器或1134多JVM恢复窗口；不把历史签收改写成新输入下已复测。
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

初次建树时缺bindings父目录，保留新树后续建；新增角色阶段初缺system
sessionOrder，结构门拒绝后只更新新系统声明；收紧decompose后遇macOS临时
目录别名，由工具使用真实temp路径修复。最终上述测试全部复跑通过。
