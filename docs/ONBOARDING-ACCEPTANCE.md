# 新人交付本轮验收记录

日期：2026-11-06。状态：**安装、知识图、回锚、代码与固定恢复已取得实际结果；真实数据库/HTTP和人工体验仍受环境前置阻断。** 不等同于完整银行服务或真人可用性验收完成。

本轮依据工具仓 `ONBOARDING-DESIGN.md`。用户要求继续完成精品入门，同时明确必须贯通编译真源、推图、生成、回锚，以及回锚/代码/银行服务的分别验收。

## 已实施

- CLI在导入SQLite之前检查Node版本；标准help/version、显式human/JSON，保留原命令合同。
- 完整本地包文件清单；真实Node22.13.0和22.23.4的Counter安装/生成/修改/查询/回锚/导出。
- 公共只读 `verify-project`，按实际producer计划核完整文件/多span、最终字节、同图库身份关联和必需覆盖；不能查询时自动修复。
- `view-project` 单文件离线知识图：五章业务问题、真实来源、展开节点、源码高亮、逐行反查、精度/过期/截断和验收卡；无外部请求。
- 银行 `bank-workshop` 的分层doctor/verify/report/view，以及另行来源封存的人工会话start/status/stop。
- 动态完整输入准入取代旧199数量假设；新的独占owner/端口租约，不继承旧运行窗口。
- 公开报告与私有执行日志分离，完整服务核对原始恢复/worker/进程/退出证据，不以聚合布尔值代替。
- README和Counter/银行教程重组，修正Node下限、退役树命令、失效章节和旧数量；历史验收数字保留原时点。

## 实际验收

证据根：`target/onboarding-baseline-20261106.4rIRIO/`。这是本机路径，不保证新clone携带；不包含对外发布授权。

| 检查 | 实际结果 |
|---|---|
| 公共原有统一回归 | 400通过、1明确跳过；`unification-01.log` |
| 正式 `test:onboarding` | 33通过、0跳过；`tool-onboarding-final-03.log` |
| 正式银行 `test:workshop` | 76通过、0跳过；`bank-workshop-final-03.log` |
| 较宽银行Node合同组合 | 174通过；`bank-node-final-01.log`，与上述有重叠，不能相加冒独立覆盖 |
| 银行作者/历史来源定向 | 8通过、1完整变更集成未在该命令执行；另显式 `BANK_TRUTHSRC_INTEGRATION=1` 完整6/6通过，见 `bank-full-loop-final.log` |
| Node最低版本22.13.0 | 官方Darwin x64包实际执行，CLI/安装/回锚/视图16通过；不只做版本字符串单元测试 |
| 代码窗口01 | actor64/13Suite、readside47/10Suite全部通过，checks15/15及14/14，sourceBound=true；两者共享23生成测试 |
| runtime编译01与准入 | 编译固定5main+6生成测试，完整235输入集合、194项classpath通过；没有在编译阶段执行服务 |
| 新Workshop launcher | 单独Scala编译exit0，4个class最终摘要核验通过，原已封存应用未改 |
| 最终图浏览器 | 五章、搜索、证据抽屉、桌面/390宽手机、无横向溢出、无外部请求和脚本错误；第14/15行相邻fold不串线 |
| 固定恢复02 | 24/24窗口、72 JVM，24次合同内故障SIGKILL、48正常退出，无超时，sourceBound/inputsUnchanged/leaseRelease全通过 |
| 保护基线 | 168作者/绑定、35手写、31固定测试、7冻结供给逐项SHA保持；没有改oracle消红 |

代码窗口01：`target/onboarding-code-20261106-01/report.json`。随后少量工具/报告合同修正产生新的输入指纹，**最终代码窗口02已通过**：`target/onboarding-code-20261106-02/report.json`，source/anchors/code三阶段均passed且复核通过，actor64/readside47，完整服务仍false。不改写01回执或沿用01的“当前”状态。

最终runtime编译02：`target/onboarding-runtime-build-20261106-02/result.json`，14项checks全true；实际准入及assertUnchanged已通过，235项输入、194项有序classpath。它只编译并封存5个运行main与6个生成测试，不冒测试执行。最终源码/配置摘要为 `sha256:21fde1434f8abfc773a5b0eec60860665469d3b8e96d4bfef7ec582c955087da`。

