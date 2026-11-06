# Onboarding 独占银行运行窗口前置

最后更新: 2026-11-06

## 状态与授权边界

- Owner：`truthsrc-onboarding-20261106`。
- **状态：离线JVM窗口已经签出、执行位归还。** 最终code02 actor64/readside47、runtime02编译/235输入准入、独立Launcher4class编译及crash02固定24窗/72JVM通过。最终无Java或本轮lease lock。HTTP/MySQL/Mongo及人工会话仍因Docker前置 BLOCKED。下文是先前只读侦察时点，不能当作当前仍持有资源。
- 用户已授权新独占银行服务验收，但本轮仅做只读前置及这份说明、新 owner 的 target 输入记录。不启动 Docker/JVM/浏览器/服务，不运行测试，不下载或拉镜像，不生成候选、不解包归档。
- 共享及旧资源全部保护。不读取秘密、旧 env 或进程 args；不改 Docker 配置，不启停未知容器，不清理数据或旧锁，不提交、推送或发布。
- 本次仅新建本文件与 `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-onboarding-20261106-resources.json`。银行现有未提交实施继续归原 owner；“clean1134”指冻结归档，不代表当前 Git 工作树干净。

## 当前登记约定

已读银行 `AGENTS.md`、边界文档及 BC `AGENTS.md`、`CLAUDE.md`、`MAINLINE.md`、`AGENT_COORDINATION.md` 当前占用/心跳。

1. BC 协调板要求运行时操作前登记当前占用与心跳（`AGENT_COORDINATION.md` 的“运行时互斥资源”“当前占用”节）。20261105 银行窗口及重型位已签出；旧 9000/共享容器等历史行不能被视为空闲证明，也不能改写或接管。
2. **本轮 BC 协调板保持只读，未增加行，未取得全局重型执行位。** 旧“改板即提交”条款不能覆盖本轮禁止 commit/push 的授权边界。后续须由有权限的协调 owner 完成新行登记，或先取得仅新增本人行、无需提交的明确许可；未解决前不执行运行时操作。
3. 银行当前 `tools/truthsrc-runtime-lease.mjs` 要求独立 `--lease` 输入，字段精确为 `schemaVersion/owner/host/ports/runRoot`。新 target JSON 按此格式准备，不附加状态/凭据字段；状态由本说明承载。
4. **输入 JSON 不是锁，也不是运行回执。** 真正 acquire 会在 `target/truthsrc-runtime-leases/` 创建 owner/port 协作锁及不可复用的 owner marker，并短暂监听探测端口。本轮没有调用 acquire、没有创建 registry/marker、没有占用重型位。该机制仅协调本银行 checkout，不能替代 BC 全局协调，也不能防非合作进程抢占端口。

### 拟预留资源（尚未持有）

| 资源 | 明确值 |
|---|---|
| HTTP | `127.0.0.1:18771` |
| MySQL | `127.0.0.1:18772` |
| MongoDB | `127.0.0.1:18773` |
| Lease 输入 | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-onboarding-20261106-resources.json` |
| 未来 runtime evidence/data root | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/target/truthsrc-runtime-truthsrc-onboarding-20261106` |
| 未来 TA root | `/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.local/mock-ta/truthsrc-runtime-truthsrc-onboarding-20261106` |
| 未来 build evidence | 本轮未选择或生成；必须是另一个新目录，不能与上述 roots 重叠 |

两个 data roots 本轮均未创建；重复的 `truthsrc` 来自固定前缀 `truthsrc-runtime-` 加本 owner，是当前 schema 的要求，不得自行缩写。启动时 `--evidence` 必须等于 `runRoot`，`--round` 必须等于上述 TA root。

容器/网络/数据/凭据本轮均未创建，也无可授权停止的 PID 或容器 ID。未来仅使用新 owner 资源，记录实际精确 ID 及 `bank.owner`/`bank.runtime` 标签；停止仅限复核后的本轮资源并保留数据和失败证据。当前数据库工具仍可能生成带 `truthsrc-runtime-20261105-` 的容器名前缀，不能靠日期猜归属，也不为本轮擅改工具源码。

## 已完成的只读前置

检查窗口：2026-11-06 13:53–13:57 +08:00。以下均为当时快照，不是后续启动承诺。

### 冻结 clean1134

- 文件：`/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/dist/bank-wealth-v1-darwin-x64-1134.tar.gz`
- 大小：`454794971` bytes。
- 实际执行 `shasum -a 256`，结果与 `docs/TRUTH-RUNTIME-WINDOW-20261105.md` 和 `tools/prepare-truthsrc-runtime.mjs` 的冻结 pin 一致：

```text
95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade
```

仅验证整个归档 SHA；未解包、未重验内部签名或重新签收历史业务证据。

### 磁盘、端口与 owner 冲突

