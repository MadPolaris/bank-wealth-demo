# 历史索引：固定对象，不是第二作者入口

日期：2026-11-06。本页只定位历史材料，不重签回执，不证明远端已推送或发行材料已发布。当前作者合同见[TRUTH](../TRUTH.md)，当前命令见[ENTRYPOINTS](TRUTH-ENTRYPOINTS.md)。

## 两个固定revision

| 用途 | 完整revision | 原路径与依据 |
|---|---|---|
| 已退役的两棵作者树 | `675a9366cf270995ef714e505e42c19652f0e4f0` | `tree/`、`v1/tree/`；430文件与14产品基线见[TRUTH-LEGACY-BASELINE.json](TRUTH-LEGACY-BASELINE.json) |
| 本次精简前的材料 | `4515b6b97d91714116b451b4e930dc81e112e528` | 原`v1/`、README、continuation、入口表和两份顶层handoff；577份`v1/`逐文件对象/字节/SHA及归属见[V1-RETIREMENT-MANIFEST.json](V1-RETIREMENT-MANIFEST.json) |

两个commit及下列主要文档对象已在本地以`git cat-file`核实存在。**可定位不等于每个clone都有这些对象**；浅clone或缺对象时应报告缺失，不能改读HEAD、当前作者树或猜一个下载地址。此处不用未经核验的远端blob链接。

在自己的银行checkout根目录只读查看，例如：

```bash
git cat-file -t 675a9366cf270995ef714e505e42c19652f0e4f0
git cat-file -t 4515b6b97d91714116b451b4e930dc81e112e528
git ls-tree -r --name-only 675a9366cf270995ef714e505e42c19652f0e4f0 -- tree v1/tree
git show 4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/RELEASE-SIGNOUT-1134.md
```

`revision:path`是Git对象定位，不是当前工作树文件路径。下文链接跳到本页的固定定位段落；读取其它文件时使用所列完整对象，不将旧目录checkout回来覆盖当前源码。

## 本次目录精简怎样保留历史

- 35份手写源码迁到`handwritten/scala/`，31份固定测试迁到`test/scala/`，14份许可迁到`third-party/`；迁移要求原字节不变。
- 其余497份`v1/`材料通过上述精确Git对象保留，不复制一整棵可编辑历史目录。必要历史消费者只读选定对象，不能隐式回退。
- 当前手写关系位于[`architecture/HANDWRITTEN-SOURCE-MAP.json`](architecture/HANDWRITTEN-SOURCE-MAP.json)，绑定当前快照、35文件和54条文件级来源引用；原版本仍在固定对象内。[验证方法](architecture/HANDWRITTEN.md)不将文件关联提升为自动语义或运行证明。
- 实际迁移与逐字节对账、新候选各层验证记录在[V1-RETIREMENT.md](V1-RETIREMENT.md)；manifest只描述保存方式，不能代替验收。
- 已明确清单的保护集合、六根bindings、暂停草稿、旧journal/失败材料与回执继续保护。目录精简不扩大授权为清理旧证据或改金融政策。

<a id="release-1134"></a>
## 1134：原有界发行与25项矩阵

| 材料 | 固定Git对象 |
|---|---|
| 发行签收 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/RELEASE-SIGNOUT-1134.md` |
| 25项验收矩阵 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/ACCEPTANCE-MATRIX.md` |
| 冻结执行配置合同 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/RELEASE-EXECUTION-V2.md` |
| 当时完整输入 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/formal-inputs/release-bridge-1069/`（tree对象） |

1134签收的是原P26–P32共25项有界本地demo合同（各阶段3/5/3/3/4/4/3项），含双链完整冷构建、真实HTTP、指定跨JVM恢复、Mongo/MySQL/浏览器和安装位置复演。矩阵的原要求、范围、失败与历史事故保留，不仅保留一个“通过”数字；不同链或安装位置的重复执行不能相加冒独立要求数。

干净归档的历史名称为`dist/bank-wealth-v1-darwin-x64-1134.tar.gz`，SHA-256为`95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade`。本页没有分发该文件，也未落实公开获取渠道；Git对象不能代替二进制归档。不要递归打包已运行的`dist/v1/`，其中可能有私有凭据、journal和数据库数据。

