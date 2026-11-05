# 真源工具链后续交接：从已验银行发行到可持续开发

日期：2026-11-04。本文是后续工作的单一交接入口，不是新增业务真源，也不是完整小白教程。

**当前只完成评估、重试挂账与本交接。没有实施下述工具链改造，没有启动新工作会话，没有修复或发布 runtime。** 原 [HANDOFF.md](HANDOFF.md) 等文件保留历史，不以其中“未运行/尚未完成”的时点描述覆盖当前1134签收。

## 1. 用户目标与停止扩张原则

用户重申的三个成果：

1. Saga/Monarch领域知识描述格式 → 真源编译器 → 代码生成器 → 生成代码 → 代码回锚的连贯升级。
2. 从BC简化出仅本地真源与明确技术配置驱动的编译、生成、回锚、知识/代码双向检索与持续同步流程。
3. 用银行demo及小白向导展示上述过程，包括agent使用、自定义生成器和手写区并行开发。

核心链路在已选有限模型上已贯通，银行V1有界发行已完成；主要剩余是独立工具的完整用户入口与持续开发示范，不是重新做银行。

用户明确：三个runtime的0.2.0无人消费，可以不保留其兼容性；mad-polaris根目录git init仅为agent工作辅助，不是monorepo目标。所有仓库干净/合入main、旧两个demo全修、BC所有文档清零、追平BC全部历史生成面、生产金融认证、任意动态DAG、符号级回锚都不是本轮结束条件。

**重试欠账不属于用户已接受的有限模型豁免，见第3节。** 不通过扩大其它范围掩盖该问题，也不因记录该问题撤销1134既定范围签收。

## 2. 当前基线：开工需重新核对，不能清理他人工作树

工作区：`/Users/zhongdj/Workspaces/mad-polaris`。下表为本交接写入前现场HEAD，无远程访问。

| 仓库 | 分支 | HEAD |
|---|---|---|
| bank-wealth-demo | feature/bank-wealth-truth-preview | `1ee497018d4578dfc33e1a09f830e4fec22e0a08` |
| metarch-truthsrc | execution-compiler-v1 | `114a327fd451fadf6a4dbe2ddc8d623837aff20a` |
| backkend-codegen | p15-p19-accepted-20261026 | `c612626f51bc5465d7466f122388cc87e6c9ef24` |
| saga-core | main | `4352a3173ee4e812762dcaa9c1aad58ff1551417` |
| monarch-core | main | `376b15282576fb3090cbc4fa0dbc059932e587b7` |
| monarch-persistence | monarch-0.2.1-hardening | `e6a6031a3b5a33d951ad63a6a21f99572ca0bf8b` |

- 银行原tracked干净，仅dist/、target/未跟踪；本文是本轮新增未提交文档。银行72个P32相关文件已分两笔提交，不能再写“银行尚未提交”。
- JS tracked干净，16项历史.rounds未跟踪，保留；main有独有bootstrap修正，不能直接覆盖或假定feature等于main。
- BC已有metrics、AGENT_COORDINATION.md及EP_Truthsrc_Standalone.md修改，大量未跟踪历史产物。不得批量add或认领这些改动。
- Monarch core有README/TUTORIAL修改及未跟踪VALIDATION；Persistence有README修改及未跟踪README-zh/VALIDATION；均不在本轮处理范围。Saga干净。

### 已完成与证据

- [1134发行签出](../v1/integration/RELEASE-SIGNOUT-1134.md)：原P26–P32共25项有界demo合同签收；两链完整冷构建、HTTP、指定恢复窗口、真实数据库/浏览器和安装位置复演是历史实测，不是本次重新执行。
- [1135提交合并报告](../.scratch/commit-merge-1135/REPORT.md)：5笔本地提交、2次本地主分支快进，未远程访问/推送/发布。银行发行Node97与Python5通过；旧默认基线284通过/1失败，原因是旧projections/index.json工具指纹陈旧，尚未修。
- 本次前序评估实测：当前银行v1/tree内存编译成功，3聚合、2 Saga、4 pipeline；release-bridge-1069完整14产品编译无诊断；公开generate-products --plan返回193文件、applied=false，目标未创建。不是应用重新构建或运行认证。
- 本交接轮仅源码/文档/Git只读核对。旧StepExecutor与strict行为判断来自源码，本轮没有故障复现或重新核实artifact字节。

