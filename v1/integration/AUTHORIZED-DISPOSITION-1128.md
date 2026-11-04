# 1128：Twirl许可取证与历史事项处置

## 结论

用户明确授权上游取证和有依据的资源／历史事项处置。`sbt-twirl:1.5.1`插件特定许可证据已取得；13个暂停草稿决定保留Git跟踪；旧760测试数据库作为离线历史证据退役。未修改业务或runtime源码，未启动服务，未改写历史或提交／推送。**这不是P32发行签收。**

证据根：`.scratch/p26-p32-bank-v1-59o__arv/authorized-disposition-1125/`。

## 许可证

Twirl确实是Play模板引擎；`sbt-twirl`是其sbt集成插件。官方1.5.1标签解析到`d176bc29ac5af7ba2b57d45b0424a218136b6fff`：

- 原仓LICENSE为Apache-2.0。
- 同提交build.sbt明确声明`com.typesafe.sbt:sbt-twirl`，不是从旁边的twirl-api模块推定。
- 原README明确模板引擎和插件身份。
- 完整、不截断的Git树未见插件另设许可证或NOTICE；捕获文本核对Git blob SHA与SHA-256。
- 本地插件Ivy坐标、JAR的版本和类名与该组件相符，原JAR／Ivy SHA未变。这不是二进制可复现来源证明，也不是法律审批。

正式材料：[许可证依据](../third-party/sbt-twirl-1.5.1/README-LICENSE.md)、[完整LICENSE](../third-party/sbt-twirl-1.5.1/LICENSE)、[结构化证据](../third-party/sbt-twirl-1.5.1/EVIDENCE.json)。原1065 missing-license报告和已签出供给不回写；新证据补足当时缺口。后续release writer仍须实际装入许可证和归属说明，不能仅凭本页宣布dist交付。

## 13个Git文件

`GIT-DISPOSITION-1127.json`逐项核对13文件：工作树、index、`1b7f0ea`及1123保护库存字节相等。用途依据为README、HANDOFF、工具／模板配置和`test/i0-design.test.mjs`中的路径存在断言。

**裁定：保留全部13文件的现有Git跟踪、原路径和字节；继续暂停，不运行、不修复、不计入V1已验成果。** 它们是保留的草稿源码，不是待清理的编译产物。取消跟踪会让新clone缺少现有设计测试明确要求保留的路径。原提交越界纳入是历史流程事故，不等于当前必须删除文件。此处关闭的是跟踪处置决策，不是草稿实现验收。

未运行`git rm`、reset、rebase、stash或commit。默认package scripts仍显式排除暂停runner；未执行该runner。

## 旧测试数据库与凭证

`CREDENTIAL-DISPOSITION-1127.json`只读取安全的容器元数据与文件权限：

- 容器`bank-v1-59o-760-mysql`归属`bank-v1-59o-760`，ID与原测试资源相符。
- 当前exited、restart=no；原端口绑定只为loopback。未启动它、未接触共享数据库。
- 父目录700，mysql-root、mysql-client.cnf、credentials.json均600；凭证内容未读、未打印。
- 原作者明确使用两个独立`secrets.token_hex(24)`生成测试密码；不能据此证明无人后来在其他地方复用。

**处置：该数据库仅保留为离线历史证据，不得用于后续部署、恢复测试或release；后续使用新独占数据目录和新生成私有凭证。** 不复用旧应用配置及database-760目录。

**密码没有轮换，也没有证明旧密码失效。** 若有人手工重新启动／恢复这个归档数据库，旧密码仍可能有效。此处是离线隔离及退役处置，不是密码撤销；不为改密码而启动旧库并改变受保护数据／日志。跨系统复用状态未知。旧输出不删除，泄露事实仍保留。若未来确需恢复归档数据，必须先作为独立安全操作处理旧认证，不能直接恢复为可访问服务。

## 验证与未完成项

- `capture-license-1126/result.json`、`local-disposition-1127/result.json`均passed，实际子进程wait/exit0，无源／保护漂移。
- 主会话完成核查；两个代理分别遇到400／422，没有独立审查通过结论。
- WebFetch仍有域名验证失败；直接HTTPS读取官方API和raw内容成功。用户提供的GitHub URL有效，未把工具失败解释为链接失效。
- driver最初一次命令缺`--config`，在启动作者前退出2；补正确参数后1125基线运行通过，无覆盖旧成功执行。
- P32仍欠正式release执行器、原25项最终同版本认证、dist writer与搬移真实运行验证。许可证取证和Git决策不再作为“等待用户授权”；运行时冻结和旧证据保护继续。
