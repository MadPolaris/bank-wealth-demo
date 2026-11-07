# 当前命令、读写与历史入口边界

作者权威合同见[TRUTH](../TRUTH.md)，操作教程见[TRUTH-TUTORIAL](TRUTH-TUTORIAL.md)，分层执行见[BANK-WORKSHOP](BANK-WORKSHOP.md)，内容来源和构建顺序见[BUILD-RECIPE](BUILD-RECIPE.md)。本页不是运行回执；路径迁移验收和service02未通过的replay见[V1-RETIREMENT](V1-RETIREMENT.md)。

## 1. 当前命令

在自己的银行checkout根目录使用Node ≥22.13.0与相邻配套`metarch-truthsrc`。根wrapper固定使用本仓`truthsrc.project.json`，不接受另一个`--project`，也不回退历史输入。

### 首次source成功，不需要JVM或归档

```bash
node tools/bank-workshop.mjs doctor --through source --format human
node tools/truthsrc-project.mjs validate
node tools/truthsrc-project.mjs compile
```

| 入口 | 读取 | 写入与不证明的范围 |
|---|---|---|
| source doctor | Node版本、根配置及声明的作者/绑定/工具路径metadata | 无文件写入；不做完整validate/compile或SHA捕获，不读取归档、不启JVM/服务 |
| `validate`；`npm run validate` / `npm run verify` | 根配置指向的当前作者树 | validate＋roundtrip；只创建/清理系统临时重建目录，不改作者源。不等完整绑定/14产品编译 |
| `compile`；`npm run compile` | 配置、完整作者树、显式绑定、generator manifest与公共工具指纹 | validate/roundtrip及严格产品编译；结果输出stdout，仅roundtrip临时写入，不落持久图或生成工程 |

需要独立source回执时：

```bash
BANK="$PWD"
mkdir -p "$BANK/target"
node "$BANK/tools/bank-workshop.mjs" verify --through source \
  --run "$BANK/target/workshop-source-01" --format human
node "$BANK/tools/bank-workshop.mjs" report \
  --run "$BANK/target/workshop-source-01" --format human
```

先确认这是自己的银行checkout，`target/`是正常目录而非symlink；`mkdir -p`只准备父目录，不删除旧目录。run必须是规范绝对路径、`target/`下尚不存在的直接子目录；名字用过就换新名字。doctor未带run时不检查父target，不能用doctor成功替代路径检查。

source verify读取作者/绑定/工具及手写、固定测试、支持文件的前后指纹，在新run写独占回执并执行公共compile/roundtrip。它通过公共runner在`attempts/0001/source-verification/`记录source子运行，并使用`target/workshop-source-leases/`的按项目协作锁及永久used marker；正常完成释放锁但保留marker/数据。不生成银行候选、不准备runtime、不启动测试/JVM。失败run保留，不复用。`report`只读复核已有回执及当前来源，不编译、不抢锁、不迁移旧证据；新结果输出stdout，磁盘report快照由原verify创建，不由report刷新。

### 准备供给、生成与受控更新

完整生成使用现有prepare核验的冻结供给；真实公开获取渠道尚未落实，不假设clone自带归档。

```bash
node tools/prepare-truthsrc-runtime.mjs --archive /absolute/path/to/bank-wealth-v1-darwin-x64-1134.tar.gz
OUT="$PWD/generated/workshop-first"
node tools/truthsrc-project.mjs generate --out "$OUT" --plan
node tools/truthsrc-project.mjs generate --out "$OUT"
node tools/truthsrc-project.mjs status --out "$OUT"
node tools/truthsrc-project.mjs query --out "$OUT" --knowledge ReserveFunds
```

`OUT`首次使用须自有且尚不存在。已有输出先status，再明确审阅`generate --out "$OUT" --update --plan`，确认后去掉`--plan`执行更新；不强制覆盖。`npm run project:check` / `npm run project` / `npm run project:status`分别对应`generated/current/`的plan / generate / status，只有你拥有该输出时才使用。

| 入口 | 读取 | 写入与边界 |
|---|---|---|
| prepare | 实际clean1134归档及固定成员/摘要 | 写/核验`.local/truthsrc-runtime/`六份JAR/POM及供给回执，不联网、不运行/重发runtime |
| `generate --plan` | 编译输入、固定runtime JAR及外置源码根metadata | roundtrip临时写入，图用内存SQLite；不写持久图或生成目标。普通plan不是既有目标完整覆盖冲突检查 |
| `generate --update --plan` | 上述输入及已有目标/ledger/anchors | 同样不写持久图或目标，另做与apply共用的更新预检 |
| `generate` / `generate --update` | 上述输入与目标现状 | 写项目`.truthsrc/knowledge.sqlite`和显式输出的源码/配置、`.truthsrc/`证据、ledger与anchors；没有另一个`--apply`参数 |
| `status` / `query` | 当前源/绑定/工具、目标证据、账本、锚与实际生成文件，必要时只读知识图 | 无写入，不roundtrip，不自动生成/修图；不替代外置手写/runtime字节或业务测试验收 |