干净可转交归档是`dist/bank-wealth-v1-darwin-x64-1134.tar.gz`，其SHA与安装前置见1134签出。**不能递归打包已经复演过的dist/v1；内部scratch有私有凭证与运行数据。**

## 3. 重试挂账：OPEN，未修复、未接受限制

**账目：真源声明的故障重试、退避及期限策略与strict执行路径尚未贯通。** 用户要求先挂账；不自动启动runtime修复，不能用“支持有限profile”把此账注销。

### 必须纠正的概念

- lowering是生成前把语义合同转换到目标runtime模型，不是运行故障后进入的状态。
- [runtime-binding-pure.mjs](../../metarch-truthsrc/lib/saga/runtime-binding-pure.mjs)当前拒绝maxAttempts>1、非零backoff与不同phase/query timeout；仅下沉interactionTimeout，总期限为未验证宿主义务。
- [render-host.mjs](../../metarch-truthsrc/generators/scala-cqrs-application/render-host.mjs)生成的maxReconcileInteractions=32是单次恢复授权的交互预算，不能当作业务重试次数。
- [StrictSagaCoordinator.scala](../../saga-core/src/main/scala/net/imadz/infra/saga/strict/StrictSagaCoordinator.scala)中，未知/超时等未决证据导致RecoveryRequired。授权Reconcile允许查证后继续，在满足安全未执行证据时可重发同一operation identity。因此不是“一辈子只能执行一次”。
- 仅journal replay不会自行重驱动。Reconcile可以由可信服务发起，不一定是人工点击；**银行谁在何时自动发起、遇连续故障如何退避和重启续接，本轮尚未核验。**
- 旧[StepExecutorCommandHandler.scala](../../saga-core/src/main/scala/net/imadz/infra/saga/handlers/StepExecutorCommandHandler.scala)有retry/backoff，不能拿另一条执行路径的能力替strict生成链背书。

### 该账未来的验收问题，不是本轮实施授权

1. 查明实际银行恢复调用者、触发机制、重试与查询预算、退避、期限及重启行为；以实际消费的路径和制品验证。
2. 明确尝试次数是否含首次请求、execute与query如何计数、预算怎样跨重启保留；真源值必须真正控制生成代码和执行行为。
3. 按确定未执行、结果未知、业务拒绝、已耐久commit分别设计处置。未知先核实，不能换交易ID盲目重扣；commit决定后不能改成abort/补偿。
4. 短暂故障在安全条件成立后应能自动继续；只有明确条件触发人工介入，不能把常见网络抖动永久挂成工单。
5. 通过暂时失败后成功、ACK丢失但已执行、连续故障耗尽预算、核实后同ID重发、恢复中再次重启等反例证明行为，并覆盖生成端与真源对应。

0.2.0兼容成本可移除，但P23已签出制品仍冻结；若未来需要改runtime，应使用新版本和新验证，不覆盖旧制品、journal或1134证据。教程可以解释已有恢复协议，但不得称此账已解决或所有故障已自动恢复。

## 4. 会话组织：先一个主实现会话，后一个教程消费会话

**本会话结束在交接；新主会话承担工具链集成owner。不要同时开多个会话修改JS公共入口、apply和query。**

| 会话/角色 | 负责 | 进入条件 |
|---|---|---|
| 新主实现会话 | JS本地项目入口、输入派生、回锚/反查/同步、对应测试和文档；统一集成 | 读取本文、重新核对写面、按仓库规范提出第一批具体方案 |
| 银行向导验证会话 | 使用稳定工具接口完成一次银行知识变更、再生成、双向检索和手写区协作示范；写可执行教程 | 主会话提供固定接口、工具版本/源码绑定和示例命令 |
| retry工作 | 当前只保留本账；独立核对/实施需要明确后续范围 | 不因本交接自动启动 |

