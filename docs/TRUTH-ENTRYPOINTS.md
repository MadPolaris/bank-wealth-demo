# 银行真源入口：作者目标、当前消费者与历史复演

日期：2026-11-04。状态：**新根配置与当前命令已实施；以下历史入口盘点保留，用于解释冻结输入。**

## 当前操作入口（实施后）

- `npm test` / `npm run test:current`：`test/unified-truth.test.mjs`，新源保真、覆盖和14产品验证。
- `npm run validate` / `npm run verify`：根配置指向的当前作者树，validate＋roundtrip。
- `npm run compile`：公共 `compile-project`。
- `npm run project:check` / `npm run project`：公共service plan／apply到`generated/current/`，旧失败验证输出不覆盖。
- `node tools/truthsrc-project.mjs status|query --out <owned>`：同项目输入/代码新鲜度与双向文件来源。
- 老validate/project/formal、V1 domain/service/joint直接CLI必须显式 `--historical`。冻结完整请求API无参拒绝；复演调用 `bankApplicationRequest({ historical:true })`，fresh V1 adapter仅用于历史比较。
- 新入口不读编号请求或旧authoring binding；必要技术选择迁到 `bindings/implementation/`，runtime/external source选项以项目相对路径显式提供。

[完整教程](TRUTH-TUTORIAL.md) 与 [迁移证据](TRUTH-MIGRATION-EVIDENCE.json) 是当前交付入口。以下表格描述改线前调用链和历史用途，不把旧`current`命名继续推荐给新用户。

配套 [TRUTH-MIGRATION.md](TRUTH-MIGRATION.md) 记录四流语义承接、JS `INBOX_PRODUCTS` 十三类覆盖和机械退出门。本文解释“一个命令实际读什么、可能写哪里”，不再复制业务模型，也不是本次运行回执。

本文最初按只读盘点建立，现已补入当前操作入口。README和 [continuation](TRUTHSRC-CONTINUATION.md) 的他人改动保持不动。下面旧命令表是历史消费者说明，不是推荐当前用法；历史运行结论不冒充本次新教程实测。

## 1. 新用户最终应只有一个作者入口

指定目标关系为：

```text
银行仓根 truthsrc.project.json
  → truth/bank-wealth/
    → contexts/bankwealth/
      → 当前领域原子、协作合同及明确分类的技术声明
```

- **根配置已建立并通过作者树与14产品准入。** 新开发使用本节入口；最终生成、再生和应用构建结果另以执行账为准。
- 不推荐`current/tree`、`v2/tree`，也不把`v1/tree`过渡位置写成新教程最终布局。`bankwealth`是沿用的显式业务context，不自动改成`bank-wealth`或BC的`main`。
- 新作者修改新源及明确的技术选择；canonical、完整request、编译产品、ledger、anchors是派生物，不手工维护第二套业务输入。宿主FQN、外置实现/测试路径、runtime pin及编码选择仍须显式说明，不靠工具猜。
- **本次旧根`tree/`与`v1/tree/`均冻结原路径/字节。** 新目标不意味着允许挪走、改写或删除它们；另行授权前只以它们作比较/历史输入。
- 旧工具通过显式历史选项仍可读取`v1/tree`作复演；这不是第二个当前编辑入口。缺新源/缺绑定会阻塞，不回退旧树。

## 2. 数据位置及实际用途

所有路径相对银行仓根；本文中的链接相对`docs/`。`JS`表示工具源码根，银行 [truth-source.mjs](../tools/truth-source.mjs) 实际使用`TRUTHSRC_ROOT`环境变量，未设置时解析相邻`../metarch-truthsrc`。

