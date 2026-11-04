# JS生成器整体搬移实测（1091–1097）

最后更新：2026-11-04

**捕获的JS生成器、Node、正式输入、ext和供给已在禁止原工作区读取/网络/非输出写入的环境中实际生成，两次结果与原生成器参照一致。** 这是JS生成侧搬移，不是完整P32发行、BC搬移或搬移后应用部署认证。

证据根：`.scratch/p26-p32-bank-v1-59o__arv/relocation-1091/`。

## 实际执行

- `CAPTURE-1092.json`捕获当前JS生成器`lib/src/generators/schema`及package/LICENSE/协议文档，原HEAD `f2e5aaeadda3fbd784bcb63651601e7621152738`；未复制.git/历史target/缓存。捕获Node22.23.4二进制、许可、版本头和构建配置。
- 25个正式输入JSON原字节保留，完整1507-file供给及manifest搬入新根。生成用新`rebound-options.json`，只更改runtime repository和externalSourceRoots；业务请求与编译产品重新对账不变。
- `reference-1093`从原生成器源码、同一搬移输入/重绑选项生成参照。它不属于隔离声明。
- `isolated-1096`真正从捕获的`generator/lib/products/generate-cli.mjs`导入，调用捕获的公开producer；连续plan/apply两次，各195文件（193产物＋anchors/ledger）、781源键，实际1:N源指针、SHA和公开anchor verifier均核。
- 每份结果与reference完整文件集和字节相等；唯一归一是`anchors.*[].repo`，不忽略build.sbt/ledger或其他内容。三份生成使用相同重绑选项，因此无需放宽输出比较。
- `JS-VERIFICATION-1097.json`及`verify-js-1097/result.json`核原件和捕获件逐字节、完整源库存、命令/日志/退出/输出与六仓HEAD/index保持。

## 隔离实证

OS sandbox拒绝网络，拒绝原`/Users`工作区和外部卷/临时目录文件内容读取，仅允许捕获根、runner和路径祖先目录访问；拒绝非新输出写入。Node权限再禁止child process、worker、native addon。runner实际核原生成器package读取失败、非输出写失败、child spawn失败、loopback连接被EPERM/EACCES拒绝；不是仅设置offline环境变量。

为公共apply逐级验证路径case-fold而允许读取祖先目录本身，不允许读取其其他子树内容。运行平台为darwin-x64；Node仅链接系统库，本次不认证Linux/ARM。

## 保留的失败与限制

- 1094：拒绝已生效，但fixture正则未匹配Node的ERR_ACCESS_DENIED消息；改用明确错误码，新1095重试。
- 1095：Node对尚不存在的输出子目录要求显式递归write匹配，公共生成进入mkdir即拒绝，未形成输出。
- 1096只为两个新输出根增加递归write匹配；未放开源码写或原工作区读。旧失败/作者/回执不覆盖。
- 原supply manifest的历史origin/destination字段保留为出处，不作为实际fallback；实际生成选项和被读取JAR均为搬移根。
- BC源码冷构建/生成正在独立验证，不能挪用JS结论。插件sbt-twirl1.5.1特定license、搬移后完整应用构建/部署、完整release executor/25项certifier/dist仍欠。无下载/服务/新提交。
