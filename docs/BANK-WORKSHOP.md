# 银行工作坊：一个新 run，一条可复核的证据链

`tools/bank-workshop.mjs` 是**编排与报告入口**，不是另一套银行编译器。
既有独立执行与交付范围见[2026-11-06原验收记录](ONBOARDING-ACCEPTANCE.md)；其中的环境状态属于捕获时点，不是本次迁移验收。
唯一作者入口仍为根 `truthsrc.project.json`；编译、生成及回锚验收使用相邻
`metarch-truthsrc` 的公共接口。付款成功不等于投资成功，独立退款不是撤销
已 Commit 的付款；有限定投沿用原固定测试，不增加新金融规则。

## 1. 先选范围，先看材料

| `--through` | 必需材料 | 真正证明的范围 |
|---|---|---|
| `source` | 当前银行源码、完整相邻配套工具源码、Node ≥22.13.0（已验22.13.0、22.23.4） | validate、原文 roundtrip、严格产品编译；不是 Scala 执行 |
| `anchors` | 再加实际 clean1134 归档 | 现有 prepare 验六个固定 JAR/POM；公共生成和只读图/回锚验收 |
| `code` | 再加原生 Darwin x64、已安装 x64 JDK11、sandbox-exec/Python | 两个独立 fresh 输出，固定 actor 与 readside 测试及实际 staging 来源核验 |
| `service` | 再加显式新租约、可用 Docker/socket、固定 Mongo/MySQL 镜像、显式 Playwright module 与 `chrome-headless-shell` | 第三个 fresh runtime 构建，全部恢复/数据库/HTTP窗口、浏览器和资源退出 |

归档必须是实际取得的文件，SHA256 为
`95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade`。
不寻找旧运行目录、不借用户缓存、不下载、不递归打包 `dist/v1`，也不重建/发布
runtime。材料的真实公开获取渠道尚未落实，因此入口始终单列
`deliveryReady:false`，不以“请找维护者”冒称完成交付。

首版银行构建目标是原生 Darwin x64/JDK11。工具已在Node22.13.0和22.23.4实测安装与Counter/回锚/图闭环；其它平台及真人上手仍单独验收。下面命令不构成抢占共享服务或绕过资源预约的授权。

## 2. 第一次运行：只验真源

工作目录必须是**自己的银行checkout根目录**，且相邻工具checkout已配套取得。
先确认`target/`是正常目录而非symlink；下面的`mkdir -p`只安全准备父目录，
不会删除或清空已有目录。不要复制含`.local`、数据库、凭据及旧回执的整个工作目录来练习。

```bash
BANK="$PWD"
mkdir -p "$BANK/target"
node "$BANK/tools/bank-workshop.mjs" doctor --through source --format human
node "$BANK/tools/bank-workshop.mjs" verify --through source \
  --run "$BANK/target/workshop-source-01" --format human
node "$BANK/tools/bank-workshop.mjs" report \
  --run "$BANK/target/workshop-source-01" --format json
```

