# 银行正式合同输入交接

## 本次已实际交付

完整现有银行真源已通过公共正式输入入口：**6份原 binding、3个显式 assemblies、3个正式语义产品**。没有新增银行 compiler/normalizer/host，没有改旧真源或公共实现。

- 输入模板与用法：[formal-inputs/existing-contracts](../formal-inputs/existing-contracts/README.md)
- **可直接消费的请求**：[package-refresh/files.json](../.scratch/formal-contract-inputs-05rgzyqv/package-refresh/files.json)
- **实际公共 CLI 产物**：[semantic-products.json](../.scratch/formal-contract-inputs-05rgzyqv/package-refresh/semantic-products.json)
- 准备/消费回执：[receipt.json](../.scratch/formal-contract-inputs-05rgzyqv/package-refresh/receipt.json)
- 最终运行摘要：[RUN-REFRESH.json](../.scratch/formal-contract-inputs-05rgzyqv/RUN-REFRESH.json)
- 发布与保护核验：[PUBLICATION-CHECK.json](../.scratch/formal-contract-inputs-05rgzyqv/PUBLICATION-CHECK.json)

派生输入在银行 owned `.scratch`，不是真源副本。请求直接引用六份原 binding 的绝对路径；公共 compiler 保留它们并生成完整 union/provenance。任何后续 binding/tree 变化必须新准备、新消费，不能沿用本次认证。

## 实际验证

| 门 | 本次结果 |
|---|---|
| 新正式输入正负门 | **25/25**，fail/cancel/skip 0 |
| 原 P23 合同回归 | **109/109**，fail/cancel/skip 0 |
| 公共 `compile-products` CLI | exit 0；结果与 API 完整一致 |
| 输入运输 | canonical 原字节、六binding完整值未变化 |
| 公共消费闭包 | 57文件，逐命令前后SHA一致 |
| 银行本轮执行前后源 | 一致；最终旧源保护另外核验 |
| `git diff --check` | exit 0 |

首次新测试为24/25：覆盖拒绝正确，但新增测试把公共CLI错误退出码误写为1，实际约定为2。已只修测试，重新25/25；[原失败记录](../.scratch/formal-contract-inputs-05rgzyqv/test-initial.json)及stdout/stderr未删除。原输出SHA不变。

首组最终运行结束后，发布检查发现公共product/semantic-set schemas新增child-plan合同声明，旧消费本身无漂移，但不再是当前源码认证。已保存[消费结束后变更](../.scratch/formal-contract-inputs-05rgzyqv/POST-RUN-PUBLIC-ADVANCEMENT.json)，按新字节有界重跑25/25、109/109和CLI；当前入口是package-refresh，旧package-final及回执保持历史。没有要求公共冻结。

本轮**没有运行**旧V1全套、投影往返、BC admission、应用生成/编译、runtime发布、银行资金/恢复或服务。旧P23的489/285等历史成绩不作为本轮新执行成绩。原projection及toolDigest没有刷新。

## 输入身份

银行HEAD `5bf91e0eb6fc841c571a4c459f0ad9411b150c95`，branch `feature/bank-wealth-truth-preview`，包含原design-2及本轮未提交增量；HEAD不冒充全部当前字节。

公共JS HEAD `665d67d80412979a29c51267dda21aac53bf9ec6`，**消费身份以实际57文件SHA为准**，不假设HEAD已含并行公共实现。

- 公共消费闭包SHA：`17add98d758d8c590f3657bffb6cf27fbe7defb54e3b51f0327dbd98106c01ed`
- canonical SHA：`572723ba4bdc42f39b9a3bb92d09e9dc7fa8bdb59fb16b565fbc856971cc4578`
- bank tree/bindings fingerprint：`660833275ff4206d3fb35983792ffa6f2f676dc14ac1f7721b41ee1123768cf2`
- prepared request SHA：`58a27afe9a1f9ca19aae9a0ae3039a9871e0ad20efddc153278cda59d304935a`
- semantic product file SHA：`41c2af2b4c9ac61edbdee62f6b2fff258b924331f358df5ae869a12ad9d0396d`
- consumption receipt SHA：`54fc2946eff694f51dee4784624c80fe00a88bf637190033115d93000d367705`

产品：`saga-contract@1`（payload saga-ir/v1）、`execution-contract@1`（execution/v1）、`saga-runtime-contract@1`（saga-runtime-contract/v3）。均是静态语义，`runnable:false/runtimeBindingVerified:false`。这不撤销已独立通过的P23运行库delivery，也不是银行运行证明。

## 覆盖与剩余银行工作

- Saga全量4个：external-bank-transfer、fund-subscription-pay、fund-purchase-payment-v2、fund-purchase-refund。
- execution全量4个：fund-purchase-cash-payment、fund-purchase-cash-refund、fund-purchase-invoke、sip-installment-execution（结果保持canonical顺序）。
- document-only：fund-ta-settlement、sip-cross-bank-design-boundary，不升级为可执行。
- 付款/独立退款现有合同已正式消费；TA已有领域源保留但新bridge/ports未齐；原SIP外部链仍legacy，新local-cash SIP未正式声明。

**不是四个新应用request已经齐备。** 新exact类型消费、完整TA/退款identity computation/occurrence/SIP声明及host技术输入仍要补；不把新增无消费者的Money模型当作业务完成，不按TA fixture推定精度。pipeline唯一启动不改，BC/JS mixed宿主未由此验收。

## 给公共owner的最小源入口请求

证据：[source-root-probes.json](../.scratch/formal-contract-inputs-05rgzyqv/package-refresh/source-root-probes.json)。重现文件为probe-positive/missingRoot/missingPointer，**仅负例，不是正式银行binding**。

真实源 `tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml:/payload/info/artifact` 的 `contract.cash-purchase-v2` 保留在：

`bank-canonical:/sessions/5/scopes/1/notes/0/info/artifact`

1. reference-layout指向这个真实对象通过。
2. 现有public tree compiler不输出`artifactContracts`根，artifact-contract返回`PRODUCT_SHAPE`，位置`bank-canonical:/artifactContracts`。
3. 声称`/artifactContracts/0`是来源返回`PRODUCT_SOURCE`。

请 `complete-generated-file-anchors` 在公共侧给出正式声明的**source residence/kind及tree→canonical根投影**，使新artifact/port/host/computation/external ingress可由银行真源携带并保留来源与作者状态。已有公共合同不是未定义；缺的是这些新正式根的真源承载/投影入口。银行不会自行lift或手补canonical。只有artifact根在本轮实际负例验实，其他根列作需求而不冒已测。

## 消费与职责

**本银行本轮源码消费已结束；不要求持续freeze，不重开旧P23窗口，不代其他consumer解锁。** 本轮没有公共写入授权或实施，也未修改运行库、共享应用、暂停qualification及历史回执。所有失败/临时test输出保留；没有在途本轮命令。

公共root投影、mixed宿主与技术装配仍归公共owner；银行继续补真实四流源与绑定。P23已通过不变，本交付不标公共P24/P25或完整V1完成。未提交、未推送。
