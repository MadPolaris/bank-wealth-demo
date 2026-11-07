# 银行示例的构建配方：什么来自哪里，先做什么

这个仓库不是“把一棵truth送进生成器，就自动得到全部银行应用”。**业务知识、技术选择、手写实现、独立测试和工具源码是不同的输入；公共工具只确定性加工它支持的那部分。** 本文说明今天怎样理解与重建银行，以及历史目录为什么仍在。实际命令和读写副作用以[入口表](TRUTH-ENTRYPOINTS.md)为准，通用产物职责以[公共构建顺序](../../metarch-truthsrc/docs/artifacts/scala-cqrs/BUILD-ORDER.md)及[artifactType目录](../../metarch-truthsrc/docs/artifacts/scala-cqrs/README.md)为准。

## 1. 从新业务开始，哪些信息必须有人提供

| 输入 | 谁负责 | 公共工具能做什么，不能做什么 |
|---|---|---|
| 业务知识 | 业务owner和获授权的人/agent | 校验、展开结构与编译明确的命令/事件/规则/协作；不能根据散文猜金融政策或补造工作坊决策 |
| 技术选择 | 架构/技术owner | 按profile解析包、类型、codec、端口、存储和runtime binding；不能自动选择未声明的供给或迁移持久化身份 |
| 开放实现 | 开发者/agent | 生成端口和已有结构，挂载独立手写根；不能仅凭来源关联重建业务owner、TA、页面或安全准入实现 |
| 独立预期 | 业务与测试owner | 生成结构性测试、执行指定suite并核回执；不能把生成结果本身当独立金融oracle |
| 工程工具 | 工具维护者 | 提供公共compiler/writer/取证机制，业务仓提供配置和adapter；工具源码也是开发成果，不是银行truth的生成输出 |

[Counter教程](../../metarch-truthsrc/TUTORIAL.md)提供新项目起点，可先独立学习编译、生成和反查。它不是银行业务模板，更不自动补全上述信息。知识工厂/工作坊产生或整理知识，coding agent实施选择并写工程代码，两者都需要明确的来源和验收边界；不能把“agent写的”简称为“真源可再生的”。

今天银行的作者入口只有根`truthsrc.project.json`，它选择`truth/bank-wealth/`、8份具名技术binding和14项语义产品。三者共同构成公共编译输入；不人工维护第二份完整canonical/request。相关身份与作者规则见[TRUTH](../TRUTH.md)。

## 2. 今天重建银行的实际顺序

### 第一步：取得配套源码，只验source

使用自己的银行checkout及配套完整`metarch-truthsrc`工具checkout。先执行source doctor，再validate（包含roundtrip），再compile。**这一步不需要JDK、Docker或发行归档。** 编译得到展开知识和严格产品结果，输出到stdout；roundtrip使用临时重建目录，不生成银行Scala、不启动服务，也不持久化知识图。

新业务可从公共初始化入口开始；重建本银行则直接使用现有作者输入，不需要再走一遍历史导入或创建`formal-inputs/`。

### 第二步：具备实现、测试与冻结供给

当前银行独立维护35份`handwritten/scala/`实现、31份`test/scala/`固定预期，以及14份许可/来源记录。它们不是compile的输出。构建时通过配置挂载手写实现；只有选定验证模式才追加相应固定测试，不把全测试目录挂上。

完整银行生成还需三个冻结runtime的JAR/POM配对，共六个成员。现有prepare从**clean1134**归档校验提取，不编译或发布runtime。该材料尚无已落实的公开自助取得渠道：本机有归档、源码能安装，不等于新读者已经能下载全部银行构建材料。

### 第三步：公共生成，保持实现与生成物分开

先预览，在明确的新输出目录生成。公共链路捕获作者/技术输入，经知识图导出AST、产品计划及writer产生代码/配置、ledger和anchors；最终代码锚写回同一项目图。`--plan`使用内存图，不写生成目标；实际apply可能先更新项目图再在后续失败，不能承诺全链事务回滚。

生成内容包括受支持的领域/应用层、Repository/Bootstrap、JDBC读侧基础设施、服务接线与生成测试。API业务组装、owner、外部系统适配和页面实现仍可来自手写根。构建时ScalaPB再产生managed sources；这些与truthsrc直接产物不是同一份文件计数。完整职责见[架构入口](architecture/README.md)。

### 第四步：先验回锚，再验代码和业务