原复演平台为macOS x86_64，需JDK11、Python、固定数据库镜像及本地浏览器材料；Mongo 4.4已EOL，只限本地演示。复演执行器会退出应用/浏览器及自己的容器，不留下常驻网页。执行配置的“V2”不是银行业务V2。旧`--check`退出2表示预检而非签收；完整复演只能按冻结归档/历史checkout及新授权、新资源执行，不能直接套用当前源码。

<a id="disposition-1128"></a>
## 1128：暂停草稿与许可处置

| 材料 | 固定Git对象 |
|---|---|
| 授权处置 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/AUTHORIZED-DISPOSITION-1128.md` |
| 13草稿逐项清单（原第42–54行） | `4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/FINAL-HANDOFF-1054.md` |
| 许可和来源原目录 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/third-party/sbt-twirl-1.5.1/`（tree对象） |

13份草稿保留跟踪、原路径和原字节，**继续暂停、不运行、不修复、不计入V1已验成果**。包括qualification材料及`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`；不通过全局测试发现间接启动。1054中旧“处置未决定”须按1128的后续裁定理解，1128本身不是发行签收。

14份许可/来源材料迁往当前`third-party/`，不是随目录退役可删的文件。sbt-twirl 1.5.1的Apache-2.0依据绑定其上游提交`d176bc29ac5af7ba2b57d45b0424a218136b6fff`；不能由twirl-api推定，也不等于法律审批或二进制可复现证明。

<a id="reading-archive"></a>
## 原首页、续接与旧命令表

| 阅读目的 | 固定Git对象与范围 |
|---|---|
| 完整旧README、生成器来源表、产品/金样解释与原复演步骤 | `4515b6b97d91714116b451b4e930dc81e112e528:README.md` |
| 2026-11-04工具链评估与原首批启动计划 | `4515b6b97d91714116b451b4e930dc81e112e528:docs/TRUTHSRC-CONTINUATION.md` |
| 旧消费者、snapshot/fresh分岔与三张旧命令表 | `4515b6b97d91714116b451b4e930dc81e112e528:docs/TRUTH-ENTRYPOINTS.md`，第3–4节（旧命令表第84–132行） |
| 更早V1导航 | `4515b6b97d91714116b451b4e930dc81e112e528:v1/README.md` |

旧命令表为历史定位，不能据其中的旧`npm test`/`project`别名推断当前行为。当前脚本见[ENTRYPOINTS](TRUTH-ENTRYPOINTS.md)。历史CLI须明确`--historical`，冻结完整request须`historical:true`；这不是执行暂停runner、重跑发行或写旧路径的许可。`--manifest`的摘要编排也不等于`--execution`的实际运行验收。

<a id="handoffs"></a>
## 两份顶层handoff

- `4515b6b97d91714116b451b4e930dc81e112e528:V1-JOINT-HANDOFF.md`：P24的6/6与P25的5/5本地联合验收，不是后续25项发行或生产认证。
- `4515b6b97d91714116b451b4e930dc81e112e528:P26-P32-FANOUT-HANDOFF.md`：主集成者加读侧页面、TA退款、定投三个独占模块的分工；共享接口单owner、重型执行位1，不自动授权新worktree、服务或发布。

本次从顶层导航移除后仍从这些固定对象读取；不链接未来不存在的本地handoff文件，不重启其中已经结束的阶段计划。

<a id="architecture-contracts"></a>
## 三份历史架构合同

当前职责摘要在[architecture/README](architecture/README.md)。下面是原合同原文，不以它们的“尚未完成”或旧手写路径冒充当前状态。

<a id="contract"></a>
### CONTRACT

`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/CONTRACT.md`

原联合实现的接口、身份与生成/手写边界；按该时点解释。

<a id="implementation"></a>
### IMPLEMENTATION

`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/IMPLEMENTATION.md`

原装配与模块实施合同；当前Repository/JDBC已消费情况不能用旧实现状态替代。

<a id="pages-contract"></a>
### PAGES-CONTRACT

`4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/PAGES-CONTRACT.md`

原页面、权限和交互合同；不是本次服务/浏览器重新验收。

## 证据不会随导航重写

当前仍保留的[兼容迁移回执](TRUTH-COMPATIBLE-COMPOSITION.md)、[11月6日新人回执](ONBOARDING-ACCEPTANCE.md)及其它旧运行记录保持原文。旧环境状态、数量、路径和未完成项属于各自捕获时点；不能替后续候选自动签收，也不能以今天的资源可用性反向改写旧结果。retry/backoff/deadline仍OPEN，冻结runtime、PB/PID及原业务预期不随精简重签或重发。
