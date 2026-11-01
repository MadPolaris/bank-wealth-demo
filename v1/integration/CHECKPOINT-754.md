# 页面与服务生成检查点 754

最后更新: 2026-11-01

本检查点在 675 业务本地集成之上接通正式页面和浏览器交互，包含 711 的服务生成修复；**不是完整银行 V1 交付**。

## 可复核范围

- 可选 `truthsrc.service-pages/v1`：显式公开壳/脚本、renderer pin、页面 alias 引用既有 typed endpoint。JS/BC 独立准入，缺省 pages 时保持原输出。
- 银行 `BankBrowserPages` 实现客户/操作员登录、14 表单和结果展示，复用认证、CSRF、DTO、就绪检查及真实 HTTP 状态；Bearer/CSRF 仅在浏览器内存保存。
- 711 修复 service producer 的 artifact@3 声明、空 effect-host 足迹、literal dotted connectionRef 测试及 Saga 分支带来的双 Mongo driver/ReactiveMongo 版本冲突。冻结 runtime 源码与制品没有改动。
- 正式输入为 `v1/formal-inputs/release-pages-721/`；旧 `release-service-631/` 保留。
- `BankBrowserHttpFixture` 是单独的 HTTP transport 测试 main：读端口返回 unknown 投影桩，合法写端口拒绝 503。它不调用生产 Factory、不写资金、不启动 TA、不连接数据库。

## 已有验证

| 验证 | 结果 |
|---|---|
| BC 公共全量 | 1067/1067 |
| JS 公共全量 | 2332/2332，99 文件 |
| 两链生成应用 compile / Test compile / tests | 各 116/116 |
| 两链 Chromium HTTP transport | 各 26 条记录，14 表单 |
| 银行新旧完整输入 | 4/4 |
| 真源 validate / roundtrip | 0 hard、34 notices；287 atoms 恒等 |
| 标准 Draft202012 pages schema | 完整输入与缺省正例、10 反例通过 |

完整本机证据位于 `.scratch/p26-p32-bank-v1-59o__arv/` 的 `PAGES-HANDOFF-754.md`、`PAGES-VERIFICATION-754.json` 和编号日志；scratch 不作为源码发行依赖。恢复 759 再核 3739 项源码、六仓、旧 targets 和 runtime 保持不变。

测试通过不表示服务正在运行。HTTP fixture 与浏览器已关闭。普通 unit 仍使用 testkit journal/snapshot，`UnitNoNetwork` 不允许网络；真实数据库集成与此测试层分开。

## 重演入口与依赖边界

- Node 输入测试：`node --test test/v1-inputs.test.mjs test/v1-service-inputs.test.mjs`。
- 正式生成由两个工具链消费完整 request/compiled 与 options，目标必须为新的绝对目录；不得手改生成源码、build、配置或 spec。
- 银行 Scala 手写实现通过 options 的外部 source root 挂载 `v1/handwritten/scala`；验证命令显式增加 `v1/test/scala`、H2 2.2.224 和 play-test 2.8.18，并配置现有 MockTA worker。不能把生成项目默认 tests 数量当完整银行测试数量。
- 浏览器工具 `tools/v1-browser-check.mjs` 只消费调用者提供的 Playwright Browser 或显式已有 module/executable，不下载浏览器。754 使用缓存 Playwright 1.61.0 与显式 Chromium 151。
- options 仍包含本机外部 source root 和 P23 file Maven 路径，依赖 `0.2.1-p23.20261027.1` 锁定制品。这是已验本地检查点，不是可搬移发行包；不能声称干净 clone 无额外准备即可构建。

## 保留的欠门

真实 Mongo/MySQL 下生产 Factory 生命周期、资金/TA/退款/SIP 页面端到端、指定故障窗跨 JVM 恢复、原 25 包逐项验收、最终 1:N 文件锚和源增量双链再生、P32 可搬移依赖与受控 delivery gate 尚未由 754 认证。后续数据库集成不得以本页 transport 桩结果代替。

既有知识库断链/freshness 及生成 proto EOF 空行保持如实披露。历史失败目标/金样不覆盖，暂停 qualification runner 不启动。