| 位置 | 当前实际用途 | 迁移后应归属 / 待处理事项 |
|---|---|---|
| [根tree](../tree/) | 旧导入/设计/合同。根validate、project、existing-contracts工具仍默认读它。 | 历史/兼容输入，不能混入新默认查询。字节不动；旧消费者明确标历史或拒绝当前模式。 |
| [v1/tree](../v1/tree/) | `V1_TREE`硬编码位置；domain派生和显式fresh service请求从这里读。 | 现行V1语义比较基线，之后作为冻结历史；新源承接通过前不宣称替代完成。 |
| 根六绑定 | `bindings.json`、`execution-bindings.json`、`runtime-binding.json`及对应三个`wealth-*`文件。旧工具合并读取，execution中的旧Saga副本还被核等。 | 根历史合同的配套输入，全部保护。不是新service从根树自动推导出的绑定。 |
| [v1/formal-inputs中的*-authored-*](../v1/formal-inputs/) | 原V1 adapter历史复演仍读取这些冻结文件；当前根项目不读它们。 | 当前必要技术选择已迁到 `bindings/implementation/` 并经14产品payload对账；重复embedded Saga删除，public union派生。旧文件不删改。 |
| `v1/formal-inputs/{payment,refund,ta,sip}-376/` | 四个冻结完整应用输入；`checkInputs()`要求四者request相同，scope标四个消费场景。默认`bankApplicationRequest()`直接读payment-376。 | 历史joint复演，不是每次从当前树重建的四份fresh请求。 |
| `v1/formal-inputs/domain-124/`、早期payment/refund/ta/sip编号目录、`design-363/` | 保存阶段输入。目录数字不是源新鲜度/产品能力证据。 | 历史定位，不作默认作者入口或自动fallback。 |
| `v1/formal-inputs/release-service-631/`、`release-pages-721/`、`release-final-936/`、`release-portable-984/`、`release-bridge-1069/` | 已存在的service/release捕获输入。continuation的14产品静态检查使用release-bridge-1069；不因此让该目录成为实时作者树。 | 冻结捕获，必须以选定请求/工具/源摘要解释；新消费使用新的显式捕获，不覆盖旧目录。 |
| [formal-inputs/existing-contracts/files.json](../formal-inputs/existing-contracts/files.json) | 根旧树＋六根绑定的三产品静态合同模板。工具以内存编译的canonical替换首文档并在新输出落盘。 | 旧合同兼容/历史输入，不是四流service请求；模板中的`canonical.json`不是当前权威源。 |
| [compiled](../compiled/)、[projections](../projections/) | 旧编译/预览产物。`projections`含index及context/event-flow/journeys/screen-flow等Markdown设计展示。 | 派生产物/历史证据，非新作者输入；尤其这些“projections”不是MySQL业务读模型。旧指纹过期不靠回写源或删除历史证据消红。 |
| [v1/handwritten](../v1/handwritten/)、[v1/test](../v1/test/) | 显式外置实现与测试；service options中的externalSourceRoots挂载。 | 不复制进generated，不把手写实现来源混作生成器自动回锚。关系见 [HANDWRITTEN-SOURCE-MAP](../v1/integration/HANDWRITTEN-SOURCE-MAP.json)。 |
| `target/bank-wealth-release-v1/`、历史`.scratch/`目标与回执 | 自有生成应用/阶段证据，有严格不同的路径检查。 | 不是作者树；不得复用旧exclusive回执、清理失败目录或覆盖成功目标。 |
| `dist/v1/`与1134干净归档 | 已签收安装/复演位置与冻结交付。 | 只按 [1134签出](../v1/integration/RELEASE-SIGNOUT-1134.md) 解释；本轮无重签出。不要递归打包运行后的dist/v1，内部scratch含私有运行数据。 |

注意：导入`truth-source.mjs`会进行工具指纹捕获，内部可能调用Git。本文只读源码，没有通过import、`--check`或包脚本来规避本轮禁止Git/执行的边界。

## 3. 关键分岔：默认snapshot与显式fresh不是一回事

依据 [tools/v1-inputs.mjs](../tools/v1-inputs.mjs) 及 [tools/v1-service-inputs.mjs](../tools/v1-service-inputs.mjs)。