**生成不是跨文件事务。** 实际generate在后续runtime/目标准入前可能已经更新项目图；失败不能承诺零写入或整体回滚。合法MANUAL内容受公共writer保护，已不在计划中的旧条目会保留，不自动删除；重复update的“零源码写入”也不等于ledger/anchors等证据零写入。即使输出目录不同，项目图仍是共享写面，生成apply由主集成协调。

完整`verify-project`、区间反查及`view-project`命令见[教程](TRUTH-TUTORIAL.md)。交互图只在导出时核验，HTML不是实时运行状态。

## 2. 显式测试与运行入口

| 入口 | 范围及写入边界 |
|---|---|
| `npm test` | `unified-truth`＋`historical-source`的显式Node合同；不是全应用验收 |
| `npm run test:current` | 当前source/14产品合同；完整变更集成另显式启用 |
| `BANK_TRUTHSRC_INTEGRATION=1 node --test --test-concurrency=1 test/unified-truth.test.mjs` | 自有作者/输出副本中验证生成、查询与update；不改当前作者树，不启服务 |
| `npm run test:public-tools` | 公共文件/租约/工作线程/手写来源机制的银行适配、fresh-import依赖闭包及完整工具归属清单；只跑指定Node合同，不启动真实银行服务 |
| `npm run test:build-verifier` / `test:actor-verifier` / `test:readside-verifier` / `test:runtime-verifier` / `test:workshop` | 各自Node合同与自有临时测试数据；名字含runtime/workshop不代表执行真实JVM/数据库 |
| `node tools/verify-truthsrc-build.mjs …` | 显式候选、归档与新evidence；各隔离模式的确切参数及读写见[TRUTH-BUILD](TRUTH-BUILD.md)、[actor准入](TRUTH-RUNTIME-ACCEPTANCE.md)、[读侧准入](TRUTH-COMPATIBLE-COMPOSITION.md) |
| build的`--compile-runtime-tests` | 只编译/封存五份固定main＋六份生成测试及实际classpath，不运行测试或服务 |
| `node tools/verify-truthsrc-runtime.mjs …` | 成功的新构建回执＋新owner租约＋独占evidence/TA根；实际JVM/数据库/HTTP/恢复窗口另需授权，见[运行合同](TRUTH-RUNTIME-WINDOW-20261105.md) |
| workshop `verify --through anchors\|code\|service` | 依请求范围增加供给、独占生成/构建与运行资源；完整参数、report/view及人工start/status/stop见[BANK-WORKSHOP](BANK-WORKSHOP.md)，不在这里复制执行配置 |

固定Scala测试现在位于`test/scala/`，各执行模式仍只挂显式SHA清单。actor64与readside47中的23生成测试重叠；不能相加冒独立覆盖。真实服务、外部数据库和跨JVM结果必须用各自新回执证明。

## 3. 当前路径与历史读取

| 位置 | 正确用途 |
|---|---|
| `truth/bank-wealth/`、根配置、`bindings/implementation/` | 唯一当前作者输入 |
| `handwritten/scala/`、`test/scala/`、`third-party/` | 按职责迁出的现役实现、固定预期与许可；归属见[manifest](V1-RETIREMENT-MANIFEST.json) |
| `docs/architecture/HANDWRITTEN-SOURCE-MAP.json` | 当前手写关系位置，解释见[同目录README](architecture/README.md)；不是自动生成锚 |
| `.truthsrc/`、`generated/<owned>/`、`target/`、`.local/` | 派生图/代码、候选、证据与供给，不是可编辑业务输入 |
| 根六bindings、`formal-inputs/`、`compiled/`、`projections/` | 旧合同/设计及派生产物，不能替当前输入；历史projections不是运行时SQL读模型 |
| 旧`tree/`、`v1/tree/` | 只读`675a9366cf270995ef714e505e42c19652f0e4f0`，见[两树基线](TRUTH-LEGACY-BASELINE.json) |
| 旧`v1/formal-inputs/`、`v1/integration/`及原路径 | 本次固定于`4515b6b97d91714116b451b4e930dc81e112e528`；由[HISTORY](HISTORY.md)定位，不当作当前磁盘路径 |

历史读取需要相应Git对象，缺失时明确拒绝，不联网自动取回，不恢复第二套作者树。旧validate/project/formal/domain/service/joint直接CLI须`--historical`；冻结完整请求须`historical:true`，无参不得默读snapshot。`npm run history:validate`、`history:project:check`与`test:history`也只属于旧合同，不是当前准入。旧完整发行需冻结归档/历史checkout，不在缺旧输入的当前checkout假装复演。

[旧消费者和完整命令表](HISTORY.md#reading-archive)、[1134及25项矩阵](HISTORY.md#release-1134)、[1128暂停/许可裁定](HISTORY.md#disposition-1128)均保留固定对象。历史模式不是额外执行授权：已有明确清单的保护面、暂停qualification/domain-runner、旧journal/失败证据和exclusive回执不可清理或重写，不得全仓测试发现、复用旧凭据或重打包运行后的`dist/v1`。retry/backoff/deadline仍[OPEN](TRUTHSRC-CONTINUATION.md#3-重试挂账open未修复未接受限制)。
