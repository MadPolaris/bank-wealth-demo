# Monarch R2 与当前银行消费的边界

日期：2026-11-06。用户指出R2运行时已经产出不可覆盖候选，而下游升级尚未跟上。本页是实际依赖核对和独立升级待办，**不是R2已被银行消费，也不是把当前验收中途换JAR的授权**。

## service02 实际跑的是什么

`service02` 是目录精简后的第二次完整验收尝试编号，不是Monarch R2。

生成的四条银行流程仍调用 `PersistentMonarch.behavior`，实际runtime classpath来自干净1134供给：

| 实际加载的制品 | 版本 | 实际JAR SHA256 |
|---|---|---|
| `monarch-core_2.13` | `0.2.1-p23.20261027.1` | `046ce5a54d4900674b9d87396bd57aefd93070e74e00b90820147c043c506b09` |
| `monarch-persistence_2.13` | `0.2.1-p23.20261027.1` | `5cf3dd2784fad05fe42102b1c5df16685bc814318e2a21121c458eb26e8205bd` |

证据为本机`target/v1-retirement-service-20261106-02-runtime-build/runtime-build.json`及其有序classpath，JAR已重新核SHA。生成`build.sbt`第17–18行分别锁定Saga与Monarch persistence的P23版本；Monarch core由固定依赖闭包进入。

因此，本轮actor64、readside47及24恢复场景的通过均不能作为R2验收。service02在真实数据库initial/restart/refund通过后，replay新读库未在90秒内达到caught-up，完整服务仍false。当前证据不能把这个读侧问题归因于Monarch R2，更不能据R2已发布候选推定它会自动解决。

## 已核到的R2不可覆盖候选

本地位置相对工作区：

- Maven仓：`monarch-persistence/target/r2-candidate-20261106-dc168f96fa62/`。
- 版本：`0.3.0-dev.r2-20261106-dc168f96fa62`。
- `source-manifest.json`记录的产品源/build/project SHA：`dc168f96fa62700537644e486e64a44b38bfa77f8e897e54c3bf68d0fa94687d`。
- persistence JAR实际SHA：`2dea09f3c97b4832fd78552f546a1d5fb4f68d5b92c42cb3d4466101c59d21b0`，与用户给定一致。
- 配套core实际位于 **`monarch-persistence/target/demo-candidate-20261021/`**，不是`monarch-core/target/`；版本`0.2.1`，JAR实际SHA `66223d37ab979b59cde557500f3da7aafaf532ddfe3268401c5f786093e0f971`。
- 本次只读时persistence分支为`feature/monarch-recoverable-operations`，HEAD `985aaa5923a3ed05d27849bb01667c100d949b31`。候选按固定内容识别，不依赖会话名称或未核的分支别名。

P23、普通0.2.1、R1及这份R2候选均不覆盖、不原版本重发。此次只读核制品，不重跑R2运行时验收。

## 为什么不是只改版本号

已有[R2后续评估](../../monarch-persistence/docs/R2_FOLLOWUP_ASSESSMENT.zh.md)明确区分运行时、作者/语义编译器、生成器和下游消费。R2保留旧API不等于生成代码已经获得新能力。

独立升级批需要共同固定：

1. 作者/语义合同怎样表达受管理operation、资源占位、耐久交接和有限批处理，不仅是能保存扩展字段。
2. 公共compiler与生成profile如何准入新能力，并生成R2原生接线，不复制第二套恢复内核。
3. 明确P23和R2及配套core的制品选择、供给和校验；不能将R2塞进原clean1134供给回执。
4. 银行四流的宿主职责、身份、PB/PID、冻结oracle和旧journal兼容/新namespace边界。
5. 图/AST/代码回锚、新候选业务/恢复/服务验收和新人文档同步。

原有协调裁决是当前最小交付收尾后再核新基线统一计划。本次用户补充已登记#168；目前没有修改银行冻结runtime选择、公共生成器或R2候选，也未将该升级混入目录/缓存清理。retry/backoff/deadline业务政策债仍独立OPEN，R2技术恢复预算不自动关闭它。
