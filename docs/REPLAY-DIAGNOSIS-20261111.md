# P23 新读库重放：并发修复与当前验收边界

当前结论：生成的兼容读侧有两个已复现的并发缺陷，修复后银行新候选的固定读侧47项通过，运行集成源码也已冷编译。**尚未证明这些缺陷就是 service02 的90秒超时根因，也尚未关闭完整服务门。** 当前 Docker 守护进程不可连接，没有启动或重启共享服务。

## 已确认和修复的机制

公共生成器 `scala-cqrs-play-service` 保持当前 P23 合同，没有切换 Monarch R2。

- 同一 PID 的多个 `catchUp` 调用原来各自读取和投影。定时器只等待提交 Future 的 Runnable，不等待该 Future，因此慢读取期间可以重复提交。现在同一 PID 共享一次进行中的采样，其他 PID 仍可独立推进；完成或失败后才释放该项。
- 较早采样若晚于较新水位完成，原 `observe` 会将已经有效的较新观测清空。现在旧的成功样本不撤销新观测；新事件追加、显式失效及采样失败仍撤销 freshness，不能用旧样本认证新 checkpoint。
- 失败处理在共同进行中的操作内等待失效写入，关闭会等待其结束；失效处理再次失败时保留原异常，并附加 cleanup 异常，不以清理错误掩盖初始化或采样错误。

namespace 写事务、连续序号、重复事件的精确类型/manifest/字节校验、watch 从零重放、投影语义和原时间限制均保持。没有为了通过而修改金融 oracle、增大线程数、加连接池、去掉锁或扩大超时。

## 新的诊断证据

`tools/verify-truthsrc-runtime.mjs` 在现有 readiness 轮询中保留有界、脱敏的独立 `readiness.json`：

- 固定90秒、每次请求最多5秒、间隔最多300毫秒；成功仍要求 HTTP200、`caught-up` 和账户存在。
- 记录每次状态、起止耗时、账户是否存在，以及最多16个 PID 的 checkpoint/observed/disposition。未知或不安全整数不伪造精度；超出记录上限明确给出省略数。
- 只保存明确允许的元数据，不保存响应正文、认证头、凭据或异常原文；body 有256KiB上限，取消信号结束当前请求。
- 保持此前 `Response.json()` 的 UTF-8/BOM 解码语义；readiness 证据路径由子进程沙箱禁止写入。

旧 service02 未记录最后 HTTP 响应或水位趋势，不能从现在新增的诊断倒填旧证据。其 replay JVM 为5739、HTTP端口19781；这些是已退出的历史身份，不是当前可操作进程。

## 实际验证

| 对象 | 本轮结果 |
|---|---|
| 独立 Scala/Akka/H2 并发回归 | 最终11项通过；旧模板的并发、旧样本撤销和失败失效反例按指定断言失败，原异常身份回归也验证了修复前后差异 |
| 当前银行作者 | validate 零 hard errors，157原子 roundtrip 通过 |
| 银行新读侧候选 | 534 main、11 Test Scala 源冷编译；固定47测试、10 suite全部通过，14项来源/供给/隔离检查为true |
| 银行新运行候选 | 534 main、11 Test Scala 源冷编译；runtime classpath和14项检查通过；该模式没有运行服务 |
| 两新候选生成对账 | 229源码/配置逐字节相同；相对原 `generated/current`，仅 Repository、Projection 两个生成文件变化，无删除 |
| 原手写实现、固定测试及P23供给 | 保持原字节；没有重新发布或替换运行库 |

新候选/构建位置：

- `target/task169-offline-20261111-03-readside-{candidate,build}`
- `target/task169-offline-20261111-03-runtime-{candidate,build}`

运行构建的 code/schema/profile 成果与独立控制器诊断分开；源码或工具指纹以后变化时，必须重新准入，不能仅因该目录存在就复用。

本机详细证据在 sibling 工具 `.rounds/pending-progress-20261111-jpao_rv0/`：`concurrency-review-*`、`task169-offline-20261111-03/result.json`。这些是本机审计材料，不是公开下载渠道或新 clone 的必备附件。

## 保留的失败

- 首次外层临时执行 scaffold 将进程组探测的 `EPERM` 直接列为终止错误；prepare 自身exit0且没有写供给文件，但外层失败，未开始编译。
- 第二次给已经自行施加 Seatbelt 的 build verifier 再包一层 sandbox，内层 `sandbox_apply` 被系统拒绝，javac尚未执行。该失败保留；随后使用已有 workshop 的 plain outer，由原 verifier 保持每个编译子进程的强制沙箱与固定期限，第三次才通过。
- 新控制器测试中曾重复登记已存在的 callback 来源，唯一性准入正确拒绝。去掉多余登记后复验；没有删除实际来源保护。

这些执行/测试失败不改签为成功，也不构成银行业务行为失败的证据。

## 尚未关闭

原 [service02验收](V1-RETIREMENT.md#service02-最终结果与独立待办)和机器回执仍原样保留。下一次实际数据库诊断须使用新 owner、独立数据库/凭据/namespace和当前准入的构建，采集上述状态，保留90秒要求及付款、TA、独立退款、有限定投断言。

完整服务、MySQL五项负例、真人会话和材料取得渠道仍分别未完成；retry/backoff/deadline仍为 **OPEN**。本轮不实施银行R2迁移、BC默认切流、运行库发布或共享生成应用改写。`generated/current` 未更新，不冒称其已经同步新的两份生成源码。