按[工作坊](BANK-WORKSHOP.md)选范围，而不是用一个总`passed`代替所有门：

1. source严格编译；需要anchors以上范围时准备供给。
2. fresh actor候选先经公共回锚核验，再运行固定actor64范围。
3. 另一份fresh readside候选回锚后运行readside47。两模式共享23项生成测试，不能相加冒独立覆盖。
4. 比较候选的完整源码/配置和来源摘要；已有通过回执属于当次候选，源码/工具变更会使其过期。
5. service范围另生成第三份同源候选，只编译固定runtime mains，再以新owner、端口、数据根进入授权的24恢复窗、真实数据库、HTTP和浏览器验收。
6. 完整service确实通过后，才允许独立的新owner人工session。手工打开页面、代理检查、source和Node测试都不能替代真人上手签收。

当前service02在initial/restart/refund后，**新SQL读库replay未在90秒内caught-up，完整service失败，人工session未执行**。不能延长期限或拼接其它回执改成通过。它消费P23，不是R2。详见[运行结果](V1-RETIREMENT.md)及[R2下游边界](MONARCH-R2-DOWNSTREAM.md)。

### 第五步：正确输入上修改，受控更新

知识变更改作者树，技术选择改binding，开放实现改手写根；分别执行适用的validate/roundtrip和显式测试。已有生成输出先status，再审阅`--update --plan`，最后由输出owner应用。不要手改生成Scala、build、canonical、ledger、anchors来消除差异，也不要修改独立oracle迎合代码。

## 3. 全部一级目录：默认要看什么，什么只是历史

当前有13个包含受跟踪文件的一级目录。本表是解释，不是删除或移动授权；P3物理目录收敛仍未完成。

| 目录 | 信息来源与维护者 | 当前用途 |
|---|---|---|
| `truth/` | 获授权业务作者维护的明确知识与来源 | 唯一现役业务树；不放运行回执、临时产物或人工canonical |
| `bindings/` | 技术owner选择；根配置引用8份implementation文档 | 现役编译技术输入；不覆盖业务规则 |
| `handwritten/` | 开发者/agent实现的银行扩展 | 当前35份Scala，独立挂载；来源映射不代表可自动生成 |
| `test/` | 测试owner维护的预期与工具合同 | 当前31份固定Scala与显式Node/Python suites，也含历史/暂停测试；禁止全仓发现 |
| `simulator/` | 工程实现的MockTA状态、协议和journal | 基金公司/TA模拟；现役worker显式配置，旧wrapper另有历史默认输入 |
| `tools/` | 历轮工程开发编写的工具源码 | 现役adapter、尚待抽离机制、共享历史政策、旧发行与暂停入口并存；不是truth输出 |
| `docs/` | 文档/架构owner及已标识的派生清单、回执 | 当前导航与事实说明；原验收证据保留原时点 |
| `third-party/` | 上游许可和来源记录 | 14份保护材料，不是生成器自有业务实现 |
| `formal-inputs/` | 旧三合同运输模板和历史适配 | 历史输入，不是当前编译的必经阶段；旧README命令未带`--historical`，不可照抄为现役入口 |
| `projections/` | 旧notes/artifacts经历史project工具生成的文档投影 | 历史导航，不是当前JDBC Projection实现或SQL读库 |
| `compiled/` | 早期导入的合同级Saga/execution IR | 保护的历史产物，不是今天compile的默认目的地 |
| `isolation-zone/` | 导入的示意Scala脚手架/adapter/演练 | 历史设计材料；不能据generated标题推断当前可编译或已认证 |
| `qualification/` | 旧领域资格实验的工程草稿 | 暂停，不执行、不修补或删除；连同指定tool/test共13份保护草稿 |

根`truthsrc.project.json`和`package.json`分别是项目技术入口和显式命令表。六份**根级旧绑定**`bindings.json`、`runtime-binding.json`、`execution-bindings.json`、`wealth-bindings.json`、`wealth-runtime-binding.json`、`wealth-execution-bindings.json`属于历史合同；不要与现役`bindings/implementation/`混淆。

本机还可能存在下列派生目录，不能把它们当新clone自带或可随意删除的内容：

| 本地目录 | 谁产生，保留什么 |
|---|---|
| `.truthsrc/` | 公共项目生成产生的知识图/编译/输入证据；不是人工作者面 |
| `generated/` | 显式公共generate/update的自有工程；不可手改覆盖冲突 |
| `target/` | 新候选、构建缓存、独占运行证据；旧失败回执保留 |
| `.local/` | 校验后的冻结供给、owner TA数据与配置；可能含私密内容 |
| `.scratch/` | 旧实验/运行窗口材料；不是默认开发前置，清理需逐项核定 |
| `dist/` | 本机发行或安装运行材料；不能从已运行目录拼装公开包或读取旧秘密 |