- `df -h`：银行目录及 Docker 所在用户目录均位于 `/dev/disk1s2`，`838 GiB` 总量、`798 GiB` 已用、约 `19 GiB` 可用、`98%` 使用率。**空间紧张；尚未评估未来冷编译、Docker VM、两数据库及保留证据的总预算，不能声称容量足够。** 不清理腾空间。
- 13:54:32 +08:00 对三个端口分别执行 `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpcn`，均 exit 1、无 stdout/stderr，即未观察到监听。本轮未 bind/listen，因此不是内核预留或完整 bind 可用性认证；实际 acquire 前仍须重查。
- 13:55:49 +08:00：两新 data roots、不复用 owner 的 `.lock`/`.used.json`、三端口 `.lock` 均不存在；整个银行 lease registry 当时也不存在。仅核文件名/metadata，未读旧锁或旧资源记录。
- BC 板当时无该 owner 或三个端口的文字登记；这不等于所有外部占用都被排除。

### JDK11 与浏览器 module 路径

只核 metadata/包声明，不执行 JVM、不 import 浏览器 module、不启动浏览器。

- JDK home：`/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home`
- `release`：AdoptOpenJDK `11.0.11+9`，`x86_64`，Darwin；`bin/java` 与 `bin/javac` 均为现存可执行文件。
- 系统默认 `java_home` 指向 JDK16，未来必须显式使用上述 JDK11，不能依赖裸 `java`。
- Playwright ESM module：`/Users/zhongdj/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs`
- sibling core：`/Users/zhongdj/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs`
- 两者 package 版本均 `1.61.0`，Playwright 声明依赖同版 core；入口及包目录存在，包目录不是 symlink。
- 浏览器 executable：`/Users/zhongdj/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-x64/chrome-headless-shell`，现存可执行文件。
- 上述 npm/browser cache 仅作为未来只读输入候选，不拥有、不更新、不删除；未来验证器须重新核完整库存及 pin。**未验证运行可用性、module/browser 兼容性或浏览器验收。**

### Git 与协调板基线

- 银行：`feature/bank-wealth-truth-preview`，HEAD `8c4cb7ea9d59b04318c48aef41a5d89236aac9e5`。工作树已有 runtime admission/controller/verifier 修改和新增 lease/workshop 文件；本轮不修改、撤销、提交这些并行成果，不把 HEAD 当作它们的完整内容 pin。
- BC：`p15-p19-accepted-20261026`，HEAD `13c151b8e5e9a707b23a5e678229b5d8b9219e8c`。
- BC 板 SHA-256（首次及写本说明前复核相同）：`b042b2f6eb37842024e65004dcf843fd095477660ab141c24b0cdbbdb677d491`。
- 银行 AGENTS SHA-256：`f6dfad335efe76b11cd66bad1844a9c86be9ef6db4120f246f7202966d99c8d5`。

## Docker 阻断：不能先启动再检查

- `/Applications/Docker.app` 存在；本轮对 `/Users/zhongdj/.docker/run/docker.sock` 做只读 Unix socket connect 得到 `ConnectionRefusedError` / errno `61`。
- 仅采集 `ps pid,comm`，未见 Docker/vpnkit/hyperkit/qemu/virtualization 对应进程。这与主会话此前显式 Docker endpoint 不可达及无 Docker 进程的结果相符；没有把不可达解释为可擅自重启的挂死服务。
- **所有旧容器的实际 restart policy 及 daemon 启动副作用未能只读确认。** 停着的 daemon 无法提供容器 inspect；旧 Compose 或回执不能证明持久化 policy 当前值。本轮不读 Docker 私有配置/VM 原始数据，不绕路启动 daemon 求证。
- `open -a Docker` 可能自动恢复旧容器，影响受保护资源。**本轮没有执行该命令，也不能把它当作无副作用的普通前置。**

## 安全下一步（有界移交）

1. **协调授权**：由主会话/协调 owner 解决 BC 新 owner 占用与心跳登记，并确认唯一重型位；只添加获准的新行，不修改旧行，不因旧约定自动提交。无法安全登记则继续阻断。
2. **Docker 用户操作阻断**：由用户/旧资源 owner 在本代理之外确认并解决 daemon 启动的旧容器 restart 影响，确认不触碰受保护资源后，再由用户控制 Docker 启动。若无法满足“旧资源不动”，维持阻断；不能采用“先 open 再 inspect/停旧容器”的顺序，也不能擅改配置或 policy。
3. 两项解决后，新窗口 owner 重新核当前规则/source pins、磁盘预算、owner marker、三个端口、JDK/module/executable。Docker 在线后才可用不输出 env 的定向只读字段确认实际旧容器政策和本地镜像库存；缺镜像时报告阻断，不自动 pull。
4. 后续经正式入口生成/编译独立新候选，取得对应 build receipt，运行前由当前验证器 acquire 此 lease；不复用 20261105 或1134旧运行回执。本轮不执行这些步骤。实际容器/进程生命周期严格限定本轮 ID/标签，结束保留数据并由 owner 归还。

当前结论是 **归档 SHA 与路径前置已有实证，银行资源输入已准备，但全局协调及 Docker 安全启动尚未解除；没有 JVM/服务/数据库/浏览器验收结果。**
