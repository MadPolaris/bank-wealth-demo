# 银行V1本地发行签出：1134

日期：2026-11-04。

**原P26–P32共25项在既定本地demo范围内通过，P32已收口。** 本次结论来自正式入口的完整执行、`dist/v1`安装位置独立复演和最终对账，不是把此前摘要或局部测试数改写成通过。无新提交／push／发布。

## 交付物

- 安装及已验目录：`dist/v1/`。
- 机器签收：`dist/v1/RELEASE-ACCEPTANCE.json`，`accepted=true`、`allOriginalRequiredProven=true`、25项均proven。
- **用于转交的干净归档**：`dist/bank-wealth-v1-darwin-x64-1134.tar.gz`，454794971字节，4137个文件。
- SHA-256：`95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade`。

归档仅按4134项不可变发行库存加3份元数据文件制作，逐成员字节核验；不含`bank/.scratch`、`bank/target`、数据库、测试凭证、运行配置、journal和缓存。**不要把已复演的整个`dist/v1/`递归打包转交**，它的`bank/.scratch`保留本机私有运行证据；使用上述干净归档。

## 正式执行

已执行的入口：

```text
node tools/v1-release.mjs --run --execution \
  /Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p26-p32-bank-v1-59o__arv/release-final-1134/EXECUTION.json
```

外层退出0，报告status=passed。禁止原样重跑该exclusive配置；新运行必须用新候选和配置。旧`--manifest`路径仍为v1只读核验，不会自动接受历史摘要。v2执行和安装位置复演的配置、工具指纹、实际argv、退出及日志分别保留。

证据根`E=.scratch/p26-p32-bank-v1-59o__arv/release-final-1134`：

- `execution/REPORT.json`：候选固定阶段总执行报告。
- `installed-replay/execution/REPORT.json`：安装位置固定阶段执行报告。
- `FINAL-VERIFICATION.json`：最终原25要求、六仓HEAD/index、10037保护文件、类/JAR和资源退出对账。
- `ARCHIVE.json`：干净归档库存／校验值。
- `AUTHORS.json`：冻结release工具源码。
- `BC-LOCAL-LICENSE-REVIEW.json`：122个精确BC构建JAR的本地POM／父POM许可声明来源。

候选执行根为`E/bundle/bank/.scratch/p26-p32-bank-v1-59o__arv`；安装执行根为`dist/v1/bank/.scratch/p26-p32-bank-v1-59o__arv`。每根包含`builds/{js,bc}/BUILD.json`、`generation/`、`http-{js,bc}`、`crash-<chain>-<case>`、`runtime/{js,bc}/RESULT.json`、`provenance/RESULT.json`、`certification/RESULT.json`。

## 实际结果

下表在候选和安装位置分别执行一次，不相加包装成业务要求数：

| 项目 | JS | BC |
|---|---:|---:|
| 全空缓存、零bridge预填完整测试 | 141／30套件 | 141／29套件 |
| 实际生产／测试Scala源码 | 499／37 | 499／36 |
| 生产／测试classes资源条目 | 1964／267 | 1964／266 |
| 冷unit正常退出的MockTA worker | 33 | 33 |
| 指定三JVM恢复窗口 | 24 | 24 |
| 真实HTTP exercise／replay | 2 JVM | 2 JVM |
| Mongo/MySQL生产Loader／Factory浏览器模式 | initial、restart、refund、replay | 同左 |
| 独占MySQL五表故障情景 | 5 | 5 |
| 非金融库存服务公共生成 | 96文件 | 96文件 |
| 目标写入前准入反例 | 2 | 2 |

生产／测试JAR非manifest成员逐件等classes；各链候选和安装位置JAR SHA也相同。最终核452个记录进程PID已不存在、8个独占数据库容器停止且数据保留；该PID数是最终核验所选集合，不冒整个系统进程普查。

生成代码／配置源193／192文件，781／787源键、2464／2469锚位置；完整实际SHA、源指针、内容版本与1:N由公共verifier重算。另有35个手写文件的显式implements/supports/legacy关系。稳定再生仅归一anchors.repo。既有合法pages真源增量与前版唯一差异、最终双链生成／测试／页面运行及renderer锚已串联核验。

工具回归65个Node测试通过，另3个BUILD证据反例通过；Python文件边界测试5个通过。未执行暂停的domain-runner／qualification，不把它们算入覆盖。代理服务失败，无独立代理审查通过声明。

## 运行与供给边界

- 验收平台：macOS x86_64；Scala2.13.14／sbt1.4.9／Play2.8.18／Akka2.6.20，冻结三个runtime版本`0.2.1-p23.20261027.1`原SHA。无runtime源码修改或重发。
- **外部前置**：JDK11、Python3.10+、macOS系统工具、Docker及指定已存在的MySQL8.4.11/Mongo4.4镜像、Playwright与Chromium。它们不是本归档所包含的整个OS／数据库／浏览器发行镜像。配置必须显式指定其位置；运行不自动下载。
- JS/BC生成器源码、BC实际可执行JAR与供给、正式输入、独立ext、Node、测试支持和应用依赖／许可文本均入包。BC生成器源码冷编依据1112，并保留同源构建供给；1134用该冷编JAR分别在两位置实际生成，不冒再次BC源码冷编。
- 冷应用构建file-only、独立空缓存、OS禁网络／原宿主缓存，桥真实源码编译；生产验收另用新独占loopback数据库，旧760不复用。
- `sbt-twirl1.5.1`由官方固定提交确认Apache-2.0，许可证材料实际入包，不从twirl-api推定。许可证证据校验不称法律审批。
- 历史POM声明unknown和旧91项清单记录原样保留，不因本次所选配置解析成功就删除或声称所有Maven profile解析完备。
- Mongo4.4已EOL，现代Mongo OP_QUERY不兼容仍存在；本发行是有界本地demo，不是生产部署安全／现代Mongo／多写者fencing／任意断电磁盘故障／Linux或ARM认证。
- TA为获准模拟；没有真实基金公司或银行外部系统集成。

## 失败与历史保全

1129恢复worker路径拒绝、1130MySQL临时启动就绪误判、1132新资源修复成功、1133为避免旧版本入包而受控取消，全部保留。1134冻结工具在正式运行中未改写。旧1026覆盖、1027/1028及harness损失不能复原；旧凭证没有轮换，旧760仅离线退役，不复用；13个暂停草稿按1128裁定保留跟踪和字节。历史事故不因本次发行测试通过而消失。

KB既有#201断链不是银行业务真源或本发行生成／构建失败，不将其写成已修；共享服务与公共生成器工作线未在本次修改。签出只关闭银行V1的原25项有界合同，不关闭其他工作线待办。
