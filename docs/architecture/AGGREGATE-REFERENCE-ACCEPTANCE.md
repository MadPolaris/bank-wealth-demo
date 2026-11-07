# 聚合参考与首个公共工具回流验收

日期：2026-11-07。对应本轮公共模型/模板切片与手写来源验证，不是银行完整service或R2验收。工具起点`06859b364373`，银行起点`dcd6ae49da48`；验收捕获时尚未提交或发布，后续提交状态以各仓Git历史为准。

## 设计依据与交付

用户明确：BC mjs产物结构未经打磨检验，不属于金样。成熟BC Scala模板和参考代码提供设计依据，独立Warehouse候选与测试验证当前兼容结构；机械通过不代替用户对新金样的批准。公共[参考开发说明](../../../metarch-truthsrc/docs/artifacts/scala-cqrs/REFERENCE-DEVELOPMENT.md)记录职责、开发过程和限制。

- 聚合生成拆为不可变结构模型、集中兼容命名及逐职责模板；State/Entity默认值模型独立。
- 当前兼容的公开State/Event/Request/Reply、PB/PID、codec、金融政策和运行库坐标不改；不借排版移动旧载体。
- 七份独立参考源码在工具仓`test/reference/aggregate-layers/warehouse/`，并有从既有inventory fixture生成独占候选的`stage.mjs`。参考不是完整银行样例，也不是另一棵业务真源。
- 手写来源验证回流公共`lib/handwritten-provenance.mjs`。银行wrapper只保留当前snapshot、35文件/54引用及关系/schema政策，不再导入旧发行helper闭包；手写源码和映射JSON不改。

## 已执行的验证

| 验证 | 实际结果 |
|---|---|
| 公共完整Node回归 | 3136测试：3121通过、15明确跳过、0失败；1082相关文件执行前后指纹一致 |
| 聚合参考/模型/反例命令 | 36通过 |
| artifact文档检查测试 | 28通过 |
| 公共来源验证＋银行新适配＋旧来源suite | 20＋6＋3通过，无跳过 |
| 独立参考及实际生成Scala | 两套独占目录分别编译通过，各24测试成功 |
| 安装后的公共API | tarball离线安装并移动prefix后，非银行单文件来源验证通过；Counter生成/查询仍通过；教学同步后的目录/安装组合35项通过 |
| 最终跨仓来源与兼容说明 | 8仓3164个来源复核通过；BC50/Play32份兼容文件检查通过 |
| BANK Actor候选 | 534 main/14 test源码编译；64测试/13Suite通过，15保护检查通过 |
| BANK Readside候选 | 534 main/11 test源码编译；47测试/10Suite通过，14保护检查通过 |
| 两BANK候选对账 | 229源码/配置逐字节一致 |

64与47中有23项生成测试重叠，不能相加当作111个不同测试。Actor模式还执行原固定41业务断言。空的GeneratedFiniteHostSpec不作为额外覆盖。

独立参考测试采用identity adapters隔离行为，关闭testkit序列化，不能证明PB。BANK候选则使用原生成adapters及固定供给，实际执行现有PB状态/精确值往返和固定金融断言。二者保证范围分别记录。

`PersistenceReplySpec`让AsyncWriteJournal写确认保持未完成，观察没有回复，再完成确认并验证Accepted与状态；它验证回复边界，不是持久存储或跨JVM故障认证。外部五种结果的期望状态独立固定，仓储测试核对传给行为工厂和spawn的真实ID/PID/Behavior。

## 本地证据

- Actor候选：`target/truthsrc-aggregate-reference-20261107-01`。
- Actor回执：`target/truthsrc-aggregate-reference-build-20261107-01/result.json`、`actor-tests.json`。
- Readside候选：`target/truthsrc-aggregate-reference-20261107-02`。
- Readside回执：`target/truthsrc-aggregate-readside-20261107-01/result.json`。
- 工具证据：`metarch-truthsrc/.rounds/aggregate-reference-pm3MAM/`中的`js-full.log`、`full-test-source-before.json`、`full-test-source-after.json`、`scala-05/execution.json`、`bank-final.json`、`complete-compatibility-delta.json`、`bank-compatibility-delta.json`。

这些目录是本机执行证据，不承诺新clone自动取得。公开源码含可复现测试/构建入口，但JDK、依赖与冻结银行供给仍需明确提供。

## 教学输出与回锚

`generated/current`在确认原库存无手工修改后，经公共`--update --plan`预览，再经公共`--update`应用：233项中22项写入（21个聚合源码＋1份输入证据）、211相同、0 retained/kept、0 MANUAL合并。全部229源码/配置与已验Actor/Readside候选逐字节一致；重复update的233项全部相同、written=0。

当前status为`synchronized=true`、`inputs=current`。`ReserveFunds`正查得到8个真实代码落点；新的`application/aggregates/behaviors/CreditBalanceBehaviors.scala`第26–27行在精确UTF-8 span内，第27行反查返回当前`outgoing-funds.structure.yaml`中的ReserveFunds知识。没有手改ledger、anchors或SQLite库；旧回执没有重新签名。

## 仍保留的设计差异

本批建立的是当前兼容聚合参考，不是全新标准profile。旧domain Actor入口仍转发到Bootstrap，Entity/应用Protocol仍别名引用原载体，本地Repository仍是具体类；新运行库、多模块及其它生成家族尚未取得同等参考资格。格式对照是七份完整源码的确定性比对，不是通用Scala AST/类型解析器。空事件成功路径没有新增独立参考运行用例，不把库调用形状或其它成功用例当作这一用例的实测。

## 失败、审阅与未完成

初始模型测试因尚无builder失败；独立参考对照拒绝五处不同源形状。初始Scala两套均编译通过，但测试启动缺少手工classpath中的Akka serializer依赖；补齐已缓存依赖后使用新目录重跑。原失败日志保留，不回签。

额度不足时的代理失败不是审阅通过。恢复后独立审阅无已确认新增聚合缺陷；补强了复杂默认值、完整命令来源对应及延迟持久化回复测试。后续并行审阅发现的公共JSON数字限制、Windows根路径、Node22.13兼容API和测试预期独立性均已修正并回归。Windows原生运行、Node22.13实际执行不在本轮环境内，不冒称已验。

整个P1/P2仍未结束：其它公共运行/租约/报告工具尚未回流，所有renderer的统一命名、新多模块标准及strict Saga/R2参考仍待独立实施。银行service02的新SQL读库replay阻断、材料公开取得、真人上手和retry/backoff/deadline债务保持原状态。本轮没有启动服务/数据库容器，没有更新运行库或修改旧journal/失败回执。