| API / 调用 | 实际输入与转换 | 必须保留的解释 |
|---|---|---|
| `deriveBankDomainInputs()` / `bankDomainRequest()` | 编译`V1_TREE`；从canonical派生限定reference layout、decisions、dependencies、folds、external events。精确类型和codec部分仍由bank helper给出。 | 这是当前domain prerequisite，不是完整应用/service；七项domain产品不能冒充四流闭环。 |
| `bankApplicationRequest()`（无参数） | **现在拒绝。** 指定 `{historical:true}` 才读取冻结`payment-376/request.json`。 | 不再让未标历史的调用默读snapshot。显式`domainRequest`只留给已标历史的V1 adapter。 |
| `bankApplicationRequest({ domainRequest: bankDomainRequest() })` | 显式注入当前domain；追加四组`*-authored-*`文件，组装Saga/runtime/execution union；从canonical取hosts/artifacts/effects并派生designs。 | **显式fresh domain＋历史绑定依赖**，还不是仅树和新根配置驱动。它不是CLI的`--fresh`模式；现有v1-inputs没有这个flag。 |
| `writeBankApplicationInputs(target, scope, options)` | 内部显式调用`bankApplicationRequest({historical:true})`，写冻结文件请求及scope。 | 新目录仍是历史复演内容，不是当前作者请求；没有对应的`--write-application` CLI。 |
| `bankServiceRequest()` | 调用当前`bankDomainRequest()`，显式注入应用组装，核canonical相等；保留四个历史technical artifact及所有业务host，加入当前`bank-service`。 | 不走无参数snapshot。service改用artifact-contract@3、saga-host-contract@2、effect-host-contract@2，绑定payload仍按各自schema；不能过滤服务声明来凑旧profile通过。 |
| `writeBankServiceInputs(target, options, scope)` | 先编译并做完整准入，再写全套documents/files/request/compiled/options/scope；读回capture与API结果核等，保护原输入。 | fresh捕获及静态检查，不自动生成应用或证明runtime。仍包含上面的历史绑定依赖。 |

目录数字不再进入当前作者工作流。`V1_TREE`与bank helper仅服务历史比较；必要精确容量/codec、四组binding和外置root已进入当前根配置和具名技术文件，14产品payload保真测试通过。未来变化只编辑新源及这些明确技术选择，不修改旧helper来定义第二份当前业务。

## 4. 旧命令与读写目标清单（历史对照）

以下表格保留改线前的旧拼写以便识别历史证据，**不是可直接照跑的当前命令**。
直接调用旧CLI现在必须在文件名后加`--historical`；当前npm validate/project/
test等实际脚本已在文首列出，不能按表中旧别名判断。绝不启动暂停runner。

以下按银行仓根目录解释。`<ABS_...>`仅表示**调用者另行选择的绝对路径**，不是可原样运行的路径。未在本文运行任何一项；主会话后续应发布经过实际验证的新根配置教程命令。

### 4.1 根旧树消费者（应归为历史）

