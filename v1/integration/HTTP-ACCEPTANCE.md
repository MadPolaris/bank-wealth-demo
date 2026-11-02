# 银行付款真实 socket 验收

最后更新: 2026-11-01

## 边界

`v1/test/scala/BankHttpAcceptanceMain.scala` 是独立集成 main，不是可发现的单元 suite。它使用真实生成的 `BankServiceComponents` 和 Akka HTTP listener、银行 `BankCashRequests`/`BankRuntime`/Saga/Monarch、独占 fsync LevelDB 与 H2 读侧。`UnitNoNetwork` 原样保留。

本项不是生产 `BankServiceLoader`/`BankServiceFactory`、Mongo/MySQL、TA 投资成功或整 P26/P31 验收。生产数据库与页面证据继续引用既有 853；指定强杀继续引用 883/934，不重复执行或混称。

## 实际量具

- HTTP listener 绑定 loopback port 0；生成路由处理实际 HTTP 请求，不调用 FakeRequest/EssentialAction 绕过 socket。
- 一次性 socket 代理读取客户完整请求并原样转发。代理收到上游完整成功响应后丢弃全部响应字节，客户收到 EOF/零字节；客户再用同 principal/clientRequestId/正文发起正常请求。
- 8 个线程经同一 barrier 释放同正文请求；另 8 个请求同时竞争同 key 的两种正文。每种正文各4个，必须一组全部200、另一组全部409，成功 ACK 唯一。
- 未认证、操作员购买、客户恢复、缺 CSRF 与十类机器/归属字段注入、重复 JSON key 均走真实 HTTP。拒绝前后完整持久库存相等。
- 第一 JVM 完成后关闭 listener、两个 ActorSystem、runtime、journal、读侧和线程池；控制器 wait/close 后才启动第二 JVM，同 LevelDB 新 H2，不复用前一 JVM 内存。
- 第二 JVM 对相同原请求重入，完整 serialized journal、sequence、serializer/manifest、原请求 HTTP 查询结果必须等第一 JVM。账户金额按实际竞争胜出正文计算，投资人/募集户守恒，恰三次 reserve/debit。
- 原请求 key 按 principal 隔离；另一客户同 key 查询无该原文，直接查原 order 必须403。

## 执行入口

`tools/v1-http-acceptance.mjs` 导出 `validateHttpAcceptance`/`runHttpAcceptance`，输入必须显式给出 Java、fresh ownedRoot、生成目标及实际 build receipt。运行前核完整 classes/JAR、生成源库存、银行外部源码与实际构建回执；不使用旧 classes 冒新源码。

控制器只创建新的 `bank-wealth-demo/.scratch/p26-p32-bank-v1-*/http-*`，不复用失败或成功目录，不修改生成源码/配置/build/spec，不删除 journal。

## 当前证据

证据根：`.scratch/p26-p32-bank-v1-59o__arv/`。

- 955：954基线恢复核验通过。
- 956：从完整936输入正式生成新 JS 目标。957/959完整单元133通过，961仅编译最终 HTTP main，不冒全量重跑。
- 958：测试 fixture 漏 bob/operator seed，被现有受信配置拒绝，未启动 HTTP。
- 960：Play便捷 `ServerConfig.apply` 隐式加载生产 `service.conf`，因缺 `PLAY_SECRET` 被拒绝；未连接生产数据库。之后改用显式 raw configuration 的完整构造器，不填生产环境变量或关闭校验。
- 962：JS exercise/replay两独立 JVM exit0/closed，响应丢失/并发/拒绝零事件/重入通过，16条持久流字节相等；异正文竞争本次200.00胜出，总额400.00、余额600.00/400.00。stderr均空，保留标准 ObjectIdOffset serializer WARN，不冒全部日志无警告。
- 963：正式生成新 BC 目标；965在未交付的新五kind测试创作期间编译失败，缺不存在的receipt字段；代理停止后主改为实际`payloadTxid`。966未执行。
- 968 BC、970 JS：统一银行Scala/测试源码下compile/Testcompile/完整140tests通过（133旧＋五kind4＋seed3）。同窗只独立Node工具/文档发生变更，未把整个源码库存冒为全时刻一致。
- 969 BC、971 JS：强化socket量具双链exercise/replay均exit0/closed，按提交正文及响应位置构造金额/原请求独立预期，完整成功ACK跨JVM相同，每原order source/settlement一次、每parent start/checkpoint/complete一次，完整PID集合排除被拒请求。另一客户完整空视图及直接order403通过。四JVM stderr空且无ERROR/异常模式；标准serializer WARN保留。
- 969竞争200.00胜出，余额600.00/400.00；971竞争100.00胜出，余额700.00/300.00。两者各三笔而非跨链同一调度结果；每链新JVM历史/ACK/GET完全相同。
- 975：新956/963生成文件实际锚、与各自938/939全部源字节稳定（仅repo归一）、35手写实际锚保持。

独立复核指出的金额oracle、完整响应/ACK、重复原请求事件、拒绝后污染、环境继承、字节码前后和响应framing问题已加强并实际执行969/971。controller对SIGTERM/INT转发TERM并15秒升级KILL/wait的分支已实现，尚未专门注入取消测试，不能扩称所有controller故障通过。

一次Bash工具stdout暂报ENOSPC/0MB，随后只读df复核同文件系统64GiB可用；没有清理文件，不将短暂工具错误当持续磁盘满。期间停止P32未验代理，代码保留由主接管。

本文件是验收说明，不是业务真源。最终统一源码窗口、两链核验、独立审查和原25包仍须各自证据；不以本main局部成功关闭P32。
