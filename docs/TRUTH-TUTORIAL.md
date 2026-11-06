# 银行真源工作坊

**目标：从一个业务问题，找到真实声明、生成代码和可验证的来源。** 本教程不启动银行服务；代码构建与真实HTTP/数据库验收见[完整工作坊](BANK-WORKSHOP.md)。

所有命令都在 **`bank-wealth-demo` 仓库根目录**执行。需要相邻的配套 `metarch-truthsrc`、Node ≥22.13.0，推荐22.23.4。尚未取得两仓时，先按[获取与安装说明](https://github.com/zhongdj/metarch-truthsrc/blob/execution-compiler-v1/README.md#install-the-local-cli)准备；不要用main或旧发行分支代替配套版本。

## 1. 先回答业务问题

客户提交100元基金申购。系统受理不等于付款成功，付款成功也不等于投资成功。

| 问题 | 模型中的答案 |
|---|---|
| 怎样付款？ | 现金入口持久化请求，付款Saga协调参与者，订单最后Commit。 |
| 谁确认投资？ | 模拟基金公司/TA的相关最终确认；accepted和unknown仍是进展。 |
| TA拒绝后怎么办？ | 通过独立事务退回原本金，不抹去原付款成功，也不是对已Commit付款做Saga补偿。 |
| 定投是否另造一条资金链？ | 不。每期复用现金入口；有限日程和显式tick控制派发，相关终态才计数。 |

真实故事位于 `truth/bank-wealth/contexts/bankwealth/stories/`，用例在同上下文 `use-cases.yaml`。客户、操作员与受信系统的角色边界不同；操作员不是所有客户的超级用户。

只需记住：**编辑根配置指向的作者树，不编辑canonical、SQLite、ledger或生成代码。** 当前157个YAML经结构共享/微语法展开保留完整语义；旧两棵树已经退役。

## 2. 编译真源，再生成代码

### 只看真源，不需要归档或Java

```bash
node tools/truthsrc-project.mjs validate
node ../metarch-truthsrc/bin/truthsrc.js compile-project \
  --project truthsrc.project.json --format human
```

成功信号：没有hard错误、roundtrip为true、严格产品编译成功。**这不是Scala编译或业务运行认证。**

### 完整银行生成需要冻结供给

需要已取得的干净 `bank-wealth-v1-darwin-x64-1134.tar.gz`；材料取得方式见[工作坊向导](BANK-WORKSHOP.md)。没有归档可以先完成上节或工具Counter，不要从旧运行目录拼凑依赖。

```bash
node tools/prepare-truthsrc-runtime.mjs \
  --archive dist/bank-wealth-v1-darwin-x64-1134.tar.gz
```

prepare校验归档及六份JAR/POM，写入 `.local/truthsrc-runtime`。不下载、不编译或重发runtime，也不启动JVM。校验失败不会以另一份包代替。

首次练习选择一个**尚不存在**的自有输出目录：

```bash
OUT="$PWD/generated/workshop-first"
node ../metarch-truthsrc/bin/truthsrc.js generate-project \
  --project truthsrc.project.json --out "$OUT" --plan --format human
node ../metarch-truthsrc/bin/truthsrc.js generate-project \
  --project truthsrc.project.json --out "$OUT" --format human
node ../metarch-truthsrc/bin/truthsrc.js verify-project \
  --project truthsrc.project.json --out "$OUT" --format human
```

先看计划，再执行写入。成功后看到：真源/图/代码关联校验通过、完整文件集合和span计数。实际数量以该次计划为准，不靠固定数字证明完整性。完整知识快照经图导出AST参与生成，最终代码锚回到同一库。

已有输出先用 `status-project` 检查；需要更新时见第5节，不能强制覆盖冲突。

## 3. 打开知识与代码地图

前提：上节的 `OUT` 已成功生成并通过校验，`bank-workshop-first.html` 尚不存在。

```bash
node ../metarch-truthsrc/bin/truthsrc.js view-project \
  --project truthsrc.project.json --out "$OUT" \
  --tour docs/bank-workshop-tour.json \
  --html "$PWD/bank-workshop-first.html" --format human
```

打开输出的 `file://` 地址。页面为本地单文件，不依赖CDN、图服务或网络请求。

按五章阅读：

1. **钱扣了，投资就成功了吗？** 对照付款与TA故事。
2. **一笔付款，怎样保护资金？** 点 `ReserveFunds`，再点 `LEDGER_POSITIVE`。
3. **TA拒绝，为什么另做退款？** 保留原付款事实，查看独立退款事务。
4. **定投不是另一套资金规则。** 查看有限期次如何复用现金入口。
5. **回到代码，再看证据。** 切到生成代码，点击高亮区间反查知识；打开证据抽屉。

真实作者位置常是 `structures/outgoing-funds.structure.yaml` 中的一个常量或声明。里面的虚拟slice路径是展开坐标，**不要沿虚拟路径新建第二份作者文件**。

图的三种关联分开标记：声明引用、展开/来源关联、仅用于讲解的线。它不是运行轨迹。没有代码关联的叙事仍会显示，不能推断“这个业务不存在”。Saga与实现宿主只按显式引用连接，不按名字猜边。

成功信号：真实作者片段、精确代码高亮、反查身份一致；代码/服务回执缺失时显示未验。**这是导出时校验的静态快照**，以后改文件不会自动更新页面，需重新生成/校验并导出到新HTML。

## 4. 不打开图，也能双向查询

```bash
node ../metarch-truthsrc/bin/truthsrc.js query-project \
  --project truthsrc.project.json --out "$OUT" \
  --knowledge knowledge:bank-wealth/bankwealth/guard/CreditBalance/ReserveFunds/LEDGER_POSITIVE \
  --format human
```

从结果复制真实文件和行号后反查，例如当前模板的规则文件：

```bash
node ../metarch-truthsrc/bin/truthsrc.js query-project \
  --project truthsrc.project.json --out "$OUT" \
  --file app/example/bankwealth/domain/invariant/CreditBalanceRules.scala \
  --format human
```

追加实际 `--line` 可匹配精确区间；`--symbol next0`仍只能是候选。字节偏移不是行号，snapshot数组下标不是永久身份。多条知识可映到同一作者声明，但相邻fold保留各自身份。

## 5. 修改一次，安全地更新

第一次修改练习建议在[Counter教程](https://github.com/zhongdj/metarch-truthsrc/blob/execution-compiler-v1/TUTORIAL.md)的独立项目完成，不为了学习改变银行金额、身份、guard或冻结业务预期。

真实银行开发的更新顺序：

```bash
node tools/truthsrc-project.mjs validate
node ../metarch-truthsrc/bin/truthsrc.js status-project \
  --project truthsrc.project.json --out "$OUT" --format human
node ../metarch-truthsrc/bin/truthsrc.js generate-project \
  --project truthsrc.project.json --out "$OUT" --update --plan --format human
node ../metarch-truthsrc/bin/truthsrc.js generate-project \
  --project truthsrc.project.json --out "$OUT" --update --format human
node ../metarch-truthsrc/bin/truthsrc.js verify-project \
  --project truthsrc.project.json --out "$OUT" --format human
```

成功信号：先显示输入过期，更新后恢复同步，重复update零源码写入。若生成区有手改，工具拒绝覆盖；先保存差异，再决定转成合法作者/手写修改，不删除证据消红。

仓内已有显式隔离变更测试：

```bash
BANK_TRUTHSRC_INTEGRATION=1 node --test --test-concurrency=1 test/unified-truth.test.mjs
```

它在自有副本更改共享错误码并验证更新，不改当前作者树。错误码是可观察行为，且多个命令共享使用；不应称作“仅改一条说明”。它也不是完整银行服务验收。

## 6. 代码与银行服务要另外验收

[完整工作坊](BANK-WORKSHOP.md)把回锚、actor/readside构建与当前HTTP/数据库/浏览器/恢复串成同源结果。部分范围通过不会点亮完整通过。

生成的Entity、Behaviors、Bootstrap和本地Repository已被消费；本地Repository不是cluster sharding。JDBC Schema/Repository/Projection来自 `bank-service.formal.yaml` 的技术 `projectionStore`，业务owner/查询DTO仍是显式手写端口，六份说明性read-model不会自动变成全部SQL。

历史验收按时点保留：

- [2026-11-06兼容迁移](TRUTH-COMPATIBLE-COMPOSITION.md)：534main，actor64/readside47，两组共享23生成测试；H2/testkit与直接页面测试，不是该次真实HTTP/浏览器认证。
- [2026-11-05运行窗口](TRUTH-RUNTIME-WINDOW-20261105.md)：当时候选的固定24恢复窗与数据库/浏览器结果，不能继承给后续源码。
- [冻结1134发行](../v1/integration/RELEASE-SIGNOUT-1134.md)：原交付范围不变，不重签、重发或读取旧凭据。

## 遇到问题

| 现象 | 安全处理 |
|---|---|
| Node/SQLite版本错误 | 使用符合要求的Node；help/version不需要导入SQLite。不要加任意兼容flag掩盖版本问题。 |
| 缺归档或SHA不一致 | 停在生成前，按材料流程取得原干净包；不拼旧缓存。 |
| 图缺失、输入过期 | 核对项目和输出，预览后显式generate/update；查询不会自动修复图。 |
| 生成文件冲突 | 保留差异并回到合法编辑面，不改ledger/anchors，不强制覆盖。 |
| 图没有某个节点的代码 | 看身份、明确引用与诊断；说明性知识可能不是直接生成输入。 |
| 服务前置不足或失败 | 按完整工作坊的本轮owner资源记录处理，保留失败回执，不停止未知进程。 |

工具语法、精度与所有权见 [AUTHORING](https://github.com/zhongdj/metarch-truthsrc/blob/execution-compiler-v1/AUTHORING.md) 和 [PROJECT](https://github.com/zhongdj/metarch-truthsrc/blob/execution-compiler-v1/PROJECT.md)。agent遵循仓内 `AGENTS.md`，不启动暂停的qualification/domain-runner，不用全目录测试发现。**retry/backoff/deadline仍OPEN。**
