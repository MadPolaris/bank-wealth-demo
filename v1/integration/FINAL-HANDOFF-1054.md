# 银行 V1 混乱修复交接（沿用1054入口，不是release签收）

最后更新：2026-11-03

**执行器、cold证据边界与两个新增验收夹具已修复并重验。原25项未整体验收，P32三项仍blocked，无dist/v1交付。** 当前判定只看[现行25项矩阵](ACCEPTANCE-MATRIX.md)，旧矛盾表述已保存前像，不再与当前结论混排。

证据根：`.scratch/p26-p32-bank-v1-59o__arv/repair-1056/`（下称D）。综合核验为`D/REPAIR-VERIFICATION.json`，最终文档/状态签出为`D/REPAIR-SIGNOUT.json`。两者只认证本次修复范围，不替代P32完整执行器。

## 已修复并实测

| 项目 | 结果与依据 |
|---|---|
| 新执行器 | `tools/v1-repair-driver.py`；独占输出/锁、显式环境、canonical路径/解释器、作者及输入SHA、真实exit和日志、取消/超时wait、本人同进程组遗留清理、后验失败不伪绿。`E/1063.json`：11/11。 |
| release/cold | 四类摘要分支保持`recorded-summary-only`、`executionVerified=false`、blocked。bridge及ext实际完整库存/manifest前后对账，启动失败和非零退出留日志。`D/node-tests-final`：九文件102/102。 |
| 新双链完整测试 | `D/build-js-b`：新JS repair-1061，30套件141/141；`D/build-bc-a`：新BC repair-1060，29套件141/141。两链compile/Test compile/literal test；每链194个classpath条目及其字节库存单独保存。 |
| 单笔付款oracle | 执行前固定完整输入和txid；三participant的六类prepare/commit PB；募集commit已真实持久但ACK扣住时订单/Monarch未完成，订单commit入口校两资金PB；900.00/100.00、预留归零、完整Monarch快照和六流重入序列化字节不变。两链全测均执行。 |
| 真实MySQL负例 | `D/mysql-bc-a`：BC最终classpath实际执行5/5。每情景新schema/ActorTestKit/journal/readside，固定五表列和主键、事务快照、NULL/binary、精确early状态/水位、duplicate/conflict/gap/索引失败回滚与重试。资源finally关闭，不清旧数据、不DROP。 |
| 实际回锚与稳定再生 | `D/provenance-check-b`与`D/provenance.json`：两JS各193生成文件/781键/2464位置，两BC各192文件/787键/2469位置；两对稳定，仅归一anchors.repo。另核35手写文件显式source关系、指针/content version/实际SHA。不冒symbol/span认证。 |
| 供应分类 | `D/supply-gap-classification.json`：87 missing-pom中5项已有Ivy描述，82项仍需解析边/配置分析；所有项均不声称eviction已证或必须下载。唯一许可缺口为twirl 1.5.1，3项derived bridge欠门保持。 |

MySQL新容器`bank-repair-1056-mysql-bc-a`，ID `862c3bd153850d2ac9c9b9a15476fe6518a2f25b1f71e81c15c05cc3bb3e0a39`，固定镜像实际8.4.11；已stop，未rm，独占数据/五个schema/日志保留。新凭证仅在私有文件，未输出。未启停共享Mongo或旧银行数据库。

## 证据范围不能扩大

- 双链141是暖缓存银行测试；cold本次只重验工具，不是新一次冷sbt。历史1012/1015各23生成测试且预填bridge、`cachesInitiallyEmpty=false`，不能替代完整银行冷验收。
- MySQL main只在BC最终classpath运行；JS编译同一fixture，不冒两次DB执行。事件来源为真实actor的testkit PB，不是新Mongo/MySQL端到端部署。
- 本次没有重跑883/934强杀恢复、969/971 socket、817/851浏览器/清洁重放；这些保留为各自原源码窗口的真实历史证据。950合法源增量成果保留，不冒本次新改真源。
- 3个不存在的classpath条目是sbt声明的可选web输出，明确记录`absent-optional-web-output`，没有伪造文件或删除路径以凑库存。
- repair driver不是sandbox、不是完整P32 executor；同组清理不认证自行逃离进程组的后代。取消时MySQL wrapper执行本人容器stop；守护进程不可达、机器掉电等不属于本次保证。
- 只读审查代理再次422，未取得独立审查结论；实际修复与复核由主会话完成，不记录代理review通过。

## 保全与无法用测试消除的事故

`D/BASELINE.json`记录3828源、14前像、六仓HEAD/branch/index和保护库存；`D/INCIDENTS.json`记录事故。979登记136历史文件仍保留；旧final-956/963的完整test-classes在修复前各已有15条增量，本次不再构建或改写旧目标。

- 原1026多次删除重建；1027/1028报告和部分harness输出丢失。无法伪造原始版本补回，也不能称全部历史证据完好。
- 原旧测试凭证曾进入工具输出，不在此复述、不读取或自行轮换旧DB。轮换仍需独立处置。
- 本次失败1057、classpath初次捕获误拒可选web输出、provenance-check手写根误传均保留；provenance-check-b使用正确映射根通过，未放宽验证器。
- `1b7f0ea`和`778a3fb`仍保留；不reset/rebase/amend，不新增提交/push，不改暂存区。误跟踪的以下13路径内容不动，是否另行纠正Git跟踪仍未决定：

```text
qualification/fund-order-cash/build.sbt
qualification/fund-order-cash/handwritten/main/fixture/wealth/qualification/ExactDomainJacksonModule.scala
qualification/fund-order-cash/handwritten/main/fixture/wealth/qualification/ExactMoneyCodec.scala
qualification/fund-order-cash/handwritten/main/fixture/wealth/qualification/FundOrderActor.scala
qualification/fund-order-cash/handwritten/resources/application.conf
qualification/fund-order-cash/project/build.properties
qualification/fund-order-cash/src/test/scala/fixture/wealth/qualification/ExactMoneyCodecSpec.scala
qualification/fund-order-cash/src/test/scala/fixture/wealth/qualification/GeneratedPersistenceSpec.scala
qualification/fund-order-cash/src/test/scala/fixture/wealth/qualification/GeneratedRulesSpec.scala
qualification/fund-order-cash/src/test/scala/fixture/wealth/qualification/GeneratedSerializationSpec.scala
qualification/fund-order-cash/src/test/scala/fixture/wealth/qualification/QualificationTestSupport.scala
test/domain-runner.test.mjs
tools/qualify-domain.mjs
```

## 保留的未完成项

P32仍欠许可及解析闭包、生成器/输入/ext/供应/配置整体搬移、完整银行冷缓存/部署、正式release全执行和dist writer；本轮不临时扩大实现范围。现代Mongo OP_QUERY不兼容、Mongo4.4 EOL、KB #201/freshness和平台限制保持，不改成“仅披露”换取pass。

银行业务真源/手写资金实现、公共生成器和三个runtime源库未在本次修改；继续只消费冻结`0.2.1-p23.20261027.1`原制品。所有新增证据留在独占repair目录；无下载、发布、共享应用写入或旧journal清理。
