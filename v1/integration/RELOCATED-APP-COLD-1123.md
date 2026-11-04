# 搬移位置双链完整应用冷测试（1123，非V1发行签收）

最后更新：2026-11-04

## 已验范围

承接[双生成器搬移生成1112](GENERATOR-RELOCATION-1112.md)，本次使用捕获JS源码公开入口、1108在搬移位置冷编的BC JAR，分别生成全新应用。输入、ext、依赖仓库、Node、测试支持包和构建缓存均在各自capsule；未在1112签出的旧目标继续构建。

证据根 `E=.scratch/p26-p32-bank-v1-59o__arv/relocated-app-1113`；搬移根 `D=.scratch/p26-p32-bank-v1-59o__arv/relocation-1091`。

| 项目 | JS | BC |
|---|---|---|
| 新目标（相对D） | `capsule-1092/application-1121/js-app` | `bc-capsule-1107/application-1121/bc-app` |
| 完整literal test | 141通过，30套件 | 141通过，29套件 |
| 生产／测试Scala源码冷编数 | 499／37 | 499／36 |
| classes／test-classes文件数（含资源） | 1964／267 | 1964／266 |
| 生成文件（含anchors/ledger） | 195 | 194 |
| 源键／锚位置 | 781／2464 | 787／2469 |
| 已退出worker执行 | 33 | 33 |

两链均无失败、取消、忽略、pending或aborted套件。生产13个、测试10个编译warning保留，不称无warning。测试支持包各219文件，31份Scala源（25份Spec）原字节外挂，未复制到generated生产源码。

本次遍历`worker*.jsonl`，包含31份主日志及两份reopened日志，共33次执行，逐件核started/exited PID一致、waited、exit0及已无记录PID。此前1083的31是只扫描`worker.jsonl`的统计口径，不重写旧回执。

## 冷构建与隔离证据

- 每链独立全空HOME/boot/global/Ivy/Coursier/tmp，零derived bridge预填，sbt1.4.9、Scala2.13.14。
- 实际执行`update`、`compile`、`Test / update`、`Test / compile`、发现完整套件、literal `test`；2.13.14 bridge真实源码冷编。
- 只使用对应capsule的file Maven/Ivy。OS拒原工作区源、原供给、capsule旧boot和旧目标读取，并禁网络；不会仅凭offline变量认定隔离。
- 原样使用本次构建sandbox，以捕获Node执行7个实际拒绝断言：4处存在文件读取、非输出写、外来可执行文件、loopback连接；只接受EPERM/EACCES，不把不存在或连接拒绝误算成功。
- Java安全管理器另拒构建JVM网络；fork测试和Node子进程受OS sandbox继承约束。
- ScalaPB把精确protoc复制进新HOME缓存再执行，其SHA与捕获制品相同。系统`mkfifo`、`sh`、`bash`、`cat`及新tmp桥脚本执行是明确平台依赖。
- compile classpath129项；test fullClasspath193项，其中两个不存在的可选web目录如实列出；实际fork test classpath191项。所有已有文件/目录位于新目标或对应捕获供给，逐件SHA/库存核；新生产和测试JAR的全部非manifest成员等于classes/资源。
- 本次JDK11仍为`/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home`外部前置。OS系统库/工具未搬包，不认证Linux/ARM。sandbox不是不可信代码的全系统安全认证。

## 生成与保全

新两链各与1112参照完整字节比较，只归一`anchors.*[].repo`。构建后再次调用正式`verifyGeneratedProvenance`和`verifyStableGeneration`，核实际SHA、原source pointer/content version及1:N；不跳过build.sbt或ledger，也不认证symbol/span。

1113基线锁10034个文件，包含原保护面、捕获供给、旧生成目标、BC新编译JAR与六仓HEAD/index。原25要求不变。无公共/runtime/银行业务源码改动，无下载、服务、容器、新提交或push。

主要回执（相对E）：

- `js-build-1121/result.json`、`bc-build-1121/result.json`：有界执行、日志、退出、保护面。
- `js-VERIFIED-1118.json`、`bc-VERIFIED-1118.json`：核验作者编号1118，实际核的是1121目标与运行；测试、套件、worker、classpath和类/JAR逐件库存。
- `js-ISOLATION-1120.json`、`bc-ISOLATION-1120.json`：核的是1121实际sandbox。
- `SOURCE-ANCHOR-VERIFICATION-1124.json`：两链构建后的actual回锚与稳定再生。
- `VERIFICATION-SIGNOUT-1123.json`：综合有限签出；编号不代表执行先后。

失败1114（生成制品读取未放行）、1115（非交互boot socket退出2）、1117（新HOME protoc执行未放行）、1119（macOS sh的bash variant拒绝）及1122回执命名大小写碰撞均保留。精确sbt1.4.9源码已核其forceServerStart无socket fallback；未重启任何服务。1122在写回执时与同名小写配置碰撞，后以不同词干1124写出，不覆盖。未执行的1116诊断草稿不是运行证据。

## 仍未关闭

这证明双链在搬移位置完成真实生成、完整应用冷unit和实际源回锚，不等生产Mongo/MySQL/HTTP部署，不替代旧强杀恢复或浏览器证据。sbt-twirl1.5.1插件特定许可、完整release executor、原25要求certifier、受控dist/v1和运行时分发边界仍未完成。原供给metadata unknown/blocker和历史事故继续保留。

现行判定见[25行矩阵](ACCEPTANCE-MATRIX.md)：P32三项仍blocked；KB仍须如实记录既有#201断链，不用此局部通过提升整个V1状态。
