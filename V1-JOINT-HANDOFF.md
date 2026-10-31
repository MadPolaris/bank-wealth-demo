# Bank V1 / P24–P25 联合交接

最后更新: 2026-10-31

## 当前结论与权威入口

本次原 P24 六包、P25 五包按原合同逐项核验，结论为 **P24 6/6、P25 5/5：文件输入、公共语义、双链生成、最小本地真实运行及文件回锚通过**。最终机器回执为 [JOINT-ACCEPTANCE.json](.scratch/p24-p25-bank-joint-fkcd3jwe/JOINT-ACCEPTANCE.json)；该文件及其中 required evidence 校验成功才构成收尾，不以本页或测试总数单独认证。

这不是完整银行产品交付、生产级故障恢复或 P26–P32 验收。KB 文档门仍有既有 #201 缺链接及 freshness warning，单独保留；没有宣称所有仓库门全绿。未 commit、push 或发布，三个冻结运行库未改动。

证据根为 `.scratch/p24-p25-bank-joint-fkcd3jwe/`。主要清单：

- [SOURCE-MANIFEST.json](.scratch/p24-p25-bank-joint-fkcd3jwe/SOURCE-MANIFEST.json)：2962 文件同窗指纹、六仓基线、三运行制品、四完整输入、手写/测试和 scratch 工具。
- [PRODUCT-PLAN-MANIFEST.json](.scratch/p24-p25-bank-joint-fkcd3jwe/PRODUCT-PLAN-MANIFEST.json)：四流 BC/JS 各自完整零写计划及实际文件 SHA、产品版本、CLI/API 等值和准入负例。
- [FILE-ANCHOR-VERIFICATION.json](.scratch/p24-p25-bank-joint-fkcd3jwe/FILE-ANCHOR-VERIFICATION.json)：八最终银行应用、两稳定再生、两设计及四独立应用的实际文件与 1:N 锚。
- [JOINT-REVIEW-541.md](.scratch/p24-p25-bank-joint-fkcd3jwe/JOINT-REVIEW-541.md)：原十一包逐项正面证据、拒绝门和资格边界。
- [SCENARIO-MATRIX-494.json](.scratch/p24-p25-bank-joint-fkcd3jwe/SCENARIO-MATRIX-494.json)：原 30 场景的 source pointer、独立期望、测试 SHA 与局部覆盖范围。
- [CURRENT-FULL-525.json](.scratch/p24-p25-bank-joint-fkcd3jwe/CURRENT-FULL-525.json)：BC1028、JS2232/91文件，完整测试全集与同一源码窗口对账。

## 源、输入与身份

[v1/README.md](v1/README.md) 是业务规则和目录说明；`v1/tree/` 是显式 V1 的 231 原子权威树，公共 `compileTree` 是唯一 canonical 生产者。旧 `tree/`、六 binding、`compiled/`、`isolation-zone/`、暂停 qualification/runner 和历史日志保持原字节，未启动旧 runner。

当前四完整请求：

| 流 | files/options/scope 所在目录 | 真实入口 |
|---|---|---|
| 付款 | `v1/formal-inputs/payment-376/` | `bank-cash-payment-v1`，投资人 outgoing、募集账户 incoming、FundOrder 最后 commit |
| TA | `v1/formal-inputs/ta-376/` | `bank-ta-submission-v1`，仅已成功付款，完整可信 receipt 桥 |
| 独立退款 | `v1/formal-inputs/refund-376/` | `bank-independent-refund-v1`，原付款成功及 TARejected，新身份反向原本金 |
| 本地定投 | `v1/formal-inputs/sip-376/` | `bank-sip-dispatch-v1`，持久 occurrence 后唯一现金计划及可信 terminal 计数 |

四份共享完整 canonical/14产品，不是假装四套不同领域输入；scope 区分入口和 oracle，运行证据按真实路径映射。静态输入里的 `runtimeVerified:false` 不回填成 true；后来的运行资格由独立回执提供。

产品版本包括 decision4、dependencies6、folds6、external2、artifact2、显式 application/effect profile2；旧版本没有放宽。Money/AmountDecimal precision38、scale2、Money=CNY、minor-unit-string：38位是技术容量而非基金限额。NAV/shares 保留 TA 精确原文本，无固定四位假定或定价公式。

## 实际运行与复演

最终八个银行目标均保存在证据根 `targets/`，没有直接修改生成区：

