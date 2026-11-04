# P32 捕获供应逐边分析（1065）

最后更新：2026-11-03

**87项历史missing-pom已完成可复算分类，但没有因此解除冷解析或发行阻塞。** 本文接续repair-1056及本地提交Bank `49b2642`／BC `c612626f`；不改写旧供应清单、旧回执或提交。

证据根：`.scratch/p26-p32-bank-v1-59o__arv/p32-supply-1065/`。`ANALYSIS-F.json`是两轮边界加固后的完整分析；`REPRODUCTION-F.json`记录全报告确定性复算；各执行目录`result.json`绑定作者/输入/源码、stdout/stderr哈希与真实退出。最终保全见`VERIFICATION.json`。

## 已核分类

| 项数 | 已捕获事实 | 不能据此推导 |
|---:|---|---|
| 5 | 被选择的sbt插件具有同identity/build axes的原生Ivy描述及制品 | 已有等价Maven POM，或冷resolver不再查Maven |
| 1 | `org.portable-scala:sbt-platform-deps:1.0.1`的实际仓库坐标为`_2.12_1.0`；捕获的legacy无后缀POM文件与报告build axes对应 | 可对任意插件猜后缀、伪造POM |
| 44 | 非选中精确版本；旧collector会跟随的POM请求边全部为provided | 已证明不需要该版本元数据；bridge源码编译依赖可忽略 |
| 26 | 非选中compile请求；app/meta报告记录了同模块另一版本及其具体使用配置 | 已发生可证的eviction，或“最新版本必胜” |
| 11 | 非选中compile请求；另一版本仅见bootstrap制品库存 | 该版本已由app/meta报告选中 |

六个原生描述核对对象是：sbt-twirl 1.5.1、sbt-native-packager 1.5.2、sbt-javaagent 0.1.5、sbt-web 1.4.4、sbt-js-engine 1.2.3，以及sbt-platform-deps 1.0.1。分类工具按实际报告artifact到manifest artifact/module再到描述内容与build axes核对，不按插件名字白名单通过。

## 数据范围与证据精度

- 输入仅为supply-998清单列出的**1506文件**。每文件SHA/长度先校验，分析后再次核SHA；不读取manifest中的历史origin路径或宿主缓存。
- 两份captured update report共**1432个module occurrence**；保留app/meta、外围report配置、原JSON pointer、原coordinate/build axes、artifact映射、exclusions、callers和evicted。所有evicted均false、callers均空，全部details为空；缺少实际淘汰/调用边历史。
- 解析**4201条**POM dependency／dependencyManagement／parent声明，逐条保留文件SHA、XPath、原始版本表达式、父属性输入链、scope/type/optional和排除声明。87项均有匹配的精确请求边。
- 另有**433条版本未显式声明**，以及logback-parent中两条`${groovy.version}`未解析的managed声明。这435条均不在旧collector的可跟随显式普通依赖子集内，仍逐条输出；工具没有模拟完整dependencyManagement、profile或冲突选择算法。
- 分类完整性仅针对所声明的捕获子集；没有报告角色、普通可跟随边未解析、父POM不可得或报告problem/missingArtifacts时，不作provided-only等穷尽分组。unknown不伪装成negative evidence。
- 每项仍带`coldResolverRequirement: unknown`、`downloadRequiredProven: false`、`evictionReasonProven: false`。原manifest的87项逐字保留，未重捕获、删除或改绿。

## 许可与bridge仍阻塞

唯一`missing-license-evidence`仍为`com.typesafe.sbt:sbt-twirl:1.5.1`。`TWIRL-LICENSE-CHECK-F.json`／`twirl-license-f`已实际核插件描述与JAR：捕获插件Ivy无许可声明，插件JAR没有嵌入LICENSE/NOTICE证据。相关twirl-compiler/API/parser 1.5.1的Apache-2.0声明属于其他坐标，不能因同版本/同项目/依赖关系而继承给插件。此检查执行成功的业务结果仍是`blocked-plugin-specific-license-evidence-missing`。

3项derived compiler-bridge冷重建欠门仍在。本次没有编译桥、运行冷sbt或部署；provided分类不能消除bridge源码编译要求。原有预填bridge的23生成tests不等完整银行141冷验收。

## 工具与复演

- `tools/v1-release-supply-analysis.mjs`：只读分析加exclusive scratch输出。
- `tools/v1-release-supply.mjs`：仅导出既有XML读取函数，旧collector逻辑不变。
- `test/v1-release-supply-analysis.test.mjs`：fixture覆盖角色/配置分离、原表达式与父输入、bootstrap区别、Ivy/cross axes核对、unknown、evicted事实不推原因、哈希/路径/symlink/重复与exclusive输出。

调用形状（output必须是新的owned scratch路径）：

```text
node tools/v1-release-supply-analysis.mjs --config /absolute/config.json --output /absolute/bank/.scratch/owned/new-analysis.json
```

配置仅含`supply`与`manifestSha256`。成功退出只表示分析完成，不表示供应闭包或P32通过。最终`tests-f`四文件85/85；扩大到原九文件加analysis的完整Node回归`full-node-f`为140/140，零失败/取消/跳过；完整分析经`reproduction-f`复算相等。analysis自身38个测试覆盖库存与记录hash分别缺失/错误、报告完整身份、原型属性名、POM声明身份、父别名、artifactless选择、已知GAV附未知字段、Ivy根元素/轴位置/多轴变体、同制品重复报告引用及缺少cross-build属性。两轮独立复核发现的边界已转为测试；不把静态复核当实际冷解析。

旧`tests-b`58、`full-node-c`113、`ANALYSIS-B.json`及E窗口80/135全部保留，均是此前代码窗口，不代替F窗口。F分析仍为5/1/44/26/11，未新增analysis issue；433+2未解析声明保持。本次未再跑银行Scala套件。

## 未解决项的准确落点

1. **冷resolver元数据闭包**：分析提供请求/替代/原生描述证据，未证明干净解析无需87份POM；需要真实有界file-only解析或能记录请求路径的解析证据。不能直接把这些项从manifest删掉。
2. **插件许可**：当前捕获不足，仍需要能明确覆盖该插件/版本的许可依据；未获联网下载授权，不自行补取。
3. **完整搬移/冷运行**：生成器、输入、ext、完整银行tests、供应与配置需共同搬移并实跑；只改target路径不是该成果。
4. **完整release/dist**：目前release工具只计划/摘要核对；尚无串完整生成/测试/恢复/逐要求认证/dist writer的实现。本次analysis不得提升为该执行器。
5. **KB #201**：工作区文件名搜索未找到`UX_ROADSHOW_FINDINGS.md`，没有可核的替代链接；不新造报告或静默删引用。
6. **历史事故**：旧凭证轮换、13个误纳Git路径和缺失/被覆盖证据仍单独保留；本次无删除、轮换、历史改写或再次提交。