教程会话不改公共生成器；工具缺陷反馈给主owner。不为每个会话复制完整交接或历史报告；各会话只提交本批变更、验证结果、阻塞和下一入口。不同手写模块可以委派并行，但共享合同先固定，生成操作由集成者串行执行。

上下文大小不是稳定性保证。每批结束留下：目标、实际改动文件、输入/工具版本、真实命令及退出结果、尚未解决项和下一步。新会话只读取这些及必要源码，不恢复165项旧混杂任务，不反复全工作区审计。没有自动创建会话、锁或资源占用机制的承诺。

## 5. 第一批：入口合同与最小可执行链

### 输出与范围

- 明确一个推荐的本地项目入口：真源目录与技术配置是作者输入，canonical/完整请求/编译产品/ledger/anchors是派生物。允许必要的显式绑定，不要求机器猜测外部实现，也不允许业务规则在多个JSON或脚本中人工双写。
- 修复`init`引用缺失样例，并检查目录布局、已有目录保护及生成后validate/roundtrip。当前README不能作为准确命令来源。
- 复用现有编译、产品准入和apply能力，将项目输入派生接成固定流程；不要再造编号runner或替代核心写入器。
- 用一个最小非银行fixture验证同一公共入口，再消费银行现有v1源/绑定验证适配；不复制银行资金逻辑为公共特例。
- 第一批先定义命令及配置合同、读写范围、返回结果和测试，再实现；本文不预造尚不存在的CLI名称。

### 优先复用/检查

工具根`../metarch-truthsrc`，以下路径均相对该仓：

- `AGENTS.md`、`SCHEMA.md`：作者输入规则。tree是知识编辑面；canonical不得手改，机器索引不进入真源。
- `bin/truthsrc.js`、`lib/compile.mjs`：CLI与compileTree。
- `lib/products/cli.mjs`、`lib/products/compile.mjs`、`lib/products/generate-cli.mjs`：文件捕获、编译与正式producer准入。
- `src/core/generate.mjs`：plan/applyEntries/ledger/实际文件回锚。已有MANUAL/KEEP边界，无跨文件事务或跨进程互斥，不绕过。
- `lib/query.mjs`、`lib/anchor-query.mjs`、`mcp/server.mjs`：后续双向消费所复用的查询/核验。
- `generators/_template/`：普通外部生成器扩展；正式generate-products是内置登记producer，两者不能混称通用插件机制。

银行输入组装参考[tools/v1-inputs.mjs](../tools/v1-inputs.mjs)，先区分公共派生与明确银行绑定。`bankApplicationRequest()`仍读取历史请求/authoring目录，不能直接冒称tree-only完整流程。`generators/pipeline.mjs`目前只输出queued manifest，不作为完成入口。

### 第一批验证要求

- 在全新自有临时目录中，创建最小树、validate、roundtrip、compile，检查输入未被重写；不可覆盖现有项目。
- --plan不写目标；实际生成通过唯一apply写入并产生真实文件锚。重复生成的差异应只限已明确的环境/路径字段。
- 不依赖BC服务、共享生成应用、历史编号scratch、warm缓存才能生成源码。应用构建的JDK/sbt/runtime依赖另作明确前置，不把“生成无服务依赖”包装成“应用运行无依赖”。
- 参数/源变更会反映到派生产物，未知能力拒绝，不静默忽略。缺失/无效输入不应先破坏目标。
- 新增对应测试并选定现有回归；不要盲跑整个Node test discovery，更不能带入银行暂停的domain-runner。

现有可复用测试入口示例（在JS仓运行；仅列命令，本交接未执行）：

```bash
node --test test/semantic-product-files.test.mjs test/product-generation-cli.test.mjs
node --test test/anchor-query.test.mjs test/generate-anchors.test.mjs
```