| 现有命令 / API | 实际读取 | 输出/副作用与迁移动作 |
|---|---|---|
| `npm run validate` / `node tools/validate.mjs` | `loadSnapshot()`默认根`tree/`、六绑定、BASELINE及设计/现金合同。 | 报告stdout；不是V1或新根验证。`validate.mjs`不接受`--tree`，不能加个参数假装已改线。 |
| `npm run verify` / `node tools/validate.mjs --roundtrip --check-projections` | 同上，另检查`projections/`。 | roundtrip创建/清理银行`.scratch/roundtrip-*`；不是完全无写入。保持历史归属，不作为新源当前门。 |
| `npm run project:check` / `node tools/project.mjs --check` | 根`tree/`及artifact提取。 | 对账旧`projections/`；不生成Scala，也不验证真实SQL projection。 |
| `npm run project` / `node tools/project.mjs --write` | 同上。 | **会重写旧projections。** 本轮不得运行；不能为修旧工具指纹而顺带认领这一写面。 |
| `node tools/formal-contract-inputs.mjs --out <ABS_NEW_BANK_SCRATCH_DIR>` | `captureExistingRequest()`编译根树，读existing-contracts模板及六绑定。 | 输出必须为银行`.scratch`内不存在的目录、已有规范无symlink父目录；写canonical、files、静态产品、probe/日志/receipt，并调用公共compile-products。只覆盖旧Saga/execution/runtime三个静态合同，不是四流新输入或运行资格。 |
| `npm test`、`npm run test:baseline`、`npm run test:current`、`npm run test:v1-contract`等包脚本 | [package.json](../package.json) 中显式列出的旧truth/projections/cash/mock/design/roadmap/P23测试组合。 | 名字含`current`或`v1-contract`不等于选择新根项目，更不等于1134应用全测。此处仅盘点，不执行或改脚本。 |

### 4.2 V1动态domain、冻结joint与fresh service

| 现有命令 / API | 实际读取 | 输出/目标边界与迁移动作 |
|---|---|---|
| `node tools/v1-inputs.mjs --check-domain` | 当前`v1/tree`和domain helper。 | stdout标`domain-input-derived-not-full-request`、`fullRequest=false`。未生成应用，不能替代完整service准入。 |
| `node tools/v1-inputs.mjs --write-domain <ABS_NEW_DIR>` | 当前domain request。 | 写domain documents/files/request/compiled/options。实现只检查目标不存在，**没有service那样的路径沙箱**；调用者必须另行确权，不能指向受保护路径。 |
| `node tools/v1-joint.mjs --check` / `npm run v1:joint:check` | 默认payment-376 snapshot，与四个`*-376/files.json`及compiled/scope核等。 | 不从当前树重新生成完整请求；V1树前后指纹检查只说明未改树。应明确命名为历史joint检查。 |
| `node tools/v1-joint.mjs --plan payment`（也接受refund/ta/sip） | 对应`*-376/files.json`及options；生成器`scala-cqrs-effect-application-v2`。 | 计划哨兵为银行`.scratch/v1-plan-never-written`，必须不存在；预期`applied=false`且不创建目标。是历史profile计划，不是当前service。 |
| `node tools/v1-joint.mjs --test-target <ABS_TARGET> --evidence <ABS_FRESH_PREFIX>` | 已存在且锚SHA有效的joint生成目标，另挂`v1/handwritten/scala`和`v1/test/scala`。 | 目标形状必须为`.scratch/p24-p25-bank-joint-<owner>/targets/<app>`；证据prefix位于同一round。会启动Java/sbt做compile/Test compile/test，写exclusive日志/回执；**本轮禁止运行**，不是新根默认测试。 |
| `node tools/v1-service-inputs.mjs --check-service` | `bankServiceRequest()`：fresh V1 domain＋四组历史绑定＋当前service原子。 | 公共编译静态检查，无应用生成/运行。不能以此名义宣称已摆脱历史authoring。 |
| `node tools/v1-service-inputs.mjs --write-service <ABS_NEW_RELEASE_DIR> --options <ABS_OPTIONS_JSON> --scope <ABS_SCOPE_JSON>` | 同上，显式完整options（含runtime pin/外置根）与新scope。 | 目标必须是银行`v1/formal-inputs/release-<new-id>`直接子目录，规范绝对路径、plain父目录、exclusive新建。准入前不创建输出；不能覆盖631/721/936/984/1069或其它历史目录。未来新根捕获位置须由主会话明确适配，不让读者永久维护编号目录。 |
| `npm run test:v1-inputs` / `npm run test:v1-joint` | 运行package中对应Node测试。 | 只说明各自消费者测试范围；并不自动执行完整V1 release或新源迁移门。本文未运行。 |

