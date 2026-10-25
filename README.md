# 银行财富：领域真源与产品体验设计预览

本仓库描述银行账户、外部入金、基金申购与定投。当前交付是 **真源声明修复与产品设计提议**，不是可运行的银行系统，也不是已完成的生成/运行/恢复/代码回锚闭环。

基金公司/TA 对接允许模拟；真实外部银行能力尚未确定。模拟不省略本地资金、订单、份额确认或拒绝退款语义。

## 从方法论到真源

```text
工作坊/资料/代码观察
  → Inbox：事实、假设、问题和提议
  → 人工裁决与工具检查
  → 领域声明 + 产品体验提议
  → 确定性知识图/报告投影
  → 后续编译/生成/实现/行为验证与回锚
```

七阶段目录是本项目使用的组织约定，不宣称 EventStorming 必须按该顺序开展。现有导入稿的 facilitator/时间等标签不证明举行过真实工作坊；新增内容明确注明 `workshopHeld: false`。

五要素不是 CQRS 的映射：信息架构不是聚合/数据库拓扑，读模型不是页面，参数来源不是表单控件，后台步骤不是用户最终成功。领域负责业务规则；体验提议负责用户目标、内容、导航、反馈和无障碍；技术宿主绑定及实际 UI 生成仍待建设。

## 目录

| 路径 | 角色与成熟度 |
|---|---|
| `tree/workshop.yaml` | 当前七阶段真源入口 |
| `tree/inbox/<stage>/` | 工作坊产物与设计提议；沿用已支持 note 类型 |
| `tree/aggregates/` | 账户/外部指令/基金订单/定投声明与命令-事件切片 |
| `tree/stories/`、`tree/use-cases.yaml` | 当前入口故事和前置条件；完整旅程另由提议表达 |
| `tree/read-models/` | 基于真实事件字段的视图声明，不等于已实现仪表盘 |
| `tree/value-objects/` | Money、FundShare 类型声明 |
| `tree/sagas/`、`tree/pipelines/` | 原样保留的协调契约；严格编译与运行验收分开 |
| `bindings.json`、`execution-bindings.json`、`runtime-binding.json` | 原绑定，引用 fixture 与未发布目标；不是运行认证 |
| `compiled/` | 导入时所供 IR，保持原字节；未据本次修改重生成，不能用于当前 freshness/回锚证明 |
| `isolation-zone/` | 原 Scala 说明性示例与经过校正的回锚说明，不是已验收生成应用 |
| `tools/`、`test/` | 本仓库局部检查与投影；复用 sibling 真源库而不修改它 |
| `projections/` | 从显式提议生成的 Context Map、事件流、Story Map、旅程与界面流 |
| `docs/BASELINE.json` | 修改前结构/strict 编译/往返基线与保护哈希 |
| `docs/IMPLEMENTATION-STATUS.md` | 当前执行进度、实测结果和未执行事项 |
| `docs/HANDOFF.md` | 与运行库/生成器 agent 的边界及下一阶段要求 |

## 新提议的表达

仍使用既有 `kind: note` 和 `context/subdomain/relation/story/field/readModel/question/timer` 等类型，丰富内容放在 JSON `payload.info.artifact`：

- 稳定 `id`、`category`、`status: demo-proposal`、来源；
- 显式领域引用与提议内部实体/关系；
- 候选上下文归属、业务叙事与未实现能力；
- Strategy、Scope/Story Map、Structure/Journey/IA、Skeleton/Screen、Surface/Content/Accessibility。

这是 **本例的设计提议载体**，不是新增的公共 UI Schema 或可执行 DSL。公共工具不完整校验上下文 target 和体验语义，因此本地工具额外检查它们；不把 opaque payload 保真当作完整性认证。

候选划分是 Ledger（CreditBalance）、Payments（ExternalTransferOrder）、Fund（FundOrder + SipPlan）。它是提议，不等于多上下文编译或独立服务已实现。账户中的币种余额 map 不是多账户聚合。

## 基金公司模拟边界

提议覆盖受理、确认、拒绝、延迟、未知及相同/冲突重复回执。业务时钟可推进；净值/份额示例是 fixture，不宣称生产金融算法。模拟器本轮未实现。

TA 确认、订单状态和持仓需要持久化桥接；拒绝后的退款需要独立资金来源、退款身份与终态。不能把付款后的退款当成预留解冻，也不能在结果未知时显示“已退款”或“申购成功”。

## 修改纪律

- 只有领域/体验真源定义事实；`projections/` 是派生件，修改便签后重新投影，不手改图。
- `sourceCapture` 保留受地址/格式修复影响的原 atom、路径及提交；数值 `origin.seq` 不变，分组板明确是导入整理，不伪造历史。
- `money-positive` 只保证金额为正。最低起购额、费用、日历与舍入仍需独立设计。
- 生命周期与字段折叠的本地检查只验证声明；不替代实际生成和事件恢复测试。
- 根绑定、Saga/Pipeline、旧 IR 和 Scala 示例受哈希保护；不因本地检查失败去修改另一位 agent 的领地。

## 本地检查

要求 Node >=20，并在 sibling `../metarch-truthsrc` 中有对应纯库 API（当前记录的基线分支为 `execution-compiler-v1`）。不需要 `npm install`，不启动数据库/服务。其他路径用 `TRUTHSRC_ROOT=/absolute/path` 指定。

在本仓库执行：

```bash
npm test
npm run validate
npm run verify             # 另检查临时树往返与派生件新鲜度
npm run project            # 显式重写本仓库 projections/
npm run project:check      # 只读检查
```

默认 validate 不写；verify 的往返只在本仓库 `.scratch/` 创建并清理自建临时目录；project 只有 `--write` 写派生件。未知标志失败，不静默忽略。

报告分别列出结构、局部声明、设计引用、往返、投影、strict Saga/Execution，以及未执行的生成/运行/回锚。原始 IR 的 digest 不代表本次 aggregate/体验变更已进入代码。实际执行结果以 [实施状态](docs/IMPLEMENTATION-STATUS.md) 为准。
