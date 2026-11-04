# 双生成器搬移生成验证（1091–1112）

最后更新：2026-11-04

**JS和BC生成器均已使用搬移后的源码、正式输入、ext和文件供给实际生成，并通过参照/稳定再生及源锚核验。BC额外完成搬移位置的冷源码构建。** 本页不是完整P32发行或搬移应用部署验收。

证据根：`.scratch/p26-p32-bank-v1-59o__arv/relocation-1091/`。

## JS生成链

详[JS搬移实测](JS-RELOCATION-1097.md)。捕获完整生成实现及Node22.23.4，隔离运行两次，各195文件（193产物＋两sidecar）、781源键。原生成器使用同搬移输入/重绑选项生成参照，三者仅归一`anchors.*[].repo`后全等，其他文件包括build.sbt和ledger逐字节相等。

`JS-VERIFICATION-1097.json`绑定capture、执行、输入、真实源指针/文件SHA/1:N与隔离反例。没有安装依赖或调用原目录作为fallback。

## BC源码构建与生成链

- 当前原源HEAD为`c612626f51bc5465d7466f122388cc87e6c9ef24`。捕获`src/main`、构建文件、scaffold、license以及现存Scala2.13.16/sbt1.11.7精确制品；不复制原target/classes、全局插件缓存或派生boot。
- 最终`bc-capsule-1107`的构建捕获为1024文件，其中122个JAR和408份POM。额外完整25JSON输入和1507-file银行供给搬入该根，原字段仅以独立options文件重绑runtime repo/ext；源内容不改。
- `run-1108`从全空HOME/boot/global/Ivy/Coursier/tmp开始，file-only、禁止网络和原工作区读；实际sbt1.11.7/Scala2.13.16编译413个生产Scala源和1个元构建源。sbt将源码复制到新owned global/staging；该副本全量SHA等于捕获源码，不是宿主缓存classes。
- 生成器新classes目录2735个类/资源文件与本次打包JAR的全部非manifest成员一一相等，资源亦核回源码。编译/运行classpath均只含搬移根中的新classes/JAR和6个准确依赖JAR。
- 使用已支持的`codegen.noGit=true`＋显式`codegen.generatorVersion=c612626f`，不向上探测宿主Git。生成输入是原compiled产品，走正式`CodegenMain` semanticProducts入口。
- 原仓库参照、1108搬移冷编译输出、1109搬移代码再次执行，三份各194文件（192产物＋两sidecar），787源键/2469实际锚位置；仅归一目标repo，其余完整字节相同。公开anchors verifier、实际源指针和1:N都已核。
- `BC-OUTPUTS-1110.json`、`BC-ISOLATION-1111.json`和`BC-VERIFICATION-1112.json`绑定原件/捕获件/阶段副本、新classes/JAR、argv/classpath、三输出、日志和退出。

## 隔离与真实限制

BC OS sandbox拒绝原源码读、原供给读、非输出写、网络连接、非授权可执行文件；1111逐项实测返回权限拒绝。只允许选定JDK的java/javac及其helper。JS另外以Node权限禁止child/worker/native addon，具体范围见独立文档。

**JDK11仍是显式外部安装路径，不声称已搬移整个JDK或跨平台运行。** Node捕获为darwin-x64，本次也不认证Linux/ARM。

递归POM辅助捕获仍列450个本地不存在坐标和273条未解析声明；这是比本次实际解析更宽的声明遍历，不实现完整Maven resolver。真实冷构建已成功，但不能因此静默删这些清单或称所有潜在profile/其他构建选项闭包完整。编译有12项warning，无错误；不以成功退出消除warning。

## 失败保全

- 1098捕获作者错误假定report制品全在Coursier，遇boot scala-library拒绝；1099通过原坐标与SHA映射到published counterpart。
- 1100冷启动缺scala-xml2.2.0 POM；新1101只捕获本地可得递归POM。
- 1102启动Unix socket路径过长；核精确sbt源的`forceServerStart`异常分支后新运行继续无bootSocket，未启服务，网络拒绝保持。
- 1104元构建编译桥缺util-interface1.11.5 JAR；精确本地JAR SHA核后补入新capsule。1105准备缓存路径拼错，在JVM前失败，目录/工具输出保留；1107专属作者核验后1108通过。
- 所有失败目录、旧成功作者/回执保留，不重跑覆盖，不改原runtime/公共生成器/银行业务真源，无新commit/push/download/services。

## 尚欠的P32成果

1. 搬移位置的生成应用完整构建/测试与生产部署，连同测试支持/启动配置和显式外部运行时边界核验；以前原工作区双链cold141不能直接转签这里。
2. sbt-twirl1.5.1插件特定license证据，本地搜索仍不足，未获联网补取权限。
3. 完整受控release executor、原25要求certifier和dist writer；旧summary-only分支继续不具执行认证资格。

因此P32三项仍blocked；本文只关闭已证明的双生成器搬移生成子范围。
