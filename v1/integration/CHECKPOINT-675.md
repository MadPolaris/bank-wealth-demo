# 银行服务双链本地集成检查点

最后更新: 2026-11-01

这是用户要求的阶段性本地提交，不是完整V1发行或P26–P32的25包终验。

## 已验证范围

- BC正式`scala-cqrs-play-service@1`生成、同份银行完整14产品输入、双链接口与外部源码挂载准入已通过。
- 645准入后646发A/B/C路径锁；A读侧/页面、B TA/独立退款、C定投/恢复均已交付并完成主会话本地集成。
- BC公共649：1041/1041；JS公共650–660：96文件2257/2257。
- 银行673（BC642目标）与674（JS639目标）：compile/Testcompile通过，各105/105。
- 675保存3394个源码指纹、六仓HEAD/index、旧40目标、冻结运行库和进程退出证据；676提交前核同源码与回执SHA。提交整理只更新文档状态，不改这组已测代码。
- `OWNERS.json`中的各owner status/existingSHA/deliverySHA保留646/662历史值；当前本地验证状态以其顶层verification和675回执为准。

本地证据目录为`../../.scratch/p26-p32-bank-v1-59o__arv/`，主要文件是`LOCAL-INTEGRATION-HANDOFF-675.md`、`LOCAL-INTEGRATION-675.json`、`PRECOMMIT-676.json`。运行日志、journal、构建目标和依赖JAR不随此源码检查点提交。

## 保留的限制与待修项

1. 页面控制器尚未挂到正式部署router；实际Mongo/MySQL、完整HTTP、跨JVM恢复、最终1:N回锚、合法源增量重演和P32干净交付未验。
2. 623实际依赖结果包含common-core传递的第二Mongo驱动和ReactiveMongo版本冲突。必须在正式服务profile解决并在新目标验证，不手改generated或重发运行库。
3. 提交复核发现JS服务继承的`finite-execution-dsl`/`durable-effect-host-dsl`在为部分非银行AnyFunSuite插入配置检查时，读取未声明的artifact-contract；还需相应footprint pin。静态复核已定位，尚未新增运行反例或修复；既有银行/Inventory测试通过不覆盖所有合法组合。
4. 两端生成的单元配置测试使用拼接的`service.connections.<ref>`查找；带点的合法literal secretRef会被当成嵌套路径。生产配置guard已使用ConfigUtil，但该测试模板伴随项待修和扩例。
5. 测试/正式输入依赖已许可的本地P23 Maven交付及锁定SHA；作者机器上的离线通过不证明新clone已具备依赖闭包。可搬移供应属于P32，不提交JAR，不下载或重新发布runtime。
6. 旧qualification runner、相关Node suite和qualification模板保持原样且不纳入本次提交，不修复或重启暂停流程。历史冗余formal inputs和服务goldens作为来源快照保留，不做清理。
7. KB既有#201断链及freshness告警、历史失败回执保留，不宣称全仓文档门或完整demo通过。

## 运行约束

只消费`0.2.1-p23.20261027.1`冻结运行库。状态仍由生成actor的event application演进。单元测试用testkit/独占本地存储；必要Docker集成已获许可，但必须独占资源和命名空间。无本轮远程push、下载、worktree、共享应用覆盖或运行库修改授权。
