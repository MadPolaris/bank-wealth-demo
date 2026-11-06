# 银行目录精简：按职责开发，按固定版本查历史

日期：2026-11-06。状态：**混合目录已退役，路径/历史/来源和新候选代码/恢复验收通过；完整服务仍有新读库重放阻断**。本批承接用户“继续推进，并且精简 bank-wealth-demo”的要求；退役的是混合 `v1/` 容器，不是银行 V1 业务、HTTP/API 版本或冻结发行。

## 本批范围

| 原位置 | 处置 | 不变条件 |
|---|---|---|
| `v1/handwritten/scala/` | `handwritten/scala/`，35文件 | 文件字节、包名、接口与金融行为不变 |
| `v1/test/scala/` | `test/scala/`，31文件 | 固定 oracle、suite、main 及显式执行集合不变 |
| `v1/third-party/` | `third-party/`，14文件 | 全部许可、来源材料及原空 stderr 保字节 |
| `v1/formal-inputs/` | 固定 Git 对象，471文件 | 历史请求不再是工作树内可编辑副本 |
| `v1/integration/`、`v1/README.md` | 固定 Git 对象，26文件 | 原合同、owner、矩阵、1134签收及来源映射保持历史语境 |

逐文件路径、mode、blob、大小、SHA256及处置见 [V1-RETIREMENT-MANIFEST.json](V1-RETIREMENT-MANIFEST.json)。捕获基线为 `4515b6b97d91714116b451b4e930dc81e112e528`；历史合同与输入在旧作者基线 `675a9366cf270995ef714e505e42c19652f0e4f0` 的相应 Git tree 对象中也逐字相同。当前三份兼容接线的手写代码以 **4515b6b** 为准，不回退到早期实现。

旧历史文件共497份、217,842,964字节。退出工作树不删除 Git 历史，不移到另一份可编辑作者目录；缺固定 Git 对象时明确阻断，不联网获取、读 HEAD 或回退当前模型。历史完整发行仍只在配套历史 checkout／干净1134归档中复演，不能从当前精简目录重建旧运行环境。

当前默认入口收敛到根 README、[教程](TRUTH-TUTORIAL.md)及[工作坊](BANK-WORKSHOP.md)。原文和旧阶段命令在[历史索引](HISTORY.md)按固定 revision 定位；当前装配与手写边界见[架构入口](architecture/README.md)。

## 精简结果

- 新人首页从629行、47,862字节缩到88行、约8.8KB，入口收敛为先source成功、再教程和工作坊；未把旧长文搬成新的必读手册，原文由固定Git历史可查。
- 原945个受跟踪文件中的577个`v1/`路径都已有逐项处置：80份移出，497份历史资料退出工作树；两个过时顶层handoff亦保留固定Git对象后退出默认导航。Git历史、旧运行数据和受保护根文件未删除。
- 当前树仍是唯一作者入口；本批不引入`v2/`、symlink过渡层或另一套作者/生成链。

## 保护面

- 当前167作者/绑定文件仅允许逐字段的证据定位迁移；根项目仅修改外置源码路径。来源修改另有逐项前后映射，不改变执行声明、身份、顺序、审批或历史原文。
- 六根旧绑定、根 formal-inputs、compiled、projections、isolation-zone，以及 qualification 和暂停 qualifier/runner 合计35文件保持原路径、原字节。本批不接管暂停草稿。
- 35手写、31测试及14第三方材料保字节迁移；不挂载整个测试目录代替显式 manifest，不增加沙箱写许可。
- 冻结六JAR/POM及其供给回执不变；旧11份验收证据、旧 `target/`、`dist/`、数据库、凭据、失败回执不改写或清理。
- 不改变 `/api/v1`、`/bank/v1`、`bank-v1`、`bank-v1-1`、PB/PID、Saga/pipeline版本；retry/backoff/deadline仍为 **OPEN**。
- 本批不提交、推送、发布或修改共享生成应用；BC协调板仅登记本人资源与心跳，不代提交混合改动。

## 验证门

1. 文件清单与迁移前SHA逐项对账，历史读取完整核对固定对象；拒绝越界、缺对象、篡改和工作树回退。
2. 当前作者 validate、roundtrip、14产品与四流语义对账；当前请求不读历史编号请求。
3. 显式 Node 合同：路径准入、固定测试集、历史输入/发行拒绝、工作坊、许可和手写映射。
4. 公共生成新候选，验证完整图/回锚、互查与受控更新；不手改生成代码或锚。
5. 新候选独立 actor、readside、runtime编译和实际来源准入；需要运行资源时重新登记并复核，不复用旧回执。
6. 当前完整服务及人工会话验收单列。2026-11-06晚间只读检查已看到 Docker daemon及两个固定镜像可用，共享 `metarch-mongo` 正在运行且未操作；这仅解除旧“daemon不可达”的观察，不是本轮服务已通过。

## 已完成的定向验证

