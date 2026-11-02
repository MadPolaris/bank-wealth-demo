# 当前生成与手写文件回锚合同

最后更新: 2026-11-01

本项承接原 P31-3/4，不增加里程碑，不等于 P32 离线发行。正式输入仍来自 `v1/tree` 的公开编译；新增 `release-final-936` 捕获 14 个完整产品、25 个文件，核心 request/compiled/options/files 字节与 721 相同。旧输入与目标不覆盖。

## 工具边界

- `tools/v1-release-generation.mjs`：显式完整输入与 fresh 目标；JS 调公开 plan/apply，BC 生成独立 typed CodegenMain 的 fork/property tasks。不替代公共编译器，不是全 release 门。
- `tools/v1-release-provenance.mjs`：完整文件库存与 ledger/anchors 双向相等、实际文件 SHA、公用 `planAnchors`/`verifyAnchorsPlan` 复核、1:N 源引用，以及独立手写文件核对。JS ledger 没有 fingerprint 就保留缺席，不伪填成 BC 格式。
- 源版本为解析后的完整 source document 内容 SHA；存在显式定义 version 时额外保存最近父定义的 version。schemaVersion 与 generatorVersion 单列，不冒充领域定义版本。每个 pointer 必须在完整 request 中解析，并记录所指值 SHA。
- 稳定再生比较完整库存，不只比较旧 manifest 的键。仅归一 `anchors.json` 中事先核等于对应 target 的 `repo`；源文件、ledger 和其他锚字段不归一。构建后只排除明确的构建目录，不按任意路径中的 `target` 字段吞源文件。

## 手写关系不是自动语义认证

`HANDWRITTEN-SOURCE-MAP.json` 是 owner 明确维护的实现/支持关系清单，不进入领域树，也不增加第二套业务决策。35 个文件必须逐一对应，缺失、新增未映射、重复映射、坏源指针均拒绝。机器验证的是当前源指针可解析和实际文件字节，不证明文件正确实现了语义。

关系区分：
- `implements`：现有显式 port、host 或 renderer 实现。
- `supports`：实现的辅助设施；例如手写 SQL schema 只关联已声明 MySQL readSide，不能说当前真源已经描述具体 SQL 表（service.projections 仍为空）。
- `legacy-adapter`：旧 controller 适配仍在源码/测试中，但不是当前 generated 页面 transport 的 renderer。

锚级别仅 file，symbol/span 均不认证。手写 Scala、测试、页面不拷入生成目录。实际证据以本轮 `RELEASE-PROVENANCE-*.json`、四目标构建及最终核验回执为准，本文不预记执行通过。

## 尚欠交付边界

当前 options 仍含本机 ext 路径和 P23 file Maven 仓；本机离线构建不等可搬移闭包。P32 的依赖/许可证/干净缓存/dist/完整 release 总门仍需验证。既有 Mongo6 OP_QUERY 不兼容与 Mongo4.4 EOL 限制不因文件锚通过而改变。原 HTTP ACK、并发、五 kind 等细项仍按原验收要求逐项核证，不以四目标测试数自动关包。
