# 银行财富：唯一当前真源入口

当前作者入口为根 `truthsrc.project.json`，唯一当前树为
`truth/bank-wealth/contexts/bankwealth/`。当前使用版本化结构共享与受控微语法，
157个YAML展开为完整语义；不要编辑虚拟展开原子。旧 `tree/`、`v1/tree/`
已退役，历史字节由固定Git revision和 `docs/TRUTH-LEGACY-BASELINE.json`定位，
**不再保留第二份作者树**。

- 建模/演进：编辑 `truth/bank-wealth/`。
- 显式技术选择：`truthsrc.project.json` 与 `bindings/implementation/`。
- 当前教学生成物：公共工具写入 `generated/current/`，不要手改派生请求。旧`generated/`根和`target/`候选属于本次历史验证输出，保留证据，不作为当前输出入口。
- 现有手写实现：`v1/handwritten/scala/`，与生成目录隔离。
- [操作教程](docs/TRUTH-TUTORIAL.md)、[验证记录](docs/TRUTH-VALIDATION.md)、[知识承接表](docs/TRUTH-MIGRATION.md)、
  [当前/历史消费者](docs/TRUTH-ENTRYPOINTS.md)、[逐文件迁移证据](docs/TRUTH-MIGRATION-EVIDENCE.json)、
  [新候选运行验收边界](docs/TRUTH-RUNTIME-ACCEPTANCE.md)。

旧 README 的工作内容已被其他会话修改，本次未覆盖它。本文件和根项目
配置明确新的开发入口；旧演示、1134归档和旧发行复演文档均保持历史含义。

```bash
node tools/truthsrc-project.mjs validate
node tools/truthsrc-project.mjs compile
node tools/prepare-truthsrc-runtime.mjs --archive dist/bank-wealth-v1-darwin-x64-1134.tar.gz
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current" --plan
node tools/truthsrc-project.mjs generate --out "$PWD/generated/current"
node tools/truthsrc-project.mjs query --out "$PWD/generated/current" --knowledge ReserveFunds
node tools/truthsrc-project.mjs status --out "$PWD/generated/current"
```

`prepare` 只校验干净1134归档并提取六个固定JAR/POM到本机独占缓存；
不联网、不运行服务、不修改或重发runtime。完整应用运行仍有独立JDK/sbt/
存储前置，生成通过不是重新签收应用。retry/backoff/deadline **继续OPEN**。