四个冻结joint scope实际入口为`FundPurchaseSettlementRequested`、`FundPurchaseRefundRequested`、`FundTASubmissionRegistered`、`SipInstallmentTriggered`；实际pipeline分别为`bank-cash-payment-v1`、`bank-independent-refund-v1`、`bank-ta-submission-v1`、`bank-sip-dispatch-v1`。当前新implementation note已采用这些名称，原V1 note的旧refund/TA/SIP错名保持为历史证据；修正映射见 [迁移表第4节](TRUTH-MIGRATION.md#4-已定位的名称所有权和历史来源漂移)。

### 4.3 公共生成、release与冻结交付

依据 [v1-release-generation.mjs](../tools/v1-release-generation.mjs)、[v1-release.mjs](../tools/v1-release.mjs) 与 [1134签出](../v1/integration/RELEASE-SIGNOUT-1134.md)。

| 现有入口 | 输入、目标及边界 |
|---|---|
| 公共JS `node <JS>/bin/truthsrc.js generate-products --request <ABS_INPUTS>/files.json --generator <JS>/generators/scala-cqrs-play-service --options-json <ABS_INPUTS>/options.json --out <ABS_JS_TARGET> --plan` | 消费指定捕获输入，不自动证明与当前树一致。去掉`--plan`会实际生成；本轮不运行。银行`generateReleaseJs(inputs,target)`先调用checkReleaseInputs，再plan、再apply。 |
| `checkReleaseInputs(inputs)` / `generateReleaseJs(inputs,target)` | inputs限定在`v1/formal-inputs/release-*`；capture=request、编译结果=compiled均核等，必须有service及非生成区外置根。**这个helper本身的核等不是与新作者源实时核等**。target须为`target/bank-wealth-release-v1/<owner>/<iteration>/js-app`且不存在。 |
| `bcReleaseTasks(inputs,target)` | 是返回任务的API，不是可直接传flag给该文件的CLI。目标须为相同root下`<owner>/<iteration>/bc-app`且不存在；任务显式设置`codegen.semanticProductsFile=<inputs>/compiled.json`、`codegen.productOptionsFile=<inputs>/options.json`、`codegen.productTargetProfile=scala-cqrs-play-service@1`、`codegen.targetDir=<target>`，调用`net.imadz.codegen.CodegenMain`。不使用raw生成器默认目标；本轮不进入BC执行。 |
| `node tools/v1-release.mjs --check --manifest <ABS_MANIFEST> [--output <ABS_FRESH_BANK_SCRATCH_JSON>]` | 老manifest分支核指定snapshot/回执；若提供generation，另与`bankServiceRequest()`核等并预检明确JS/BC新目标。不执行生成、构建或服务。可写显式exclusive报告；不是整包pass入口。 |
| 同入口的 `--run --manifest ...` | **仍是旧只读证据编排分支**，不是1134执行器；旧summary保持recorded-summary-only，不因flag叫run就自动验收。 |
| `node tools/v1-release.mjs --check --execution <ABS_NEW_EXECUTION_JSON>` | 独立v2执行配置的预检分支，不能与`--manifest/--output`组合；源码显式返回非签收`exitCode=2`。这里的“v2”是执行配置版本，绝非新真源`v2/tree`。 |
| `node tools/v1-release.mjs --run --execution <ABS_NEW_EXECUTION_JSON>` | 受控执行器按新配置驱动生成/构建/HTTP/恢复/数据库/证据/提升及安装复演。1134已通过的是它当时冻结的配置与候选，不是本次重跑。任何新执行都需独立授权、供给/资源与新exclusive位置；禁止原样重跑1134配置或覆写`dist/v1`。 |

`v1-release-generation`的目标约束与v2发行胶囊/安装复演内的配置目标不可混为一套默认路径；实际执行目标、argv和供给由选定配置及冻结作者绑定。不能因为历史目录存在，就将其用作新根教程输出目录。

## 5. 暂停入口和绝不能隐式恢复的旧写面

[1128授权处置](../v1/integration/AUTHORIZED-DISPOSITION-1128.md) 已决定13个草稿文件保留跟踪、原路径和原字节，**继续暂停，不运行、不修复、不算V1已验成果**。这里的13个文件不是十三类知识覆盖。

- [tools/qualify-domain.mjs](../tools/qualify-domain.mjs) 及 [test/domain-runner.test.mjs](../test/domain-runner.test.mjs) 不得运行；前者`--generate/--test`围绕`qualification/fund-order-cash`、根旧snapshot及`.scratch/domain-qualification`创建资格测试产物/可能启动Scala，不是新根通用生成门。
- `qualification/`、`isolation-zone/`、`compiled/`、根树、六绑定、旧证据继续保护；默认package脚本明确排除暂停runner，不以全量Node discovery绕过。
- 不用root validate通过、旧domain资格草稿或旧两participant演示替代当前四流service；也不为了新根改造“顺手修复”旧暂停工具。
- 不删除旧journal/失败产物、覆写exclusive成功回执、复用旧760数据库/凭证或把它们放进教程。此处不读取秘密或运行配置值。
- P23三个`0.2.1-p23.20261027.1`冻结runtime及1134证据不变。<u>retry/backoff/deadline仍OPEN</u>；指定恢复窗口通过不等于自动重试策略贯通，新入口工作不自动授权runtime修复/重发。

## 6. 切换状态与验证边界

根项目已作为新作者和默认包命令入口。精确退出断言见 [迁移门M0–M11](TRUTH-MIGRATION.md#6-精确机械退出门与实际状态)；新源码生成/单元/构建与完整运行验收分开，不以本次入口切换重签1134。

| 动作 | 要得到的可检查结果 | 状态 |
|---|---|---|
| 固定新根合同 | 配置、系统/context声明与原子语法/版本明确；`truthsrc.project.json → truth/bank-wealth/contexts/bankwealth`唯一有效，未支持组合拒绝。 | 已实施并通过正/反向作者合同测试。 |
| 承接当前事实 | 四流、十三覆盖、角色/叙事/读模型缺项和旧entryOwnership/消息名漂移在**新源**解决；旧树与证据不改。五层review的proposal/null审批状态不得擅改。 | 已补齐15个描述性原子；执行声明逐项保持，四份五层review状态未改。 |
| 取代混合组装依赖 | 新当前请求不读`payment-376`兜底；四组authored绑定及helper中的必要事实有唯一新源/技术选择，完整请求由公共链派生。 | 已改线：14产品通过；配置只用当前树＋具名技术选择；历史无参fallback已拒绝。 |
| 标定每个旧消费者 | 根validate/project/formal、domain、joint、service、release各自明示当前或历史；不能留下“current”检查实际读旧snapshot的歧义。保护runner只标暂停。 | 当前包脚本已改线；旧CLI要求historical；旧发行和暂停runner保持原边界。 |
| 验证后才默认 | 新候选先完成源覆盖、语义保真、完整产品、目标保护/稳定再生、回锚与四流不退化检查；主集成者再启用根配置默认，并核缺配置/旧输入不静默回退。 | **当前作者与默认命令已切换**；最终生成/构建结果见验收账，未重跑1134运行窗口。 |
| 补可执行教程与完成字段 | 主会话接好命令/config/code，按实际执行说明编辑哪里、生成到哪里、如何回查与安全再生；覆盖付款/TA/独立退款/SIP。历史复演置于独立附录。 | [教程已写](TRUTH-TUTORIAL.md)，实际命令与退出码按执行账填写。 |

1134只关闭其原25项有界本地demo合同。上述新作者入口、源覆盖、迁移及教程完成与否必须用新证据判断；不能借1134签收、旧静态产品数或本次新增文档，宣称已完成新根统一、完整五层审批或重试修复。