这些只是相关回归，不代表第一批所有新验收，更不等于Scala构建/银行业务通过。当前本机Node为22.23.4；SQLite图缓存需至少22.5，package/CI/README版本不一致需纳入工具交付整理，不通过删测试来掩盖。

## 6. 后续顺序与有限结束条件

入口固定后，由同一主owner补齐双向查询、输入与代码过期识别、增量再生合同；再将稳定接口交给向导会话。不是现在无边界实施所有项目。

整体交付按以下成果验收：

- 新用户从一个项目目录完成真源→编译→生成→文件级回锚，不手工维护第二套中间业务数据。
- 知识到代码、代码到知识都能操作，缺失/过期如实返回。source-verified只证明文件证据，不等语义正确；不增加symbol/span必交项。
- 改变一条已支持的知识后再生，手写内容保留，适配所需更改和测试明确；知识版本、生成结果与锚重新对应。
- 普通自定义generator示例和正式产品扩展说明真实可执行，不虚构插件发现/注册功能。
- 两个agent按不重叠手写模块完成一轮开发与集成；共享接口由主owner控制，不多进程生成同一目录。可参考[手写来源映射](../v1/integration/HANDWRITTEN-SOURCE-MAP.json)及[来源核验](../tools/v1-release-provenance.mjs)，不把银行专用映射宣称为现成通用功能。
- 教程解释建树、编译、生成、回锚、双向查询、持续同步、agent/MCP、自定义生成器及并行手写开发，并逐步实跑。银行演示保留付款/TA/独立退款/定投，不删除功能缩短教程。
- retry账保持可见；在有针对性实现和验证前不得宣称自动恢复能力完整，也不因其它教程通过自动关闭该账。

## 7. 操作边界

本交接批准只包括文档，不自动授权跨仓实施或runtime修复。新主会话先按当前请求和仓库规范确定第一批方案与写面。

- 不自动覆盖/重发三个P23 runtime，不触共享ingested-app/metarch-app。
- 银行旧tree、六根bindings、compiled、isolation-zone、qualification、tools/qualify-domain.mjs、test/domain-runner.test.mjs与旧证据受保护。不启动暂停runner。
- 不删除journal/失败产物、不覆盖成功exclusive回执、不读旧秘密、ps args/env，不复用旧泄露凭证。
- 不stash/reset/checkout清理，不广泛add，不删除worktree或根.git。
- 不自动下载、访问远程、push/tag/publish或新建worktree；提交和合并需当前明确授权。`--direct --dry-run`禁止组合。
- 重型执行位1；启动服务/容器须核对既有资源约定和授权，新目录/独占资源不等于可任意启动。
- BC若必须变更，先读其CLAUDE.md/AGENTS.md/MAINLINE.md、架构索引、active EP与AGENT_COORDINATION.md；BC历史KB断链未修，不伪造报告消红。

## 8. 给新主会话的启动文本

```text
请读取 /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/docs/TRUTHSRC-CONTINUATION.md，
以及 /Users/zhongdj/Workspaces/mad-polaris/metarch-truthsrc/AGENTS.md。
你是后续工具链收口的主集成owner。本轮先核对当前HEAD和相关dirty写面，
针对交接第5节“入口合同与最小可执行链”提出并按仓库规范确认具体实施方案。
不要重新全仓审计或接管旧任务列表。保留1134银行发行与既有保护面。
第3节retry仍为OPEN挂账，不接受为合理限制，但本轮不自动修复/重发runtime。
先统一公共入口与输入派生，复用现有compiler/generator/apply/anchors；
不要另造银行专用生成链。接口稳定后才向银行教程会话交付。
每批以实际命令/退出结果说明完成与未完成，不用测试总数替代原目标。
本文不是服务、下载、Git提交/推送或其它跨仓写入的无限授权。
```

新主会话从本文件开始即可；完整历史证据按需沿链接读取，不需要先把整个旧对话装入上下文。