原两棵作者树及旧V1材料通过[固定Git历史入口](HISTORY.md)读取，不重建第二棵现役作者树。原journal、数据库、失败候选和授权保留的草稿不因目录显得复杂而删除。

## 4. 工具从哪里来，公共部分现在在哪里

全部工具的逐文件职责、来源依据、现役/历史/暂停状态、调用证据与公共回流状态见[TOOLING-OWNERSHIP.json](architecture/TOOLING-OWNERSHIP.json)。库存包括原62份源码及本轮两个薄adapter，共64份：60 MJS、3 Python、1 Scala。它们是工程源码，不是64个独立CLI，也不是64种artifactType。

本轮已有公共机制：

- `handwritten-provenance`：显式文件/知识关联校验。银行保留snapshot、35文件/54引用与关系政策。
- `verification/files`：规范路径、有限同缓冲区文件取证。银行保留plain POSIX路径、`.scratch`禁入和系统Python例外。
- `verification/process`：受限进程、脱敏、排他日志、取消/清理及静态回执检查。银行保留schema、profile和场景选择。
- `verification/worker-evidence`：纯线程协议/关闭证据校验。银行保留TA路径、schema、fixture、锁和金融journal政策。
- `verification/tooling-ownership`：只读库存/声明引用校验，不执行被检查工具。

公共模块随工具包的`lib/`发布内容打包，但本次不代表已经发布到npm或Release。独立消费验收使用本地tarball离线安装并迁移prefix；银行现役wrapper仍显式引用配套sibling源码，不能冒称银行已全量切为npm依赖。

`npm run test:public-tools`检查银行适配与工具库存。公共检查器只承诺显式候选集合全覆盖、文件与引用存在并取证；`candidateCompletenessVerified`、`semanticsVerified`、`executionVerified`、`importClosureVerified`均为false。银行测试独立对照Git库存，新primitive另有fresh-import验证。**字符串引用可以出现在注释中，不能将此清单当通用程序分析器或调用真实性证明。**

当前会话清理不再为了worker退出检查而提前加载旧crash/release-build模块；lease不再为文件原语加载完整build/admission。但现役crash/report仍借用历史crash政策，browser仍借用旧browser政策。旧`v1-`名字不等于无调用；历史工具原字节保留，不能整目录搬到公共仓或删掉。

其余P1尚有完整lease、build/report、工作坊编排、Docker资源与历史银行政策分拆。基础source CLI没有因此新增JDK/Docker要求。

## 5. 仓库实际形成的先后关系

这不是一条凭今天作者树完整重演的历史流水线，而是可从Git与[历史索引](HISTORY.md)核对的工程演进：

- 10月25日起导入业务/设计示例、旧真源、IR和示意脚手架，逐步补MockTA与文档投影。
- 10月27日至11月2日围绕P23合同、供给、三合同输入运输、双链生成、手写实现、固定测试与发行验收推进。
- 11月5日形成唯一当前作者入口与教学闭环，增加当前候选的独立构建/运行校验入口。
- 11月6日完成作者压缩、旧树退役、Repository/JDBC兼容消费、工作坊编排和有界V1目录迁移。
- 11月7日形成兼容聚合模型/模板切片与独立工程参考，首个公共手写来源能力回流；本轮继续文件/进程/worker机制和构建配方。

这里没有追认BC mjs产物为金样，也没有把独立Warehouse工程候选称为用户批准的新标准。设计参考、机械测试和真实服务运行是不同证据。

## 6. 怎样判断交付有没有完成

本配方和库存解决“内容怎么来的、谁编辑、通过哪个工具变成什么”的解释问题；公共adapter实际消费解决一部分工具归属问题。它们不关闭所有P1，更不关闭全量Scala命名/多模块参考、P3目录收敛或P4业务服务。

仍开放：service02新读库重放、供给公开自助取得、真人上手、retry/backoff/deadline **OPEN**，以及独立R2下游升级。当前事实与验收入口统一看[TRUTHSRC-CONTINUATION](TRUTHSRC-CONTINUATION.md)，不通过重写历史回执或替换冻结依赖获得“全绿”。