当前 `generated/current` 通过公共 `--update --plan`/`--update` 同步：1份输入证据刷新、232计划项不变；随后完整verify通过。229份源码/配置摘要与code02相同，792知识键、2898关联位置，其中669精确span、2229文件级位置、0未解析来源。没有手改生成物或把文件级候选提升成精确符号证明。

本地交付首页：`target/onboarding-delivery-20261106-final/index.html`；同目录有银行五幕图、安装包、Counter快照、脱敏代码报告、安装实测和相对路径SHA清单。首页及最终图均通过真实浏览器桌面/手机检查；最终图第14/15行相邻fold隔离通过、无脚本错误/外部请求。

最终本地工具包：`target/onboarding-delivery-20261106-final/madpolaris-truthsrc-0.5.0.tgz`，SHA256 `de60f465eb58df415f524807583e53ddcb8ae8cdd412f2d535c00a158d4a79b0`。独立安装在真实Node22.13.0下完成Counter init/generate/verify/view、改源→过期→update→repeat零写，见同目录 `installation.json`。未发布npm registry。

固定恢复02：`target/truthsrc-runtime-onboarding-crash-20261106-02/result.json`。它是来源绑定的真实受限恢复，不是Mongo/MySQL、HTTP/browser或生产重试策略认证。

## 失败记录与修正

- 并行代理多次上游422限流：已接手磁盘实际修改，不把代理中断当完成或独立review通过。
- 并行编辑工具时被 `tool changed before apply` 拒绝，未关闭来源检查；稳定源码后用新候选执行。
- 初版反查把父span的子知识扩散到整段；改为每个身份自己的行范围，增加相邻fold实际浏览器反例。
- 补核持久化图 `receipt.associations`，拒绝删空/错绑；技术绑定按文档+pointer精确匹配，不用整个document身份串线；计划未声明的symbol认证拒绝。
- tour/requirements使用有界普通文件读取，FIFO和超大输入拒绝。
- session TA日志移入本轮ownedRoot，关闭helper纳入seal；新增白名单失败阶段marker，日志/URL不泄露凭据。
- 真实runtime进程字段为 `cancelled:null`、`outputError:false`；报告和独立fixture按实际合同修正。
- 恢复01在业务前因已退役tree返回ENOENT而拒绝，0业务窗口；保留原回执。修正探针区分“原本缺失，无禁读证明”与“现存受保护路径，必须权限拒绝”；原沙箱禁读规则不变，真实Seatbelt10项通过后新02窗口复验。
- launcher编译exit0后，额外核验脚本误拒绝Scala合法`$`类名；只修核验，不重编、不改类文件，原失败和后续`compile-final.json`均保留。
- harness临时输出偶发ENOSPC；实际数据卷仍有空间，未删除源码/旧证据或擅改临时目录配置。

## 尚未通过的门

1. **真实数据库/HTTP/浏览器和人工会话：** Docker.app及socket存在但daemon离线；无法确认启动后旧容器自动恢复的影响，没有擅自启动Docker或清理/停止旧容器。环境就绪后需新的资源owner和完整service窗口。固定恢复不能填这个门。
2. **材料分发：** 本地干净1134归档和新CLI包存在且有SHA；尚未落实给新用户的真实自助下载/维护者转交通道。不虚构Release/npm链接。
3. **真人可用性：** 尚未组织设计中的三位未参与实现读者。脚本和agent测试不等于真人验收。

因此 `fullPipelinePassed`、`deliveryReady`、`usabilityAccepted` 和 `onboardingComplete` 不会因本轮局部成果而全部变true。

## `v1/` 目录

用户提出退役问题后已评估：见 [V1-RETIREMENT-REVIEW.md](V1-RETIREMENT-REVIEW.md)。建议迁出现役35手写和31测试、归档历史捕获并保留许可证，最后退役混合容器；本轮没有搬迁、删除或改公开`/api/v1`/PB/PID/业务版本。

上述验收捕获时未commit/push/npm publish，未修复或重发冻结runtime，未重签1134，未写共享应用。随后用户要求先本地提交和压缩上下文，再继续推进及精简银行仓；Git提交不重写这些运行回执，也不等于远端发布。BC协调板仅新增/更新本轮本人资源及心跳两行，其他既有修改不认领或代提交。
