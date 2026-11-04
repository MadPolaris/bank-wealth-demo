# 当前真源候选的运行验收边界

日期：2026-11-05。本文针对统一作者入口后的候选，不是1134复演许可或新发行签出。当前结果见 [TRUTH-VALIDATION.md](TRUTH-VALIDATION.md)；生成单元测试的执行合同见 [TRUTH-BUILD.md](TRUTH-BUILD.md)。

## 相互独立的剩余门

银行运行验收不依赖BC七项作者阶段裁定；BC现役切换则必须等待明确裁定。不能将二者捆在一个“尚未统一”状态中，也不能用银行单元测试通过关闭BC门。

| 层次 | 当前可消费的入口 | 需要证明什么 |
|---|---|---|
| 当前生成单元测试 | 公共生成新候选后，`verify-truthsrc-build.mjs --run-generated-tests` | 固定五Suite／23测试、真实fork、testkit／禁网、输入字节不变。零测试的`GeneratedFiniteHostSpec`明确不算业务覆盖。 |
| F1–F4业务actor | 现有付款、TA、退款、SIP的测试断言，需为新候选建立显式测试闭包 | 本金、身份、幂等、结果分层、有限日程、首terminal等现行oracle不退化。不能用空状态/序列化测试替代。 |
| HTTP／读侧／页面 | 参数化的新候选驱动、独占本轮loopback和存储 | 真实入站、身份权限、GET无副作用、读模型水位及四流反馈。 |
| 真实数据库与生产Factory | 新候选＋独占Mongo/MySQL＋新凭据/schema | 生产composition、真实持久化/投影与重启，不只解析配置或使用testkit。 |
| 跨JVM指定恢复窗 | 新独占LevelDB/snapshot/TA journal及本轮进程控制 | 在明确barrier后停止本轮自有进程，恢复并继续原身份，不手发替代业务恢复。 |
| BC现役切换 | owner裁定七项后迁移，并对全部现役消费者切换 | 五产物全量保真、消费者只读新作者的机器派生物、旧树停止双写。兼容oracle不等于切换。 |

此前生成单元窗口不启动服务/容器、不开放loopback。用户随后再次要求继续，本轮新增下述固定四流actor窗口：仍无网络/服务/容器，仅本轮新TA子进程/journal。内存testkit重建actor不冒称磁盘或跨JVM恢复；HTTP/真实数据库/浏览器窗口仍未执行。

## 已定位的复用面，不是可原样重跑的旧命令

下列仅作为后续实现的源码定位，旧测试和驱动保持原字节；没有将它们挂到生成单元验证器：

- F1：[BankSinglePaymentOracleSpec](../v1/test/scala/BankSinglePaymentOracleSpec.scala)、[BankPaymentDeliveryAcceptanceSpec](../v1/test/scala/BankPaymentDeliveryAcceptanceSpec.scala)。真实actor/testkit，非跨JVM。
- F2/F3：[BankTaApplicationSpec](../v1/test/scala/BankTaApplicationSpec.scala)、[BankRefundApplicationSpec](../v1/test/scala/BankRefundApplicationSpec.scala)。需要TA Node子进程及自有JSONL journal，不只是银行testkit。
- F4：[BankSipApplicationSpec](../v1/test/scala/BankSipApplicationSpec.scala)、[BankSipRecoverySpec](../v1/test/scala/BankSipRecoverySpec.scala)。可复用有限日程、修订/暂停、派发/恢复断言，但须明确新候选测试输入集合。
- HTTP：[BankHttpAcceptanceMain](../v1/test/scala/BankHttpAcceptanceMain.scala)／[v1-http-acceptance](../tools/v1-http-acceptance.mjs)。历史窗口使用LevelDB、H2、真实loopback和手工Composition，排除TA；它不是生产Factory完整四流。
- 恢复：[BankCrashRecoveryMain](../v1/test/scala/BankCrashRecoveryMain.scala)、[BankSipCrashRecoveryMain](../v1/test/scala/BankSipCrashRecoveryMain.scala)及[v1-crash-recovery](../tools/v1-crash-recovery.mjs)。24个旧窗口可作断言依据，旧控制器路径/环境/回执不直接沿用。
- 生产存储：[BankProductionHttpMain](../v1/test/scala/BankProductionHttpMain.scala)、[BankMysqlNegativeMain](../v1/test/scala/BankMysqlNegativeMain.scala)。需要新资源窗口及显式测试源码闭包；不能将旧发行build回执改字段冒充当前编译。
- 浏览器：[v1-browser-funds](../tools/v1-browser-funds.mjs)。它可消费指定baseURL，但自身不证明运行应用来自当前作者候选，需要上层来源准入与独占控制器。

### 旧TA消费路径与本轮显式fixture

[v1-service-mock-ta-worker](../tools/v1-service-mock-ta-worker.mjs) 与 [simulator/journal](../simulator/journal.mjs) 各有旧路径白名单；原服务worker保持历史字节，不用于本轮。新窗口选择原Journal已允许的`.local/mock-ta`，不放宽其全局路径合同。

旧兼容入口[PersistentMockTA](../simulator/mock-ta.mjs)仍缺省经 [truth-source](../tools/truth-source.mjs) 的`loadSnapshot()`消费旧根作者树。本轮将原状态机原样抽到[显式配置核心](../simulator/mock-ta-core.mjs)，兼容入口委托同一核心；[新worker](../tools/truthsrc-actor-ta-worker.mjs)只读取具备来源的冻结fixture，运行时无旧snapshot兜底。fixture用于验证已接受模拟行为，不冒称它来自当前作者树；基金公司/TA继续是获准模拟，不需真实外部对接或新金融政策。

