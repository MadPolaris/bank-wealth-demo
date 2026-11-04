# P32 编译桥冷重建检查点（1066–1070）

最后更新：2026-11-03

**Scala 2.13.14 所需的 compiler-bridge 1.4.4 已在空缓存、无预填条件下从源码编译成功；23个生成测试通过。P32仍未完成。**

证据根：`.scratch/p26-p32-bank-v1-59o__arv/p32-bridge-1066/`。

## 实际完成

- `HISTORICAL-DIAGNOSTIC.json`：旧portable-999保留32-token RawCompiler参数，7个classpath JAR加boot Scala library中都没有报错四个xsbti类，classpath没有util-interface。原cold-1000 stdout/stderr SHA与临时源路径核对一致。stream是本次补采，非原回执锁定，不回写旧证据。
- 精确`org.scala-sbt:util-interface:1.4.0`已在现存Coursier缓存找到；内部版本与四个类均核。SHA：`b71591d5bcc6b6a53b75814cecbdd61f42a130613ddcba3bb85346f8771126f5`，相邻POM与998已捕获POM相同。不以1.4.9替代。
- `supply-1068`经现有collector公开API捕获；相较998的1506文件只增加上述JAR，1507文件均核。原文件记录、报告inputLock、blocker原序及内容保持；新增角色为supplemental-exact-artifact，不伪称被历史报告选择。详`SUPPLY-ADDITION-VERIFICATION.json`。
- 新正式输入`release-bridge-1069`与936的request字节相等，options仅重绑runtime repository和ext根；公共JS入口生成fresh `bridge-1069/js-app`。
- `cold-1070`使用JDK11、仅file仓、网络guard、空HOME/boot/global/Ivy/Coursier/tmp、`bridgeComponents=[]`、`testPhase=true`。实际日志显示桥从源码编译完成，生成测试23/23、5套件通过。
- `COLD-1070-VERIFICATION.json`与`verify-cold/result.json`核构建/driver/log SHA、新编译bridge JAR、零预填、源/供给保持和进程退出。当前bridge产物SHA以该JSON为准，不复用宿主派生缓存。

## 不能扩大的结论

- 本次只挂生成器自带测试，**不是完整银行141测试冷验收**，也没有运行部署/数据库/浏览器。
- 2.12.12、2.12.13两种桥未另验，原3项derived bridge清单未改。当前新证据只覆盖2.13.14。
- 末次compileIncremental stream在后续测试任务后不再保留RawCompiler参数，已如实写`finalStreamRetainsRawCompilerArgs=false`。源码编译日志、空缓存及新bridge产物是本次证据，不能谎称已捕获成功时的完整内部argv。
- 全新完整生成器/输入/ext/tests/依赖/配置搬移及release executor/25项certifier/dist仍欠；目标换目录不等整体搬移。
- 插件sbt-twirl1.5.1特定许可仍缺。离线搜索现存缓存及命名Twirl源目录未找到精确版本POM/source/license；这表示证据不足，不表示插件无许可证。没有联网补取。

## 保全

1067首次capture因主动前置metadata遍历改变blocker顺序而被作者断言拒绝；未创建供给，失败回执保留。1068移除多余前置，让原发现顺序保持，再补精确JAR；不放宽比较。没有下载/服务/容器/运行库或公共生成器源码修改、旧证据覆盖或新提交。原25要求保持。
