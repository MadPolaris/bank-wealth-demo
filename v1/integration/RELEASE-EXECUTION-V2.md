# P32正式执行入口：1134已完成本地demo签出

最终状态以[1134发行签出](RELEASE-SIGNOUT-1134.md)及机器回执为准。下文实施过程与失败记录保留；不再代表当前仍未执行。

`tools/v1-release.mjs --run --execution /absolute/CONFIG.json`调用v2固定阶段执行器，不再把`--run`等同于只读摘要。旧`--manifest`路径仍保持保守v1语义；不存在把历史摘要自动升级为完整验收的兼容分支。

## 当前边界

这是实施说明，不是发行签收。原25项要求不变；缺少任何实际执行、最终认证或安装位置复演时，`accepted`保持false。Mongo4.4只用于本地有界demo，已EOL，不宣称现代Mongo兼容或生产推荐。

新组件：
- `v1-release-orchestrate.mjs`：固定阶段与外层进程回执。
- `v1-release-execute.py`：独占bundle捕获、公共双链生成、空缓存构建、实际acceptance入口。
- `v1-release-build-evidence.mjs`：当前日志、源、classpath与具体suite结果核验；HTTP和恢复控制器支持新BUILD格式，旧格式仍可核。
- `v1-release-runtime.py`：新独占Docker数据库、真实生产Loader/Factory浏览器流程和MySQL五情景；finally停止并保留数据。
- `v1-release-certify.mjs`：原25行与具体业务证据核验；P32另需交付与安装位置复验。
- `v1-release-dist.mjs`：新dist/v1空目标写入，文件库存与许可材料；不打包私有运行数据。

## 已执行窗口

- `release-final-1129`：capture、双链生成、空缓存各141测试、HTTP双JVM均通过。首恢复窗worker拒绝新根名，失败回执保留；未进入Docker阶段。
- `release-final-1130`：修正为bundle内既定银行测试根，不放宽worker。两链完整冷141、HTTP各双JVM、两链24类各三JVM恢复均通过。首次Docker阶段因mysqladmin ping误把临时初始化服务视为ready，建schema前失败；两个新容器已stop保数据。
- `runtime-repair-1132`：改认证TCP SELECT 1，就绪后在新独占数据目录运行JS应用。initial/restart/refund/replay真实浏览器及MySQL五情景通过，四worker正常wait/exit0，两个容器stop/数据保留。它验证runtime修正，不单独替代正式总运行。
- `release-final-1133`：在完成部分恢复后受控取消，以免冻结后旧工具版本被提升；取消回执与进程退出保留。
- `release-final-1134`：完整冻结候选及安装位置复演均通过，原25项签收、8容器停止，干净归档已逐成员核验。见[最终签出](RELEASE-SIGNOUT-1134.md)。

所有目录均位于`.scratch/p26-p32-bank-v1-59o__arv/`。不得重跑exclusive作者覆盖成功／失败回执，不继续构建旧1121应用。阶段日志记录实际进程和退出；没有P32成功回执时不得据文档把原矩阵改为通过。

## 配置与私有数据

配置仅接受显式bundle/workId/JDK/Python与来源清单，runtime指定精确已存在image ID、Docker、Playwright/Chromium路径。冷构建不下载，不回退宿主缓存，派生编译桥不预填。应用供给与BC构建供给分列。模板options只在新运行目录重绑bundle下ext/Maven，手写源码不复制进generated。

`bank/.scratch`含独占数据库、私有配置、随机新凭证及日志，不进入发行文件清单。旧760数据库仍退役离线，不复用、不读取旧密码。发布、改写Git历史和修改三个冻结runtime不在本次动作内。