| 流 | BC target / 最新 build receipt | JS target / 最新 build receipt |
|---|---|---|
| payment | `bc-bank-payment-378` / `483-app.json` | `js-bank-payment-381` / `484-app.json` |
| refund | `bc-bank-refund-384` / `485-app.json` | `js-bank-refund-387` / `486-app.json` |
| ta | `bc-bank-ta-390` / `487-app.json` | `js-bank-ta-395` / `488-app.json` |
| sip | `bc-bank-sip-398` / `421-app.json` | `js-bank-sip-401` / `420-app.json` |

以上每个都 compile、Test/compile、32 tests 通过，32=24银行+8生成默认测试。稳定再生 `bc-bank-sip-470` / `471-app.json` 与 `js-bank-sip-473` / `474-app.json` 也各32通过，476证明同链源码字节稳定。八目标/32 tests/30场景/11包是不同计量，不能互相替代。

从银行目录使用现有工具：

```bash
node tools/v1-joint.mjs --check
node tools/v1-joint.mjs --plan payment
node --test --test-concurrency=1 test/v1-inputs.test.mjs test/v1-joint.test.mjs

node tools/v1-joint.mjs \
  --test-target /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p24-p25-bank-joint-fkcd3jwe/targets/js-bank-sip-473 \
  --evidence /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p24-p25-bank-joint-fkcd3jwe/replay-unique-new-prefix
```

最后前缀必须全新。已用490实际复演此入口，32通过；不要覆盖旧回执或重跑固定 exclusive 作者脚本。工具固定本机JDK11/sbt、离线、有界480秒+15秒终止等待；具体 argv、PID、stdout/stderr与SHA在每份回执中。`v1/handwritten/scala` 与 `v1/test/scala` 通过 sbt settings 外挂，不复制到生成区，不修改生成 build/spec。所有生成仍走正式公共 API/CLI/BC checked入口，fresh绝对target，禁止raw默认Examples及`--direct --dry-run`组合。

固定运行坐标：`net.imadz:{saga-core,monarch-core,monarch-persistence}_2.13:0.2.1-p23.20261027.1`。实际本地 Maven 路径与各 jar SHA见 SOURCE-MANIFEST；540已重核。symbolicTarget 不是发布坐标。

## 关键真实行为与限制

- 付款query只读匹配tx/resource/amount的原PB事件，不从当前余额合成历史。UNKNOWN不写成功checkpoint或终结父流程；Prepare/Commit后丢证据均以原identity恢复，Commit已决策不补偿。
- TA完整核request/order/payment/accounts/fund/amount与canonical receipt正文；accepted与effect技术confirmed都不等份额成功。独占MockTA真实进程/日志允许重开；只有TA模拟，不用手写资金状态机。
- 退款需要可信TA拒绝，独立稳定intent/tx，反向原账户和原本金。rejected/compensated/unknown不等退款成功，也不提前计SIP失败。
- SIP先持久occurrence，再启动cash；有限slot/manual tick、revision区间、pause/backlog与首terminal计一次已在本地真实actor/资金joint覆盖。部分原精确slot值由aggregate test覆盖，现金joint用明确变体；详494和541，不能把aggregate人工terminal label当可信桥。
- raw外部Ingest在银行joint中deny-all，可信桥用guarded command；未认证生产网络身份、外部用户权限或恶意composition root替换。测试token不是生产认证。
- 同PID persistence testkit恢复不等生产存储完整跨JVM恢复；未启共享Mongo/MySQL/Neo4j或9000/2551、未启服务/容器。没有完成UI、生产部署、跨JVM资金故障资格或发行。
- 文件锚为actual SHA/file-level/1:N，非symbol/span；手写文件另列清单。银行目标没有人工改MANUAL块，MANUAL/MERGE由当前公共全量回归证明，KEEP/stale/unmapped另有493实际只读边界。

## 当前兼容、失败与历史

最后公共全量是525（510–520、523），不是CLI修改前466；银行最终527为明确11 suite的518/518，528旧141atoms roundtrip与9projection通过。526检查发现projection原字节已新鲜，因此没有按旧暂停备注再次重写。

532 BC与534–538 JS各70个完整产品负例通过；533单进程超时保留，未增加540秒上限或降低断言。195临时banking-app处置已获用户允许，不当正确目标证据。旧public ACCEPTANCE、825探测、历史所有失败与scope保持；本交接更新当前结论，不改写当时事实。既有SCHEMA.md一行文改保留。

本交接结束原P24/P25批准范围，没有新增PXX或自动进入P26–P32，也没有继承新的提交/下载/发布权限。
