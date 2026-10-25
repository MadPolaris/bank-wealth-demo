# 首批实施状态

日期：2026-10-25。验收范围是**真源侧及设计投影**，不是可运行银行系统。

## 已交付

| 工作 | 结果 |
|---|---|
| 并行边界核对 | bank-wealth-demo 独立仓库；未修改 runtime/编译器/生成器/共享应用 |
| 原样例地址与声明修复 | 39 个受影响 atom 保留原 sourceCapture；数值 seq 保留；不实三次失败策略转换为问题 |
| 领域声明 | 修正正数/最低额混淆；保留九个既有请求字段；修正事件 fold；补两个声明级状态门禁；修复读模型血缘与用例引用 |
| 工作坊与五要素 | 24 张提议、候选三上下文/三子域、活动/任务/发布、三条旅程、六屏幕、文案/无障碍、模拟TA场景及决策债 |
| 派生浏览 | Context Map、事件流、Story Map、旅程、Screen Flow；JSON 索引与来源指针 |
| 本地工具 | 复用 portable 真源库；纯检查与显式投影写入分开；临时树只写本仓库 scratch |
| 文档 | README、修改前基线、运行/生成移交、回锚说明 |

## 实测验收

执行：`npm test`、`node tools/validate.mjs --roundtrip --check-projections`、`git diff --check`。

- Node 测试：**25/25 通过**（包含坏字段、坏引用、重复身份、未知 kind、虚假 runtime 状态等负例）。
- 公共结构门：**0 hard errors**；原基线为 10 个序号碰撞 hard errors。
- 局部声明/提议引用门：**0 errors**；不等于任意 UX/金融要求已完备。
- strict Saga / strict Execution：**各通过，diagnostics 为空**；不等于 fixture 实现存在或运行认证。
- 往返：**104 个 YAML 的 canonical、相对路径集合和文件字节完全一致**。
- 投影：**7 个派生文件一致**，双次渲染确定性检查通过。
- 保护：**17 个原 Saga/Pipeline/binding/IR/Scala 文件字节未变**。
- 工具来源：`metarch-truthsrc` HEAD `cb2d23342619af3f5d27e5df2361e88fe6d54fb3`；实际导入闭包和 Schema 指纹在验证报告中。

当前数字是记录时快照；进一步修改提议后需重新运行验证，不能拿本文件代替新回执。当前机器回执为 [VERIFICATION.json](VERIFICATION.json)。

独立复核后追加修复：详情导航目标与旅程动作一致、旅程成员/角色/信息需求投影保真、完整/重复/对象式参数映射检查、实际 traceability 字段和绑定证据检查、图端点及实体类型检查、MockTA 七类实际场景覆盖、真源与绑定并发快照指纹检查。新增测试验证这些负例，不仅检查生成字节稳定。

## 公共门的 14 条 Notice（全部保留）

| Notice | 数量 | 本批处理/限制 |
|---|---:|---|
| RF5：GetBalance/GetExternalTransferState/GetFundOrderState 无参数 | 3 | 原查询声明不变；目标实体与授权由宿主绑定，实际 host 尚未实现 |
| V2：导入外部系统板 seq 3、4 及策略假设板 seq 10 非连续 | 3 | 明确保留历史数值，不人工 densify；往返通过 |
| SA0：两个 Saga 树层只校验 transport fidelity | 2 | 已另跑 strict 编译；运行认证仍未进行 |
| ES4：SipPlanCreated 可能有方案语言 | 1 | 保留原身份；领域措辞仍可产品评审，不自动重命名 |
| CS1：DeductFundsConfirmed 捕获便签缺 trigger link | 1 | 实际切片已有生产关系；捕获追踪尚待补，不伪造工作坊历史 |
| CS3：PrepareExternalDebit/RecordTAShareConfirmation 捕获缺 initiating role/policy | 2 | 新提议另表 actors/commands；未来外部/协调者 bridge 待实现 |
| CS6：提议 timer/MockTA 无公共 triggers event link | 2 | 关联放在提议元数据并局部校验；没有谎称公共 causal graph 已接通 |

另有两条本地提醒：MockTA 仅设计契约；context/UX 引用是本例局部检查，不是公共工具扩展。

## 明确未完成

1. MockTA 模拟器代码、业务时钟服务及回执适配器。
2. 基金实际收款账务、支付后的独立退款与退款终态。
3. TA 子计划终态→订单/持仓→定投结果的持久化桥接。
4. 外部银行通道能力、授权、对账、退汇与真实适配。
5. 定投终态去重/冲突、配置一致性、连续失败计数/清零/乱序。
6. 真实产品最低额、日历、费用及精度/舍入规则。
7. 公共上下文命名空间、多上下文编译及通用 UI Schema/生成。
8. 应用构建、运行、恢复、源码认证和一对多代码回锚。

**新增运行前阻碍**：当前生成器混合 legacy/structured guard 的分组转换可能改变守卫顺序。真源层验证保留声明顺序不代表生成代码正确；见 [移交](HANDOFF.md)。

## 建议下一阶段

在运行/生成侧能力交接后，先完成本行账户申购＋模拟TA确认/拒绝退款垂直切片。产品侧可继续裁定当前提议，而不要将所有 demo-proposal 自动升格为已接受需求。