- `v1/` 497份历史文件逐项通过固定Git读取器核对217,842,964原字节后移出工作树；80份现役/许可文件SHA及mode不变；两份顶层handoff按固定Git保存。
- `npm run test:retirement`：39通过、0失败、1项显式完整生成集成默认跳过。日志 `target/v1-retirement-contract-final-20261106-01.log`。
- 独立 `BANK_TRUTHSRC_INTEGRATION=1 ... test/unified-truth.test.mjs`：6/6通过，14产品、229源码、真实生成/反查/修改/过期/update/repeat闭环。
- 16个显式路径/运行Node suite：440通过、0失败、1个需显式网络授权的relay监听测试跳过；没有把Node合同称作JVM执行。
- 工作坊最终77/77通过；独立review后补5份boundary及数据库停止原件封存，包含删除/篡改反例。日志 `target/v1-retirement-workshop-final-20261106-01.log`。
- Python历史执行器6/6通过，当前checkout在创建候选前拒绝旧物理发行。暂停runner未运行。
- 16作者文件177证据定位变更，可仅反向这些字段重建原字节；validate 0hard、157原子roundtrip通过；当前35手写/54来源映射真实只读核验通过，不冒symbol或语义认证。
- 35根保护文件、7冻结供给、旧2份验收索引和11份回执保持。`generated/current`已经公共update更新`build.sbt`及4份派生证据，完整回锚通过；229源码与service02同摘要。新离线图`target/v1-retirement-bank-workshop-20261106.html`真实浏览器桌面/390px手机、五章/搜索/证据抽屉通过，无脚本错误或外部请求。
- 当前文档33份的本地链接无缺失，70个固定Git来源链接对象存在；此检查不声称远端已发布。

正式新候选完整service窗口使用 `target/v1-retirement-service-20261106-01` 与新lease owner `bank-v1-retirement-20261106`，原重型位总量1，HTTP/MySQL/Mongo预留19781/19782/19783。**新actor64/64（13Suite、15checks）和readside47/47（10Suite、14checks）已实际通过**。229份源码/配置与迁移前对照，只有`build.sbt`的外置手写根路径变化；业务生成源码字节不变。第三份runtime编译也已通过14项检查；三候选229文件逐项相等，代码摘要 `sha256:0c022f91b7def5eb8c2b09d852c289daa4685f713f620c5b437d2f3f545a51aa`。回锚792知识键、2898位置（669span、2229文件级候选）、0未解析。实际24个恢复场景、72个JVM已全部通过。**service01在MySQL已就绪后、创建Mongo/HTTP之前失败**：底层relay仍硬编码历史18762/18763，拒绝本轮新租约19782/19783；无资源纯函数反例已复现。执行器已停止本人MySQL容器并归还租约、保留失败数据。relay改为校验现行显式非共享端口及固定3306/27017目标，未改业务/镜像/原验收；新候选service02将从正式入口重验，不重用01 owner或改旧回执。各层测试数不相加冒独立业务覆盖。

## service02 最终结果与独立待办

修复relay历史端口限制后，以新owner `bank-v1-retirement-20261106-r2` 从正式CLI创建三份新候选，未复用01构建/运行结果：

- actor64/64、readside47/47及runtime编译通过，三候选229源码相同。
- 固定24恢复场景、72JVM全部通过。
- 真实MySQL/Mongo的initial、restart、refund三阶段通过，initial/refund两次Chromium业务流程通过；HTTP权限及只读重启检查为各阶段实际结果。
- **replay新SQL读库在90秒内未达到caught-up**，完整service退出2、`fullPipelinePassed:false`。没有增大等待时间、删固定断言或换JAR消红；后续MySQL五负例和人工session因前门失败未执行。
- 外层进程已wait/reap，运行前后source一致；两本人数据库经ID/owner核exited0，6985条relay session全部关闭，末检无Java、19781/19782/19783监听或lease lock；数据和失败证据保留，重型位已归还。

最新原始报告：`target/v1-retirement-service-20261106-02/report.json`；主集成安全收口：`target/v1-retirement-service-20261106-02-execution.json`。逐项真实状态及文件SHA见[V1-RETIREMENT-ACCEPTANCE.json](V1-RETIREMENT-ACCEPTANCE.json)。先前01失败同样保留，不能把某阶段成功拼成完整通过。

**service02是本轮第二个验收窗口，不是Monarch R2。** 实际使用旧P23 `0.2.1-p23.20261027.1`，用户提供的R2候选已单独核SHA但尚未消费。现有失败属于待定位的读侧重放门，不能据此归因R2；详见[下游升级边界](MONARCH-R2-DOWNSTREAM.md)。该升级需要独立统一计划，不混进目录迁移或磁盘清理。

用户追加的缓存清理已经按保留副本完成第一批，实际空闲约增加6.66GiB，见[磁盘清理账](DISK-CLEANUP.md)。

初始本机基线：`target/v1-retirement-baseline-20261106-01/`。该目录与后续候选/运行证据不是新clone附件；材料分发和真人可用性继续单列，不能由本机存在推定完成。
