# 当前架构与手写边界

日期：2026-11-07。这里解释当前职责，不是运行验收回执。唯一作者合同见[TRUTH](../../TRUTH.md)，旧合同固定在[历史索引](../HISTORY.md#architecture-contracts)。通用产物说明已集中在公共JS工具的[Scala CQRS artifactType目录](../../../metarch-truthsrc/docs/artifacts/scala-cqrs/README.md)，含多模块port/binding、BC JS最终产物和Saga/Monarch版本；本目录只保留银行专属装配及手写边界，不维护另一份公共类别规范。

## 从作者到运行

```text
truthsrc.project.json + truth/bank-wealth/ + bindings/implementation/
  → 公共编译 / 14语义产品 / 知识图导出AST
  → 生成工程 + 独立挂载handwritten/scala/
  → 命令校验与决策 → Event持久化 → event application更新State
  → 生成JDBC读侧 + 银行业务查询端口 → API / 页面
```

| 层/构件 | 当前职责与消费边界 |
|---|---|
| 生成领域与应用层 | Protocol/Entity、命令Behaviors、事件fold、Bootstrap及本地Repository；`BankRuntime`已实际使用生成Repository与Bootstrap，不是只生成闲置文件 |
| 生成读侧基础设施 | `bank-service.formal.yaml`的显式`projectionStore`驱动Schema、SQL、事务Repository、PB回放、checkpoint、订阅及关闭排空；`BankReadside`通过typed port实际消费 |
| 银行手写业务 | trusted-admission、资源owner、pending/期次选择、查询DTO组装、TA/退款/定投适配、endpoint与页面；`BankReadsideSchema`只保留兼容名称 |
| 生成服务装配 | 类型化服务端口、Loader、路由与配置；页面renderer及银行endpoint实现仍为手写，不是全前端自动生成 |
| 独立验收 | `test/scala/`固定业务、读侧、HTTP与恢复预期；按各模式显式manifest挂载，不整目录追加，不为生成结果改oracle |

本地Actor Repository不是cluster sharding。六份说明性read-model不是自动SQL DSL。生成代码由调用者指定目标承载，构建期ScalaPB managed sources与truthsrc直接生成库存也要区分。兼容接线及其原候选证据见[TRUTH-COMPATIBLE-COMPOSITION](../TRUTH-COMPATIBLE-COMPOSITION.md)，不自动认证目录迁移后的候选。

2026-11-07的[聚合参考与工具回流验收](AGGREGATE-REFERENCE-ACCEPTANCE.md)记录独立参考、结构模型/模板、公共手写来源验证，以及新候选Actor64/Readside47结果。BC mjs仍不是设计金样；新参考是有明确兼容例外的工程候选，不是通过文档登记自动成为标准。

## 保持的分层与事务规则

- **Onion：**内层不依赖外层；端口显式声明，银行装配调用实现。业务状态只经事件应用演进，手写adapter不能另建资金状态机。
- **Saga：**跨聚合Prepare / Commit / Compensate及结果核实。已Commit付款后的独立退款是另一事务，不能改写原付款事实。
- **Monarch/pipeline：**阶段队列、执行游标与恢复续接，不是Saga事务的同义词。付款成功、TA确认与退款完成分别观察。
- 保留公开接口、消息/状态载体、PB、PID、codec和`0.2.1-p23.20261027.1`冻结runtime。retry/backoff/deadline仍[OPEN](../TRUTHSRC-CONTINUATION.md#3-重试挂账open未修复未接受限制)。

## 本目录和源码映射

- 本`README.md`：当前职责与导航。
- [`HANDWRITTEN-SOURCE-MAP.json`](HANDWRITTEN-SOURCE-MAP.json)：当前快照、35份手写文件与54条实际来源引用的显式映射；[验证方法与精度边界](HANDWRITTEN.md)。
- 映射中的`implements / supports / legacy-adapter`是人工声明的关系，不是生成器自动读懂手写语义，也不能冒充生成文件的精确span认证。原版本可从`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/HANDWRITTEN-SOURCE-MAP.json`读取。
- 源码在仓根`handwritten/scala/`，固定测试在`test/scala/`，许可在`third-party/`；历史输入/合同不再与现役源码混放。

目录迁移和来源定位的实际结果见[本批验收](../V1-RETIREMENT.md)；运行门与文件映射门分开，不由目录说明推定服务通过。

## 固定历史合同

- [CONTRACT](../HISTORY.md#contract)：`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/CONTRACT.md`。
- [IMPLEMENTATION](../HISTORY.md#implementation)：`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/IMPLEMENTATION.md`。
- [PAGES-CONTRACT](../HISTORY.md#pages-contract)：`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/PAGES-CONTRACT.md`。

链接提供本地Git读取定位，不假定远端已发布。三份原文中的旧路径和阶段状态保留历史含义；当前生成Repository/JDBC消费、手写owner/DTO职责按上文及独立新回执判断。工具扩展与生成器源码入口见[首页](../../README.md#继续读架构与扩展工具)。
