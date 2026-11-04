# 两个历史编译桥冷重建（1084–1090）

最后更新：2026-11-03

**compiler-bridge_2.12:1.4.4 在 Scala2.12.12 和2.12.13下均由实际Zinc从源码冷重建通过。** 结合[双链完整冷测试](FULL-COLD-1083.md)的2.13.14桥，原三种bridge重建义务现已有独立运行证据；旧捕获清单不回写。

证据根：`.scratch/p26-p32-bank-v1-59o__arv/bridge-variants-1084/`。

| Scala版本 | 新探针 | 验证 | 边界 |
|---|---|---|---|
| 2.12.12 | probe-1086 | VERIFIED-1086.json | 启动时由file仓重建boot，Scala JAR位于新boot目录，其SHA逐件匹配captured Maven文件 |
| 2.12.13 | probe-1089 | VERIFIED-1089.json | exact compiler/library/reflect及POM共6文件从现存缓存捕获，完整补充file仓优先；无版本替换 |

两个探针都是一个无副作用常量object，不是银行业务应用或新的生成器。每次独立HOME/boot/global/Ivy/Coursier/tmp、JDK11和network guard、sbt1.4.9、零bridge预填。真实日志记录RawCompiler参数、源码编译完成、新derived桥JAR，并实际编译BridgeProbe.class。源码JAR保留26个Scala源及原服务资源，由Zinc负责打包；未伪造组件名、timestamp或Maven artifact。

`VERIFICATION-1090.json`与`scope-1090/result.json`核两次生成物/argv/JAR SHA、补充源、原1507供给文件、1083全部旧证据、六仓HEAD/index及记录进程退出。补充6件仅供探针，不把它们混写进旧supply1068。

## 保留的失败

- 1085：driver证据目录与probe目录同名，在启动JVM前被exclusive mkdir拒绝。改用新run1086/probe1086分开命名，旧失败不删。
- 首次verify1086假定Scala库必在Maven路径；实际2.12.12使用新重建boot路径。新verify1086-b逐字节匹配captured Maven SHA，不把路径不同当缺制品，也不跳过来源核验。
- 1088：第一file仓已有2.12.13 POM但无JAR，update报告明确missingArtifacts指向第一仓；没有从后置完整补充仓取JAR。核两个仓POM字节相同后，新1089只改变仓顺序，完整补充仓优先，原仓不改。不是下载失败或版本替换。

## P32状态

桥重建不再是无证据欠项，但不等历史派生缓存与新JAR字节相同，也不等这些新bridge已获发行集成签收。完整银行冷unit已验；**sbt-twirl1.5.1插件特定许可、整个生成器/输入/ext/测试/依赖/配置搬移后生成与部署、完整release executor/25项certifier/dist writer仍未完成**。没有下载、服务/容器、公共或冻结runtime源码修改、新提交/推送。