## 四流actor窗口（独立于服务/数据库）

用户再次要求继续后，本轮实现固定`--run-actor-tests`入口，仍使用公共新候选、
原`Test / test`／fork／UnitNoNetwork和同一次空缓存构建。它包含原生成23项，
加八个冻结业务Suite的41项，共13Suite／64项；不是整目录历史test discovery。

| 业务Suite | 项数 | 承接范围 |
|---|---:|---|
| `BankSinglePaymentOracleSpec` | 1 | 1000/0→900/100的真实三participant付款、精确PB和订单last commit。 |
| `BankPaymentDeliveryAcceptanceSpec` | 4 | 五类结果交付、原身份/目标、补偿/未知及同PID恢复。 |
| `BankPaymentRecoverySpec` | 1 | 原请求持久后真实runtime装配与重入；该例本身不重启JVM。 |
| `BankTaApplicationSpec` | 8 | 未付款拒绝、可信原请求、accepted/unknown/confirmed分层、worker重开与应用恢复。 |
| `BankRefundApplicationSpec` | 7 | 独立全本金反向Saga、原付款保留、同身份恢复、三phase自动RecoveryLoop及取消。 |
| `BankSipApplicationSpec` | 9 | 有限创建/入站、tick/修订/暂停、派发及首terminal/计数边界。 |
| `BankSipRecoverySpec` | 10 | 精确日程前缀、损坏快照拒绝、原occurrence/派发/修订/终态证据恢复。 |
| `BankSipCatchupJointSpec` | 1 | 真实现金链按序补期，不等待上一期TA终态。 |

原`v1/test/scala`八文件只读按绝对路径挂载，和本次生成的六个测试文件一起
逐文件核对；不复制、修改原断言或通过改业务期望消红。执行前检查实际
`Test / sources`十四文件及`definedTests`十三Suite，执行后检查全部名字、数量、
进程和来源。退款动态三phase的测试名明确展开，不能只用`test(`行数统计。

TA使用单一现有状态机核心，旧`PersistentMockTA(snapshot=loadSnapshot())`入口
保留兼容包装；新worker只导入显式配置核心，不导入旧loader或额外调用Git。
`test/fixtures/truthsrc-actor-ta.json`保存机械提取的七场景及历史文件/pointer/SHA，
标注`historical-frozen-test-fixture`，不是当前作者模型的一部分。运行时从该fixture
和本轮immutable config读取，不访问旧树。份额/NAV等模拟文本原样保留，不按金额
重新计算或虚构金融政策。

每次窗口独占新`.local/mock-ta/truthsrc-actors-<evidence-name>`；每项TA/退款测试
创建其直接`owner-b-application-*`子目录。只允许写该round，不开放整个mock-ta根。
OS仍无条件禁网，另拒绝读取旧两树、`.scratch`、`dist/v1`和`tools/truth-source.mjs`；
本轮config单独禁止写入。最终必须有15个journal、16次已wait且exit0的worker
（delayed例有一次同journal重开），无残留锁/进程。原journal内容保留，不清理或偷锁。

命令的路径必须是**尚不存在的本轮新路径**；当前生成测试模式的默认行为不变：

```bash
node tools/truthsrc-project.mjs generate --out "$PWD/target/truthsrc-actor-candidate-<new-id>"
node tools/verify-truthsrc-build.mjs \
  --project-output "$PWD/target/truthsrc-actor-candidate-<new-id>" \
  --archive "$PWD/dist/bank-wealth-v1-darwin-x64-1134.tar.gz" \
  --evidence "$PWD/target/truthsrc-actor-<new-id>" \
  --run-actor-tests
npm run test:actor-verifier
```

通过该窗口仍不关闭全部现行矩阵：银行journal/snapshot都是内存testkit，SIP部分
TA终态由测试命令驱动，不经过同一个外部TA worker；部分恢复是显式Reconcile，
另三refund例才是原RecoveryLoop。没有认证生产Factory、自动重试策略、HTTP、
SQL投影/页面或跨JVM恢复。实际执行结论只以[验证记录](TRUTH-VALIDATION.md)为准。

## 新资源窗口的必填边界

旧1134运行位已签出不等于本轮新窗口许可。后续执行前应记录并检查：

- 本轮owner、重型执行位1、全新candidate/evidence及已冻结的作者/工具/手写/runtime摘要。
- 具体允许的本地服务、端口、容器名、预存镜像、数据目录、schema及进程生命周期；不下载镜像/依赖、不触共享应用和他人资源。
- 只用本轮新凭据；不读旧环境/进程参数或发行scratch，不复用历史泄露凭据。敏感值不得进入日志、命令回执或Git。
- 启动、指定崩溃、重启和停止只针对本轮已确认所有权的PID/process group与容器；留下新证据，数据和失败目录不自动删除。
- HTTP/数据库必要网络应是另一份显式局部网络策略；不能在生成单元禁网profile上临时开洞，把两个窗口当成同一证据。
- 只使用明示的测试源和固定任务；禁止整个`v1/test`盲挂、全仓discovery、暂停qualifier和旧发行编排。

BC七项仍见 [COMPATIBILITY.md](../../metarch-truthsrc/COMPATIBILITY.md)。需要其owner明确`origin.stage`／`payload.stage`的含义及选择，不能靠技术迁移自动裁定；现役切换还需单独确定BC源/缓存/消费者写面。

**retry/backoff/deadline保持OPEN。** 本文不授权runtime修复/重发、共享`ingested-app`／`metarch-app`写入、1134覆盖重签或Git提交/推送。
