# 兼容分层与生成读侧：主线108实施记录

日期：2026-11-06。状态：用户选定的兼容分层与读侧生成已实施并验收；四流64测试、读侧47测试全部通过，当前教学输出233项计划已同步。

## 用户裁定

用户明确选择兼容迁移：允许必要手写接线调整，使生成仓储、读侧和Bootstrap被实际
消费；保持公开接口、原消息/状态载体、protobuf、PID、金融行为及冻结runtime。
旧发行、journal及独立业务测试不动。本地Actor仓储是具名兼容实现，不声称等于
BC cluster sharding。完整家族/差异表见[模板对照](../../metarch-truthsrc/TEMPLATE-PARITY.md)。

## 当前职责分工

- `BankRuntime`用生成的三类Repository查找/缓存实体，用生成Bootstrap创建Behavior。
  原`BankActorHandle`返回值、PID算法、spawn名字、运行图和关闭顺序保留。仓储不关闭
  ActorSystem；进程内创建/停止仍由BANK资源owner控制。
- 生成Entity负责原空状态初始化，生成application Behaviors负责命令处理，生成
  domain event handler负责唯一fold。旧domain类/伴生对象仍是兼容入口，未重命名
  JVM消息或PB。两种服务Loader均调用生成ApplicationBootstrap。
- `bank-service.formal.yaml`显式增加`projectionStore`，版本为
  `truthsrc.journal-readside/v1`。三类领域流、十种技术PID类型、原五张表结构、
  两类索引、查询键/排序、轮询/关闭期限都可定位于这份技术声明。
- 生成的`BankJournalReadsideSchema/Repository/Projection/Domain`负责真实DDL、SQL、
  事务、精确序号/正文检查、PB解码与既有fold、订阅和关闭排空。DDL同时生成到
  `conf/sql/BankJournalReadside.sql`。
- 手写`BankReadside`保留银行特定的trusted-admission、owner、pending/期次选择及
  查询DTO组装；以typed port调用生成读侧。旧JDBC/订阅实现已移除，不是给旧实现
  加一层生成包装。`BankReadsideSchema`仅导出生成Schema的兼容名字。
- `BankServiceFactory`本身无需改变：它原来构造的`BankReadside`现在使用新生成
  实现。所有公开构造函数/查询方法保持。六份说明性read-model没有被当成SQL DSL。

## 独立基线与允许差异

开始前固定TOOL `d1c1c8b`、BANK `21dc6c6`及全部生成计划、14产品、手写/业务测试/
本地runtime SHA。证据根：`/private/tmp/truthsrc-mainline-compat.7zDtHQ/`。

- `capture.json`、`plan.json`、`protected.json`为实施前捕获。
- `compatible-source-check.json`核验最终两个候选229份源码/配置完全相同。
- 所有原Protocol、VO、protobuf、serializer、converter/adapter字节保持。
- 14产品中仅artifact-contract增加指定的`bank-service.deployment.service.projectionStore`；
  排除这一精确新增槽后仍与独立旧基线相等。其它13产品不变。
- 只修改三份手写文件：`BankRuntime.scala`、`BankReadside.scala`、
  `BankReadsideSchema.scala`；其它32份及全部冻结`v1/test`和runtime不变。

## 已执行的读侧验收

候选：`target/truthsrc-compatible-candidate-20261106-03`。
回执：`target/truthsrc-compatible-readside-20261106-03/result.json`和
`readside-tests.json`。

- 9份protobuf，534份main Scala，11份Test Scala编译成功。
- **47测试／10Suite全部通过**：原23生成测试＋24固定旧测试；零失败/取消/忽略/pending/abort。
- 固定旧测试：投影6、shutdown1、查询授权7、request DTO3、页面7。
- 14项来源、实际staging、测试SHA、固定依赖、OS禁网/越界写及进程检查全部true；
  没有超时、取消或残留进程组，sourceBound=true。
- 实际使用独占内存H2/MySQL兼容模式与testkit；验证真实PB回放、重复/冲突/gap拒绝、
  索引失败时整笔事务回滚、owner验证、读时期次连接、水位失效和shutdown排空。
- 页面测试为直接Play action/renderer；不是HTTP server/body-parser/browser认证，
  也不是生产MySQL/跨JVM或1134重签。

执行命令（每次必须使用新的候选/证据目录）：

```bash
node tools/truthsrc-project.mjs generate --out "$PWD/target/<new-candidate>"
node tools/verify-truthsrc-build.mjs \
  --project-output "$PWD/target/<new-candidate>" \
  --archive "$PWD/dist/bank-wealth-v1-darwin-x64-1134.tar.gz" \
  --evidence "$PWD/target/<new-evidence>" \
  --run-readside-tests
```

该模式仅增加固定五份SHA测试及Test-scoped H2 2.2.224，不接受任意testOnly/runMain，
不挂全目录、不启动TA worker或服务，不改变原actor模式的41＋23测试。

## 四流、回锚与当前输出

`target/truthsrc-compatible-candidate-20261106-04`经
`target/truthsrc-compatible-actor-20261106-01/result.json`验证：534份main与14份Test源码
编译成功；原64测试／13Suite全部通过，15项检查全部true，无超时或残留进程组。
41业务测试覆盖付款、TA、独立退款、有限SIP，另23生成测试；未修改任何冻结测试。
其229份源码／配置与读侧测试候选03逐字节相同。两组23生成测试重叠，不相加冒唯一总数。

银行完整源变更／图／生成／反查／update集成6/6通过。当前`generated/current`先核原203
份计划文件无人工修改，再通过公共`--update --plan`／`--update`应用44项变化：30新增、
10源码兼容替换、4证据刷新，189项完全不变，无保留孤儿或强制覆盖。最终233项计划
（229源码/配置＋4证据）状态同步，源码与已测候选04相同；重复update零写入。
`ReserveFunds`仍落在规则核心；`reservedAmount`fold精确定位到
`domain/entities/behaviors/CreditBalanceEventHandler.scala:14`，反查`precision: span`。

工具基础回归最终重跑400通过／1跳过；最终选定生成/合同/映射139通过，构建/读侧准入
55通过，银行当前8通过／1集成项另已独立6/6通过，现役适配1/1通过。当前0.5.0本地tarball
离线安装到新prefix，独立Counter init/generate/status再次实测同步；没有npm发布。
验收明细与本地证据SHA索引见`TRUTH-COMPATIBLE-COMPOSITION-ACCEPTANCE.json`。

## 失败与修复留档

- readside-01在构建准入发现旧量具假设“一知识一文件一锚”；同一文件两个真实span
  导致拒绝，未进入JVM。校验器已改为核完整file/span集合及每段实际字节，不删锚消红。
- readside-02编译成功、46/47测试通过；唯一失败为原`account event identity mismatch`
  错误信息缺少kind前缀。修复生成模板，冻结测试保持原SHA，再用新目录复验。
- 独立review发现的query隐式建schema、look-ahead分页边界、catchUp同步抛错均已
  在最终候选前修复，并有对应生成回归测试。查询仍不触发schema写入。

所有失败候选及回执保留，不回填后续成功。retry/backoff/deadline仍OPEN，无runtime
修复/发布、旧数据迁移、共享应用写入或Git提交/推送。
