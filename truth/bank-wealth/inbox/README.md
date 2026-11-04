# 新银行当前树的十三类覆盖

这不是十三个必须填满的目录。当前命令/事件/不变量只在结构化slice定义，
故事/用例/读模型只写其自身语义并引用执行源；此README不定义资金规则。

| 覆盖视角 | 当前载体 / 明确边界 |
|---|---|
| 01 事件流 | 上下文 `pipelines/` 四流与 `sagas/` 两事务；用例描述客户/机器协作。 |
| 02 命令与参与者 | `aggregates/*/slices/`；本目录 `02-commands` 的客户/操作员/内部机器角色说明。 |
| 03 聚合 | CreditBalance、FundOrder、SipPlan；不承接范围外ExternalTransferOrder。 |
| 04 子域 | 旧三子域为历史提案；当前单context不宣称战略拆分已完成，见上下文职责与承接表。 |
| 05 上下文 | `contexts/bankwealth/context.yaml` 与范围说明；不自动拆三上下文。 |
| 06 聚合细化 | 聚合state/defaults及slice guards；implementation note仅保留历史引用/范围，非第二套规则。 |
| 07 聚合关系 | Saga participant和类型化host/port关系；用例引用，不复制其他聚合模型。 |
| 08 消息细化 | slice参数/事件payload、绑定/fold；formal external-event/port合同。 |
| 09 血缘 | slice event/fold与六读模型字段source；复合推导明确是描述性，不假称单一事件直投。 |
| 10 策略 | 当前规则由切片/协作合同拥有；没有获准三败自动暂停，不造policy原子填空。retry仍OPEN。 |
| 11 故事 | `contexts/bankwealth/stories/` 四故事。 |
| 12 用例 | `contexts/bankwealth/use-cases.yaml` 四用例及失败/恢复扩展。 |
| 13 读模型 | `contexts/bankwealth/read-models/` 六视图、可见性、水位/unknown边界。 |

历史引用的根相对银行仓库；当前root项目不把这些历史副本重新编成当前规则。
完整证据和差异见银行 `docs/TRUTH-MIGRATION.md`。产品设计五层不是本轮
统一合同的必填门，已有review继续保持proposal/null审批。
