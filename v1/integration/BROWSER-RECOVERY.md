# 浏览器资金、干净重放与自动退款恢复

最后更新: 2026-11-01

本检查点接续已提交801，不改变原P26–P32的25包终点。完整本机证据位于 `.scratch/p26-p32-bank-v1-59o__arv/`。冻结运行库仍为 `0.2.1-p23.20261027.1`；没有更改公共生成器、正式输入、生成源码或旧journal。

## 真实浏览器路径

新增 `tools/v1-browser-funds.mjs`，与754仅transport的 `v1-browser-check.mjs` 分离。调用者必须显式提供已安装浏览器、127.0.0.1非共享端口、synthetic凭证和模式；导入不启动进程，不下载。客户/操作员登录、现金请求、查询、时钟和SIP操作都通过实际页面输入与按钮，不用API写请求代替浏览器操作。启动协调器只用一个API GET等待就绪。

浏览器等待实际HTTP与DOM完成，从可见DL/UL/SPAN结构解码，不在整页文字中搜索成功字样。金额、Long、份额及NAV保持原文本；不会因disclaimer含confirmed就判成功。凭证只在页面内存使用，退出/刷新后清空，cookies/localStorage/sessionStorage为空。已有754的宽Long/401/403负例仍是独立transport证据，未向真实MockTA发送不安全大整数tick。

- 新 `bankv1_59o_803_js` / `bankv1_59o_803_bc` 与各自新TA journal；原760数据库及TA记录保留。
- 805首次现金100.00成功，但新计划尚无持久tick，暂停按规则409。验收脚本修正为先tick1；没有改业务规则或清库。806从原现金/计划恢复，完成两期各10.00。
- 807JS重启、808BC干净启动、809BC重启、810/811两链TA拒绝后独立退款通过。余额880.00/120.00，预留0；定投成功2、失败0。
- 退款仍为独立反向Saga，保留原付款成功；同key重复不二次退款，异正文409。实际TA确认文本为 `80.0000` / `1.2345`。
- `BROWSER-CROSS-RUN-817.json`对跨JVM完整原请求、TA/退款订单、账户、期次及每PID水位做实际字段比较。

## CQRS干净重放

先在应用停止后保存814真实Mongo和MySQL内容；新建两空MySQL库，改接读侧，保持原Mongo namespace和TA journal。815/816只经浏览器GET查询恢复后的历史，未从页面发业务写入。

817逐列读取五表（blob转HEX并按主键排序）：每链35条流、213条事件、2条期次、0待处理；新库与原库内容/SHA完全一致。原投影和Mongo全量非system集合内容前后SHA均不变。`REPLAY-VERIFIED-817.json`为精确核验，不仅是页面余额相同。列表整体仍为unknown（没有全局发现frontier），单对象相关PID的last/observed序号相等。

## 自动退款缺口与修复

独立只读复核发现：原恢复循环只显式reconcile付款；TA服务虽然重挂退款parent，但冻结Saga在恢复后执行开关为关闭，不自动继续。现有退款UNKNOWN测试直接手动Reconcile，不能证明自动恢复。

新增真实actor/testkit故障用例，在原退款的募集户Prepare、募集户Commit、投资人Commit事件耐久后隐藏其查询收据，证明出现UNKNOWN，再终止原actors并await，恢复同一testkit journal，启用真实 `BankRecoveryLoop`。测试本身不向协调器发送Reconcile。

- 820修复前：原122通过，新增3例均停在RecoveryRequired失败。
- 银行 `BankRecovery` 新内部resumeRefund，复用非终态/真实identity/受信machine授权检查；`BankRecoveryLoop`从原 `FundPurchaseRefundRequestedPB` 读取完整退款事实后恢复，不铸新请求、目标或transaction。
- 821JS / 822BC：compile、Test compile和全部tests均 **129/129**。新增3例转绿并核唯一原intent/RunStarted、各资金事件一次、refund result一次、资金1000.00/0.00。另4个退款状态/外来identity负例与付款测试对称。
- 818为测试字段大小写编译失败，819被生成的testOnly隔离门拒绝；改用原完整test，不覆盖/关闭门。失败日志保留。
- 修复后823/824两链真实新JVM浏览器重入、825/826浏览器只读重放通过。827检查Mongo与业务载荷/消费checkpoint全部未变，但其“所有投影字节不变”总断言失败：JS原读库35行observed_sequence由NULL刷新为各自last_sequence。829逐列限定核验除此字段外无变化，四次浏览器完整身份/终态仍与之前相等。保留827失败，不声称关闭后采样水位确定失效或所有表字节不变。
- 828 Node共11项（9个浏览器配置/DOM解码/清理测试、2个完整输入测试）通过。830 KB仍为既有断链及20个新鲜度标记欠账，不称全仓green。

该故障试验是同ActorSystem的真实持久actor重启，**不是指定耐久点的跨JVM SIGKILL验证**。生产浏览器重启是真实新JVM，但没有注入这些精确phase故障。

## 关闭竞态的进一步修复

832最终日志门发现823仍有6个RejectedExecutionException：JDBC executor开始关闭时仍有最多61个排队Future continuation。此前将executor放到最后关闭不足以保证业务自建线程池中异步链完成。827的水位差异因此不能只当普通采样刷新忽略；829仍有效证明资金和checkpoint字节没变，但不证明关闭正确。

`BankReadside`增加显式异步shutdown：停止新工作/取消定时扫描，追踪并等待当前project、catchUp、query、发现流和订阅结束（包括其失效回调），再统一使observed frontier失效。同步close在释放外部executor前有界等待。不是清消费checkpoint，也不修改业务事件/余额。新增确定性测试用Promise阻塞有限journal读，证明shutdown先保持pending，释放读后才完成、observed为NULL且last_sequence保留。原重开测试补充先unknown、显式重新采样后再caught-up；外命名空间的同步拒绝保持。

833测试Source.maybe类型参数缺失、834旧水位假设及同步拒绝回归失败均保留，随后修正。窄范围独立复核指出operator pending查询也需加入排空，且关闭异常不能中断组合根其他资源释放；已补跟踪和BankResourceCleanup（全部资源逐一尝试关闭，保留首异常及suppressed）。新增关闭后operator查询零JDBC访问、失败资源不跳过后续释放的测试。最终结果以新核验回执为准。

最终844JS / 845BC同源码编译与全量测试均 **131/131**（含自动退款、排空关闭、失败资源清理）。冻结公共生成器源码与795/754保持，本轮未重跑其1067/2332公共全量。

## 仍未关闭

全部指定持久点的跨JVM强杀、请求持久后未start/退款intent后未装配/结果已存ACK丢失的完整矩阵、原25包逐项总验收、最终1:N锚及源增量双链再生、P32可搬移依赖与受控release工具仍欠。Mongo4.4仅隔离验证（已EOL），现代Mongo6与锁定驱动不兼容的记录不变。没有把本检查点称作完整V1、生产多写者认证或规模性能认证。没有新提交或推送。