`--run` 必须是本银行 `target/` 下**尚不存在的直接子目录**。路径必须是规范绝对
路径，无空格、symlink、大小写别名、`.`/`..` 或 `.scratch`。父 `target/` 必须存在。
上例名字用过就选新名字，不删目录再复用。未带`--run`的doctor不检查父target，
因此doctor通过不能代替run路径准备。若只需首次doctor/validate/compile、不留run，
使用[首页三条source命令](../README.md#第一次成功只验真源)即可，无需父target。

成功字段是 `requestedScopePassed:true`。此时 `fullPipelinePassed:false` 是正确
结果：源码通过不是银行服务通过。`source` 不要求、不读取归档，不创建银行生成候选，
不启动 JVM/容器/浏览器。公共 roundtrip 自己管理临时校验目录。

## 3. 从回锚到代码：不复制生成目录

先准备实际材料；变量是本机已取得的路径，不是下载地址。

```bash
ARCHIVE="/absolute/path/to/bank-wealth-v1-darwin-x64-1134.tar.gz"
JAVA_HOME_BANK="/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home"
node "$BANK/tools/bank-workshop.mjs" doctor --through code \
  --archive "$ARCHIVE" --java-home "$JAVA_HOME_BANK" --format human
node "$BANK/tools/bank-workshop.mjs" verify --through code \
  --run "$BANK/target/workshop-code-01" \
  --archive "$ARCHIVE" --java-home "$JAVA_HOME_BANK" --format human
```

只学习回锚时用 `--through anchors`，无需 JDK 参数。入口按请求范围先检查全部材料；
缺材料会留下失败 run/attempt，但不会先生成候选再自动降级。

实际编排如下，不用旧 receipt 填空，也不手抄生成代码。

1. 公共 `compile-project` 捕获 validate、roundtrip 和 strict compilation。
2. 现有 `prepare-truthsrc-runtime.mjs --archive ...` 校验归档并准备六个固定成员。
   已存在的本地供给只接受原 prepare 的完整核验，不能覆盖改坏的供给。
3. 公共 `generate-project` 生成 fresh `actor-output`；`verifyProject` 校验图、代码、
   回锚及具名必需切片：ReserveFunds、LEDGER_POSITIVE、reservedAmount fold。
4. 现有 build verifier 执行 `--run-actor-tests`，复核实际 staging、固定测试和输入。
5. 再经公共生成创建 fresh `readside-output`，执行 `--run-readside-tests`。
6. 构建前后均公共回锚核验；候选的完整源码/配置清单及 `codeDigest` 必须一致。

每个 build 使用独占空缓存、现有 OS 隔离和冻结 suite/oracle。两个模式共享生成
单元测试，不能将测试数相加冒唯一覆盖数。没有另外挂整目录测试，不手改生成 build。
受限执行详情见 [TRUTH-BUILD](TRUTH-BUILD.md)。

## 4. 完整服务：第三份同源构建与新的 owner

当前资源只读更新（2026-11-06）：已见Docker daemon 20.10.21、两个固定数据库镜像，
共享`metarch-mongo`运行中且不操作。**完整service窗口和人工会话仍未执行**；资源
可见不是独占租约或服务通过，旧验收中的环境状态不回写。

先按当前协调约定预约独占端口，选未使用的 owner。租约 JSON 在数据根之外，只有
以下字段；将路径和端口替换成自己的实际值。

```json
{
  "schemaVersion": "bank.truthsrc-runtime-lease/v1",
  "owner": "workshop-demo-01",
  "host": "127.0.0.1",
  "ports": { "http": 19761, "mysql": 19762, "mongo": 19763 },
  "runRoot": "/absolute/bank-wealth-demo/target/truthsrc-runtime-workshop-demo-01"
}
```

这里 `runRoot` 是 **runtime evidence/data**，不是 workshop `--run`、build evidence
或生成目录。固定对应 TA 根为
`$BANK/.local/mock-ta/truthsrc-runtime-workshop-demo-01`；两者必须新建且与 workshop
run/build 不相交。前置检查核对所有已存在的祖先；缺失的 `.local/mock-ta` 父目录
由前置 actor 构建的原 helper 创建，不由 doctor 创建。
历史 owner、已使用 owner、端口占用和未知残留均阻断，不自动接管。

```bash
LEASE="/absolute/path/to/new-lease.json"
BROWSER_MODULE="/absolute/path/to/playwright/index.mjs"
BROWSER_EXECUTABLE="/absolute/path/to/chrome-headless-shell"
node "$BANK/tools/bank-workshop.mjs" doctor --through service \
  --archive "$ARCHIVE" --java-home "$JAVA_HOME_BANK" --lease "$LEASE" \
  --browser-module "$BROWSER_MODULE" --browser-executable "$BROWSER_EXECUTABLE" \
  --probe-resources --format human
node "$BANK/tools/bank-workshop.mjs" verify --through service \
  --run "$BANK/target/workshop-service-01" \
  --archive "$ARCHIVE" --java-home "$JAVA_HOME_BANK" --lease "$LEASE" \
  --browser-module "$BROWSER_MODULE" --browser-executable "$BROWSER_EXECUTABLE" \
  --format human
```

普通 doctor 只读 metadata，不执行 JDK、不启动 Docker/JVM/浏览器、不哈希整个归档。
`--probe-resources` 是显式的临时 bind/close 和有界 Docker image inspect，输出单独
标 `explicit-resource-probe`；不拉镜像、不创建容器、不读取旧进程环境，也不是租约。
`verify --through service` 在生成前自动做这些探针；真正 runtime 再在独占租约下复核。

service 不能省浏览器，不能只用 `--window database` 或 `crash`：它在完成前两份代码
测试后，再公共生成 `runtime-output`，执行 `--compile-runtime-tests`，由原 runtime
admission 复核真实 staging/有序 classpath，然后调用 `--window all` 和两项 browser
参数。固定24个恢复窗口、四个数据库运行阶段及原负例/浏览器/退出要求全部核验。
Seatbelt 的 localhost 谓词不冒精确 IP 敌意代码隔离；实际监听另验127.0.0.1。

## 5. 看结果与安全恢复

```bash
node "$BANK/tools/bank-workshop.mjs" report \
  --run "$BANK/target/workshop-service-01" --format human
```

报告**只读**：重算 refs 的大小/SHA，检查作者文件集合、显式绑定、公共工具指纹、
银行支持脚本、手写与冻结测试依赖、本地冻结供给、已编译候选/实际 staging，并重新
调用只读公共回锚校验。代码模式复用原日志 inspector 和固定 manifest；runtime 模式
复用原完整构建 admission，并复核运行输入、浏览器闭包及全部阶段/退出回执。
不调用 generate、build、测试、资源探针或服务。来源变化后会显示过期/失败，不修回执。
银行支持/冻结测试指纹采用保守的完整源码目录边界，新增支持文件也需要新 run。

- `requestedScopePassed`：请求范围的各阶段及此次只读复核都通过。
- `fullPipelinePassed`：真实 service 范围、source/anchors/code/service 全部 passed 且
  证据当前有效；任何 failed/skipped、缺失、过期、浏览器或退出缺口都不能为 true。
- `deliveryReady`、`usabilityAccepted`、`onboardingComplete`：独立交付/真人验收，当前
  不由此脚本签收。工程全链通过也不能自动把它们设为 true。

记录结构为 `run.json`、`results.json`、`attempts/0001/` 下的逐操作 started/result、
`completed.json`；失败另保留私有 `failure.json`。verify最终复核后还独占写出脱敏的
`report.json` 与 `report.md`；它们是当时快照，重新运行report只读核新鲜度，不原地改写。全部独占创建，不提供 resume，
重试创建新 run。候选在该 attempt 内；原 actor helper 要求 build evidence 是 `target/`
的直接子目录，因此三种构建证据使用 `target/<run-name>-actor-build`、
`<run-name>-readside-build`、`<run-name>-runtime-build`，均必须全新。actor TA 根由原
helper 从该独占 evidence 名推导；runtime/TA 则使用租约的另外两个独立根。
stdout 只给脱敏结果，不转发子进程日志或原异常。**私有日志、failure.json 和 runtime
数据不得作为可分享报告整包上传。** 外部中断没有 sealed results 时报告明确未完成。

| 停在哪 | 已发生的写入/资源 | 安全下一步 |
|---|---|---|
| 缺归档/JDK/浏览器/租约 | 只有 run/attempt/前置记录，无候选和服务 | 看 `results/preflight.json`；取得正确材料后新 run，不借旧凭据或 receipt |
| 输入变化/生成冲突 | 保留公共生成或构建的原错误；不覆盖他人生成物 | 保存自己选择的非覆盖差异，回授权作者/生成器面修正，再新 run；不改 ledger |
| 测试/服务未就绪或超时 | 原执行器保留本轮日志/数据并处理它自己记录的资源 | 查看该 owner 的退出记录；未知残留先由 owner 调查，不按端口杀进程，不清数据 |

Ctrl+C 转发给当前原执行器，由它完成自己的有界退出。编排不以强杀父 Node 代替
回收 JVM/容器。没有退出证据就不继承成功，不能把失败目录改成下一次的输入。
retry/backoff/deadline 欠账继续 **OPEN**，不由包装入口修复或豁免。

## 6. 只读知识视图与人工体验的接口边界

图 HTML 由公共 `viewProjectCli` 负责，参数是
`--project <absolute-project> --out <verified-candidate> --html <new-html>`，可加
`--tour <json>`。它只读项目，唯一写入是显式新 HTML，不启动银行或修改图。

若已经完成anchors/code/service任一带生成输出的工作坊run，可把本次复核的证据卡接进图：

```bash
node "$BANK/tools/bank-workshop.mjs" view \
  --run "$BANK/target/workshop-code-01" \
  --html "$BANK/target/workshop-code-01-map.html" --format human
```

HTML必须尚不存在，且在银行target下、验收run之外。入口重新复核报告的源/代码摘要；
code通过时只点亮代码卡，service未跑仍显示未验。新页面包含可点击的真实作者/代码、
独立区间反查和当前报告范围，不继承旧发行结果。

人工会话与自动验收分开。完整service报告通过后，另备一个新owner租约再启动：

```bash
node "$BANK/tools/bank-workshop.mjs" start \
  --accepted-run "$BANK/target/workshop-service-01" \
  --session "$BANK/target/truthsrc-runtime-workshop-live-01" \
  --lease "/absolute/path/to/workshop-live-01.lease.json"
```

前台会话的就绪输出给出本地URL和私有登录文件路径；不要把文件内容贴入URL、日志、
issue或分享报告。Ctrl+C，或在另一终端运行以下命令，按当前owner停止并保留数据：

```bash
node "$BANK/tools/bank-workshop.mjs" status --session "$BANK/target/truthsrc-runtime-workshop-live-01"
node "$BANK/tools/bank-workshop.mjs" stop --session "$BANK/target/truthsrc-runtime-workshop-live-01"
```

它单独编译新Workshop launcher，不修改已封存应用或240秒冻结验收main。新launcher
有独立来源、类路径、就绪/失败/退出证据；未实测的启动不能继承旧服务通过。当前真实
数据库/人工会话须另行核本机doctor与当前资源授权；[原运行窗口回执](ONBOARDING-RUNTIME-WINDOW.md)
保留其捕获时点，不能当作今日资源探针。

## 7. 历史实现时点与独立验收

工作坊编排首批实现时，只执行了定向Node合同测试和小规模真实source检查。
其中runner、供给、公共生成/回锚及构建/服务替身证明的是**编排合同**，不是银行
真实执行；替身标`executionKind:test-double`，模拟阶段全通过也不签
`fullPipelinePassed:true`。这段历史范围不能再概括后续所有验收。

| 独立证据 | 应怎样阅读 |
|---|---|
| [兼容迁移](TRUTH-COMPATIBLE-COMPOSITION.md) | 原候选actor64/readside47实测，共享23生成测试；不是该候选HTTP/数据库/浏览器签收 |
| [11月6日新人验收](ONBOARDING-ACCEPTANCE.md) | 安装、图、代码和固定24恢复窗有独立实测；原回执不改，完整service和真人可用性仍未完成 |
| [11月5日运行窗口](TRUTH-RUNTIME-WINDOW-20261105.md) | 当时选定候选的指定运行结果，不继承给今天源码或迁移后的输出 |
| [1134历史发行](HISTORY.md#release-1134) | 原25项有界合同，不是本次工作坊service通过 |

35手写、31固定测试、14许可已保字节迁移，497历史材料经固定Git对象保存后退出工作树；归属见
[V1-RETIREMENT-MANIFEST](V1-RETIREMENT-MANIFEST.json)。目录、来源和迁移后新候选的实际
结果统一见[本批验收](V1-RETIREMENT.md)。原文档时点不替今天的运行门，新结果也不重签旧证据。
