# 完整现有合同：正式公共输入

这里的 `files.json` 是请求模板，不含手写 canonical。运行准备命令后，得到可直接交给公共 CLI/BC admission 的完整请求与静态产品。

```sh
# 在 bank-wealth-demo 内；OUT 必须是 .scratch 下尚不存在的绝对目录，父目录已存在。
node tools/formal-contract-inputs.mjs --out /absolute/path/to/bank-wealth-demo/.scratch/new-contract-package
npm run test:formal-contracts

# 可用已准备的 files.json 重现；产品 output 也必须不存在。
node ../metarch-truthsrc/bin/truthsrc.js compile-products \
  --request /absolute/path/to/new-contract-package/files.json \
  --out /absolute/path/to/new-contract-package/semantic-products-replay.json
```

## 权威源与运输

- canonical 由公共 `compileTree()` 产生，完整原字节保存；不过滤旧上下文，不增加根字段。
- 六份原 binding 不复制、不修改。请求显式声明 Saga/runtime/execution 三个完整 assemblies，由公共 compiler 合成，保留原文档及逐行 provenance。
- 准备工具仅运输文件、捕获实际字节并调用公共 API/CLI；它不是银行 normalizer、compiler、generator 或 runtime host。
- `semantic-products.json` 是 `truthsrc.semantic-product-set/v1`，包含三个产品：Saga static、execution static、Saga runtime lowering。准入保持 `static-contract-only`、`runnable:false`、`runtimeBindingVerified:false`。
- `.scratch` 派生 canonical/product/probe/log 不是真源，不提交为可手改业务副本。输出独占创建，拒绝覆盖既有证据。

## 真实覆盖

| 银行业务 | 本输入已包含 | 仍未交付 |
|---|---|---|
| 付款 | 现有 `fund-purchase-payment-v2@v2`、cash-payment pipeline/plan-v2、完整旧 binding | 新 typed host/authority/result delivery 与应用运行 |
| TA | 全 canonical 中已有命令、事件、correlation正文；`fund-ta-settlement` 保持 document-only | 新正式 bridge/ports/external ingress/技术装配 |
| 退款 | 现有独立 `fund-purchase-refund@v1`、cash-refund pipeline/plan-v2 | typed refund identity computation、原账户到订单 bridge 与运行 |
| 定投 | 原 `sip-installment-execution` 的 legacy external 静态闭包、design-2全部设计正文 | 新 local-cash SIP aggregate/occurrence/host 输入与运行 |

这不是四个新应用 request 已齐备，也不是 Money/Decimal 双链应用验证。pipeline 唯一启动政策不变，不开启 direct Saga 来绕过生成能力限制。

## 根来源的负例

准备目录保存 `probe-positive.json`、`probe-missingRoot.json`、`probe-missingPointer.json` 和 `source-root-probes.json`。这些是**负例专用内存请求，不是正式银行 bindings**：

1. 真实 `contract.cash-purchase-v2` 正文在 canonical session note 中可定位；reference-layout 可以引用它。
2. 当前编译结果没有 `artifactContracts` 根。直接请求 artifact-contract 返回 `PRODUCT_SHAPE`，source=`bank-canonical:/artifactContracts`。
3. 声称 `/artifactContracts/0` 是来源返回 `PRODUCT_SOURCE`。

公共需要提供正式声明的 source residence/kind 与树投影，而不是要求银行补一个断言 binding 或自建 lift。其他 `ports/hostComputations/externalEventProducers/sagaHosts` 需求同样应由正式源入口承载；本包不冒已分别验证这些缺口。

## 证据边界

`receipt.json` 记录实际 CLI/API 一致性、完整输入/公共消费闭包 SHA、assembly provenance 和结束状态。并行公共改源造成消费闭包漂移时结果失效；不复制源码绕过，不继续占用旧 P23 freeze。

运行库 delivery 已在 [P23 runtime lock](../../docs/P23-RUNTIME-LOCK.json)独立核收；本包 runtime lowering 静态 readiness 不会撤销该验收，也不会把它升级成资金/恢复证明。P23历史回执不改写。
