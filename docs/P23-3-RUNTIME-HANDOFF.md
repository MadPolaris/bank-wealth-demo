# P23-3：银行运行库核收

最后更新: 2026-10-27

## 当前结论

**runtime 制品门已通过，银行已核收 `0.2.1-p23.20261027.1`。** 不再等待供给，也不依赖 P24/P25 完成后才能解除此项。

- [银行运行库锁定清单](P23-RUNTIME-LOCK.json)：resolver、准确坐标、固定源码提交、JAR/POM SHA 及已验依赖图。
- [银行 P23-3 核收回执](P23-3-RUNTIME-ACCEPTANCE.json)：供给证据认证、银行独立消费结果及剩余覆盖边界。
- [供给方交接](../../backkend-codegen/.rounds/p23-runtime-delivery-main-20261027/HANDOFF.md)：原始发布、构建、许可和消费证据。

| 库 | 固定源码提交 | 锁定版本 |
|---|---|---|
| monarch-core | `3109a440c0e88a35cdcfb8986b60bea84c107464` | `0.2.1-p23.20261027.1` |
| monarch-persistence | `9facddd1e1c7bfc1c3cffa5777b8957f6a4e8e56` | 同上 |
| saga-core | `4352a3173ee4e812762dcaa9c1aad58ff1551417` | 同上 |

## 实际核验

1. 银行核对三库发布 JAR/POM、95 个源码 commit blob 与提交后构建回执，POM 依赖和打包 LICENSE 对应；`monarch-persistence` 自身声明同版 core，不靠 override。
2. 349 个离线仓文件 SHA 与清单匹配；109 个运行时模块的许可材料引用已核对。许可声明核对不是法律意见。
3. 银行执行供给方明确提供的独立消费者：`consumer-run.py offline bank-check-01`。新的应用依赖缓存，仅配置交付 file 仓，**5/5 通过**。
4. 三个实际加载 JAR 的路径和 SHA 与锁定值完全一致。三轮依赖图（供给在线、供给离线、银行离线）一致：**708 条原始记录、706 条唯一记录、2 条重复记录**；比较保留重复次数，未只比较坐标集合。
5. 109 个 runtime 模块／133 个含测试的模块一致。没有 sibling 源码、手工 JAR classpath 或 `dependencyOverrides`。

本轮未重建或发布三库，没有运行暂停的 `qualification/`、`tools/qualify-domain.mjs`、`test/domain-runner.test.mjs`。独立消费者使用供给方的最小 fixture，不是银行业务应用；其 5 项不能计入银行资金端到端覆盖。

## 后续消费方式

唯一经本轮核验的依赖仓：

```text
file:///Users/zhongdj/Workspaces/mad-polaris/backkend-codegen/.rounds/p23-runtime-delivery-main-20261027/offline-maven/
```

P25 创建银行生成应用时，应使用锁定清单内三坐标与实际制品指纹，并记录**该应用自己**的完整解析图。当前清单是核收输入，不冒称已经接入生成应用，也不是自动被 sbt 读取的插件。将来扩展 Play/Mongo/JDBC 等依赖后，不能把本消费者的依赖图当作完整应用锁。

本版本不覆盖。源或制品变化须新版本和新核收；移动离线仓可调整 resolver 位置，但仍须校验锁定制品字节。交付仓不是临时缓存，不应删除。

## 保留边界

- Akka 旧传递依赖的 eviction 警告与 SLF4J NOP 警告已保存，不据测试通过认证全部 Mongo/JDBC 集成。
- 使用已安装 JDK11 与 sbt boot；空缓存/离线结论只覆盖本次工程和应用依赖，不是空 OS 离线安装或网络防火墙隔离证明。
- 供给方容量压测取消仍未计为通过；供给方跨 JVM 恢复证据不是银行 JVM 恢复认证。
- 旧 `P23-VERIFICATION.json`、`P23-DESIGN-2-VERIFICATION.json` 和设计真源中的未执行/blocked 状态描述其出具时点，保持不变。**当前制品状态以本次核收回执为准**，不能继续把旧 blocker 当作现时阻塞。
- 当前只完成 P23-3 制品核收；整个 P23 是否通过须合并四包证据判断。资金、TA、退款、定投和恢复运行仍属于既定后续里程碑。

银行本轮原始证据：`.scratch/p23-runtime-acceptance-b41gt8w9/`。供给方脚本的新增消费者目录及原始日志在交付目录 `consumer-runs/bank-check-01/`、`bank-check-01.*`，未覆盖供给方旧材料。无本轮提交或推送。
