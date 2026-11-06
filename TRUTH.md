# 银行财富：作者权威合同

## 唯一当前输入

根 [`truthsrc.project.json`](truthsrc.project.json) 是唯一当前项目入口：

- [`truth/bank-wealth/`](truth/bank-wealth/)：系统声明、`contexts/bankwealth/`内的领域与协作知识，以及`inbox/`内有来源的背景/决策。
- [`bindings/implementation/`](bindings/implementation/)与根配置：具名技术选择、编码、宿主、runtime pin与外置源码路径。它们不构成另一份人工维护的完整业务request。
- 结构共享与受控微语法按公共工具规则展开；虚拟原子路径是展开坐标，不能沿它创建第二份作者文件。身份与seq不得为整理目录而重排。

只修改被授权的作者输入。业务规则由显式声明定义，不由旧快照、生成器猜测或页面文案补足；未支持或缺失的能力必须明确拒绝，不能回退到旧树或虚构成功。

## 输入、实现与证据分离

| 类型 | 合同 |
|---|---|
| 作者输入 | 当前树、根配置与具名技术选择，通过公共校验、roundtrip与严格编译 |
| 派生产物 | canonical、完整request、编译产品、`.truthsrc/`知识图、生成源码、ledger与anchors由公共工具产生，不手工修补 |
| 手写实现 | `handwritten/scala/`独立挂载，不复制到生成区；业务owner、DTO和适配职责见[架构入口](docs/architecture/README.md) |
| 独立预期与回执 | `test/scala/`固定预期不随生成结果改写；每次候选的代码/运行证据独立签收，不继承历史通过 |

手写来源声明位于`docs/architecture/HANDWRITTEN-SOURCE-MAP.json`，是显式实现关系，不是从手写代码自动推导真源。文件指纹或精确区间证明来源关联，不能单独证明业务正确。

## 不随目录调整改变的语义

- 付款成功不是投资成功；TA受理不是最终份额确认；结果未知需按原身份核实。
- 独立退款不是补偿已经Commit的付款；有限定投复用现金入口，不引入三败自动暂停。
- Saga事务与pipeline编排不互换；状态只在事件应用中演进，保持Onion依赖方向。
- `/api/v1`、`/bank/v1`、`bank-v1`身份、PB/PID、codec及冻结runtime版本不因容器目录退役而改名。
- retry/backoff/deadline债务未关闭，也不是已接受的语义豁免；实施和验收需独立授权。

## 历史边界与操作入口

旧`tree/`、`v1/tree/`和本次移除的`v1/`材料仅按[固定历史对象](docs/HISTORY.md)解释，不恢复成可编辑作者副本。原1134签收、1128暂停裁定及旧回执保持各自范围；当前路径迁移不等于重新验收。

实际命令与读写边界见[ENTRYPOINTS](docs/TRUTH-ENTRYPOINTS.md)，学习见[教程](docs/TRUTH-TUTORIAL.md)，分层执行见[工作坊](docs/BANK-WORKSHOP.md)。本文件只定义权威合同，不充当运行回执。
