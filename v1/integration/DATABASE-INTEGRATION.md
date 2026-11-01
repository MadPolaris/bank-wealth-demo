# 真实数据库集成检查点

最后更新: 2026-11-01

本轮从754的3739源码基线继续，使用生成的 Play Loader、生产 `BankServiceFactory`、真实 Mongo journal、MySQL 投影，以及允许模拟的本地 MockTA。不是 `BankBrowserHttpFixture` 的拒绝写入桩。用户明确授权在验证后提交本轮自有成果；不推送。

## 实测部署约束

- 本机已有 MongoDB 6.0.3 镜像与锁定 ReactiveMongo 1.0.10/akka-persistence-mongo 3.0.8 不兼容：764启动返回 `Unsupported OP_QUERY command: find`（code352）。这不是依赖缺失或模板编译错误。该容器已停止，日志/数据保留。
- 本地验证改用已有 MongoDB 4.4 镜像，独占容器、127.0.0.1动态端口、每生成链独立数据库。4.4已停止支持，仅用于隔离演示验证，不能据此推荐生产部署。现代Mongo支持不在本轮冻结运行库的修改范围。
- MySQL镜像标签 `mysql:8` 的实际版本为8.4.11，image ID固定；没有下载。初始化必须等待TCP认证查询成功，不能仅以 `mysqladmin ping` 判断，后者可能在临时初始化服务期间成功。
- 未连接共享metarch-mongo27017，未占9000/2551，未清任何既有journal。凭证随机生成，仅写本轮0600私有配置，不进入源码/提交。

## 本轮发现与修复

1. 真实现金购买已执行、Mongo事件与MySQL投影可查询；同key重入保持原请求，正文冲突409。初次验证遗漏TA手控业务时钟，停在accepted，未误计投资成功；随后脚本通过既有操作员tick接口推进。
2. 原生产journal每个PID开实时尾读；多身份恢复时有限读取受阻。银行适配器改用按序号的有限current-events轮询，单订阅mapAsync(1)，拒绝gap、过滤批边界旧序号，关闭通过原kill switch。领域状态仍只由生成actor事件演进。
3. 原恢复循环只重挂执行，未调用现有同身份reconcile。新增内部恢复入口使用原持久化settlement重建同一runtime，再从真实协调器GetStatus取得identity；对非终态请求带受信machine token的reconcile，引擎仍拒绝活跃执行。不能仅筛RecoveryRequired，崩溃可能停在Preparing/Committing且本JVM执行开关未启用。
4. 恢复扫描仅读取包含业务来源的order/plan日志；发现失败不再让ready Promise永久挂起。技术宿主/运行日志仍由对应恢复逻辑读取，不改业务身份。
5. JDBC executor最后关闭，避免订阅取消回调在executor先关闭后被拒绝。启动失败/关闭仍使用本轮独占资源，不改变运行库。

新增 `BankAutomaticRecoverySpec` 和 `BankJournalPollingSpec` 验证身份准入/已终态不重开/中断commit恢复、有限轮询/序号gap。`BankProductionHttpMain` 为显式integration main，不是unit suite，不关闭UnitNoNetwork去启动数据库。

## 证据与边界

786 JS / 789 BC 的最终银行源码编译与全部单元测试均122/122；其中新增4个自动恢复准入测试和2个journal轮询测试。785完整银行输入4/4。公共生成器源码与754相同，因此继承该源码窗口BC1067/JS2332，不宣称本轮重跑公共全量。

- 787 JS从旧UNKNOWN/中断commit的原journal恢复，788再次新JVM重启；790 BC从独立干净数据库启动，791再次新JVM重启。四次均完成真实生产Loader/Factory、Mongo事件、MySQL投影、HTTP原请求重复/冲突409、TA确认、两期定投及订单HTML。
- 1000.00/0.00初始，现金100.00加两期10.00后880.00/120.00；保留本金、预留0、successTotal=2、failureTotal=0，重启重入不重复扣款/计数。
- 792/793在各链原数据库继续追加100.00购买，受信MockTA配置为rejected；自动独立退款完成，重复原请求不重复退款，余额回到880.00/120.00。TA配置来自测试部署，不由客户传forced result。
- 所有六个成功生产JVM均exit0、写closed回执，stderr没有关闭executor拒绝异常；794停止本人Mongo4.4/MySQL容器，数据和容器保留。旧Mongo6失败容器亦保持停止。没有常驻页面服务。

完整本机回执位于 `.scratch/p26-p32-bank-v1-59o__arv/`，最终源码/保护核验见 `DATABASE-VERIFICATION-795.json`。当前HTTP资金验证由客户端直接请求真实端点，不等真实Chromium驱动资金；754的Chromium仍只认证transport桩。

历史失败760、764、766、767/768、770/772/774/776、778完整保留。775为119/120、779为121/122：既有TA deferred-UNKNOWN测试调用resume时可能加入已在途且读取旧accepted状态的Future，修为既有有界eventually内重新调用并断言confirmed及零StageDone，不放宽业务结论。786/789最终通过。777运行中新增polling测试及纯格式变化，最终源码窗口以786/789为准。

原25包、真实浏览器驱动资金、多指定崩溃窗口/强杀恢复、退款中断恢复、CQRS清洁重放、P31文件1:N锚/源增量与P32可搬移delivery仍未认证；本检查点不是完整V1终验。
