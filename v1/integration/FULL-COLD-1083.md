# 双链完整银行冷测试（1071–1083）

最后更新：2026-11-03

**BC和JS完整银行单元测试分别141/141通过，均为全空缓存、无编译桥预填、仅file仓库。P32仍未签收。**

证据根：`.scratch/p26-p32-bank-v1-59o__arv/p32-full-cold-1071/`。

## 最终同源码窗口

| 链 | 正式生成目标 | 冷运行 | 真实结果 | 外置测试支持包 |
|---|---|---|---|---|
| BC | full-cold-1076/bc-app | cold-1079 | 141测试、29套件、31 MockTA进程退出 | test-support-1078 |
| JS | full-cold-1081/js-app | cold-1082 | 141测试、30套件、31 MockTA进程退出 | test-support-1080 |

- 每链独立HOME/boot/global/Ivy/Coursier/tmp和worker journal；JDK11、网络guard、`bridgeComponents=[]`、literal `test`，未使用testOnly或窄suite过滤。
- 正式输入为release-bridge-1069，request与936字节相同；选项只重绑runtime Maven和独立ext。生成代码不手改，手写测试不复制进generated。
- 外置支持包各219文件，包括全部31银行Scala测试文件（其中25 spec）、两个MockTA worker及其模块、完整银行tree/六binding、truth工具本地模块/schema闭包、现存Node executable。每件保留源SHA，两个包manifest一致。捕获末尾重核每个源文件和完整test/tree/schema集合。
- 仅银行BankPaymentJointSpec两处旧绝对scratch路径改为必需`bank.mock-ta.joint-root`；业务断言未改变。cold工具新增可选testSupport pin/完整库存/固定设置，不提供任意任务入口。
- `Test / envVars`同时固定TRUTHSRC_ROOT和GIT_CEILING_DIRECTORIES，阻止捕获truth工具的gitHead向上读宿主仓。GIT-CEILING-1078.json实际验证未返回宿主HEAD。
- `node-b`十个Node文件141/141，通过相应路径/hash/库存与固定设置负例。这里的Node141与每链银行141是两套测试，不相加。

## 编译桥与供给

承接[编译桥诊断](BRIDGE-COLD-1070.md)，supply1068相对998只增加精确util-interface1.4.0。最终两链从源码冷编compiler-bridge1.4.4/Scala2.13.14，`BRIDGE-ARGV-1083.json`重新核实际stdout锁定的32-token参数：8个classpath JAR中确有1.4.0，SHA匹配供给，不是1.4.9替换。原失败1000的classpath只有7个JAR，缺此项。

原清单三项derived bridge blocker不改。Scala2.12.12和2.12.13历史派生桥没有被这些冷应用构建导入；它们的独立重建仍未验，不与普通published compiler-bridge_2.12 JAR混淆。BC生成器是Scala2.13.16/sbt1.11.7，其自身闭包不由应用冷构建证明。

## 验证与保全

- `COLD-1079-VERIFICATION.json`、`COLD-1082-VERIFICATION.json`：绑定build/driver/log SHA、219原字节支持文件、141真实测试、各31 worker退出、新bridge产物SHA。
- `VERIFICATION-1083.json`：最终源码窗口、供给文件、旧证据、六仓HEAD/index、原25要求及P32 blocked状态的总范围核对。
- 原1074 JS141通过保留为Git ceiling加固前窗口；新JS1082复验，不覆盖1074。旧capture1072/1075与新末尾重核1078/1080分开保存。
- 原1067发现顺序断言失败保留；无旧供给/目标/journal/成功回执覆盖。新增formal-input和文档属于本轮增量，未提交。

## P32仍欠的成果

1. sbt-twirl1.5.1插件特定license证据：有限离线搜索未找到精确POM/source/license；没有联网下载授权，不继承相关模块许可。
2. 两个历史Scala2.12派生桥独立重建。当前两应用冷测试不依赖这些预填文件，但不能替它们核签。
3. 生成器、正式输入、ext、测试、全部依赖及配置作为整体搬移后实跑；本轮是应用冷unit测试，生成器本身仍从工作区/宿主工具链运行。生产部署未在搬移位置验。
4. 完整release executor、原25要求逐项certifier及受控dist writer仍未实现。本轮driver/局部verifier不能代替发行总门。

旧凭证、13误纳路径、现代Mongo兼容与KB #201等事故/平台事项仍独立保留。本次未启动服务/容器、无下载、无运行库或公共生成器源码修改，无新提交/推送。
