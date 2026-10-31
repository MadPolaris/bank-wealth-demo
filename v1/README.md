# Bank V1：文件真源与双链联合运行

最后更新: 2026-10-31

本目录是用户选择的显式 V1，不是旧 `../tree/` 的缓存或自动迁移。旧树、六份根 binding、暂停的 qualification/runner 和历史回执保持原字节。旧 projections 只有工具指纹变化时，经原 `tools/project.mjs --write` 再生，并保留差异与原件。

## 规则与实际边界

- 继承 `bank-v1-p23-design-2` 的付款、TA、独立退款、本地现金定投四流及 30 个场景。
- Money 与 AmountDecimal 使用 precision 38、scale 2，Money 币种 CNY；wire/PO 使用 minor-unit-string，拒绝溢出、隐式舍入与二进制浮点。38 位是技术容量，不是基金购买上限。
- TA NAV/份额保留完整精确字符串，不从样例推定固定小数位或定价公式。只有 TA 使用既有持久 MockTA 模拟器；不模拟外部银行。
- 余额、订单与期次状态只由生成 actor 的 event application 演进。手写边界负责具体端口、身份/资源核对、只读 journal 证据、MockTA 传输和可信结果投递，不另建资金状态机。
- 冻结运行制品为 P23 `0.2.1-p23.20261027.1`，没有修改或重新发布三个运行库。

## 权威源、完整输入与代码

| 路径 | 内容 |
|---|---|
| `tree/` | 231 个原子；唯一 V1 业务源，由公共 `compileTree` 编译 |
| `formal-inputs/{payment,refund,ta,sip}-376/` | 四份完整 14 产品请求；共享完整 canonical，`scope.json` 区分源事件、唯一 pipeline/step 及 required oracles |
| `formal-inputs/*-authored-*/` | 明确版本的 Saga/runtime/execution binding 作者输入，完整请求通过公共 union 合同消费 |
| `handwritten/scala/example/bankwealth/bindings/` | 银行具体适配器、纯身份/余额计算、可信 TA 与 SIP 完成桥 |
| `test/scala/` | 五个银行 suite，24 个测试；与生成默认 8 个测试共同运行，总计 32 |
| `../tools/v1-inputs.mjs` | 公共派生 API 的银行输入创作/运输薄层，不复制 compiler |
| `../tools/v1-joint.mjs` | 当前输入检查、正式零写 plan 与 owned target 离线复演入口 |

正式输入中的 `runtimeVerified:false` 等值记录的是**输入创作时的静态回执**，不会根据后来测试改写历史。运行结果在独立回执中。四个目录同 canonical 不自动等四流验收；实际路径和场景映射见交接。

## 四流运行语义

付款从投资人 outgoing、募集账户 incoming 到订单最后 commit，由唯一现金 Monarch 管线驱动真实 Saga。完整原始参数持久保存，phase query 读取原 PB 事件；UNKNOWN 不终结父流程。授权 Reconcile 在原身份上前进，不重扣。

TA 只接收已知成功付款。可信桥核对完整 request/order/payment/accounts/fund/amount 和 canonical receipt 正文；accepted 或技术 effect confirmed 都不等份额确认。MockTA 进程使用独占 journal，结束 wait/reap。

退款只由原付款成功且可信 TARejected 创建独立稳定 intent，反向原账户、原本金、不同于付款的交易身份。rejected/compensated/unknown 均不等本金已退回。已有取消屏障且没有 Prepare 的 query 返回具名确定未执行证据；普通失败仍 UNKNOWN。

SIP 使用有限 due slots、显式 revision 生效区间和 manual tick。先持久 occurrence，再启动唯一现金管线；catch-up 不等待上期投资终态。暂停保留此前 backlog，暂停内 due 跳过，in-flight 可完成。首可信业务终态计一次；TA 拒绝必须等独立退款成功才计失败，不清失败总数，不自动三败暂停。

## 本地复演

在银行仓库执行；Node 需支持当前公共工具链（本轮使用 22.23.4）。不安装依赖、不启共享数据库/服务/容器、不占 9000/2551。

```bash
node tools/v1-joint.mjs --check
node tools/v1-joint.mjs --plan payment
node --test --test-concurrency=1 test/v1-inputs.test.mjs test/v1-joint.test.mjs
```

离线运行既有、指纹匹配的 owned 目标：

```bash
node tools/v1-joint.mjs \
  --test-target /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p24-p25-bank-joint-fkcd3jwe/targets/js-bank-sip-473 \
  --evidence /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p24-p25-bank-joint-fkcd3jwe/local-replay-new-id
```

evidence 前缀必须全新，不能重跑覆盖已有成功或失败回执。工具固定本轮 JDK11/sbt launcher，拒绝共享应用/符号链接/旧输出；480 秒后终止，必要时 kill 并等待 close。手写与测试目录由 sbt settings 外挂，**不得编辑生成目录或复制手写件到生成区**。

新生成仍用正式公共 `generate-products` 或 BC checked JVM 包装器，明确 fresh target。不要运行 raw 默认 `CodegenMain`，不要组合 `--direct --dry-run`。本轮脚本和各命令完整 argv 在独占证据目录中，不重复旧编号。

## 证据及不包含的认证

证据根：`../.scratch/p24-p25-bank-joint-fkcd3jwe/`。

- `APPROVED-PLAN.md`、`BASELINE.json`：批准与保护基线。
- `SCENARIO-MATRIX-494.json`：原 30 ID、独立预期、测试路径/SHA及局部运行边界。
- `FINAL-EIGHT-404.json`：八个最初完整目标的 28 测试历史；当前补强后的 32 测试回执为 420/421、471/474、483–488 及 490-replay。
- `PRODUCT-PLANS-491.json`、`CLI-FOUR-501.json`：四流正式 plan 零目标写、完整源码对账，以及 CLI/API 产品字节等值。
- `FILE-ANCHORS-469.json`、`REGEN-STABILITY-476.json`、`ANCHOR-BOUNDARIES-493.json`：实际文件 SHA、1:N 锚、稳定再生与 KEEP/stale/unmapped 边界。
- `CURRENT-FULL-466.json` 是 CLI 紧凑回退修改前的公共全量历史，不作为修改后的最终认证。

本轮运行是本地真实生成 actor、冻结 Saga/Monarch 和 MockTA 进程，不是共享生产服务验收。testkit journal 验证同 PID actor 恢复，不认证真实存储下完整跨 JVM 资金恢复。raw 外部 Ingest 接口在银行测试中 deny-all，业务走可信桥和 guarded command；不冒 raw ingress 全授权认证。设计输入仍 proposal，不等已批准 UI/CQRS 读侧。原 P26–P32 的服务、UI、完整故障资格与发行边界未被提前宣称完成。

最终逐包结论见同目录 `JOINT-ACCEPTANCE.json`；不存在该文件或仍为非通过状态时，不凭测试数量宣布 P24/P25 整包完成。
