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

## 未等同于本次通过的事项

当前离线Scala与生成测试源码编译另记其实际回执。未重新启动HTTP、生产
数据库、浏览器或1134多JVM恢复窗口；不把历史签收改写成新输入下已复测。
手写根未被生成器覆盖，文件级来源不冒称符号级认证。retry/backoff/deadline
保持 **OPEN**。BC全量作者切换尚需其owner裁定7项原stage冲突并协调现役消费。

## 保护与失败

V1逐文件SHA按`TRUTH-MIGRATION-EVIDENCE.json`复核；旧根树/六绑定/正式输入/
compiled/qualification/isolation/暂停runner/1134签出当前Git diff为空。README与
continuation的他人dirty未覆盖。实施验证期间未提交推送，也没有删除旧产物/日志。
2026-11-05用户随后授权本轮成果本地提交；只纳入本轮文件，README和continuation
继续排除，不推送/发布，提交号以本仓Git记录为准。

初次建树时缺bindings父目录，保留新树后续建；新增角色阶段初缺system
sessionOrder，结构门拒绝后只更新新系统声明；收紧decompose后遇macOS临时
目录别名，由工具使用真实temp路径修复。最终上述测试全部复跑通过。
