# bank-service-integration/v1

最后更新: 2026-11-01

状态：**645实施准入与675双链本地集成已通过，原P26–P32的25包尚未完成**。646已正式发A/B/C路径锁，全部交付已归还并经主会话集成；673/674银行应用各105/105。单元测试使用testkit/独占LevelDB，不需要Docker；必要的集成与路演允许Docker。587当时未授权连接尝试及590恢复记录原样保留，不追溯洗绿。页面部署路由、Mongo/MySQL、跨JVM及干净交付仍待验。阶段范围见[CHECKPOINT-675.md](CHECKPOINT-675.md)。证据根：`../../.scratch/p26-p32-bank-v1-59o__arv/`。


## 权限与身份

- 单元测试使用owned测试JVM/testkit journal与snapshot，磁盘恢复可用独占LevelDB/本地snapshot；必要的集成/路演测试允许使用Docker Mongo/MySQL，先核资源归属和隔离命名空间，不操作无关容器或清共享数据。无下载、worktree或运行库修改许可。用户本次另行授权675成果的本地阶段性提交，不含push/publish。重型执行位1。
- 可信principal由认证边界创建，角色、账户和基金募集账户来自版本化配置。现金请求仅接受clientRequestId、fundCode、amount{minorUnits,currency}。
- request/order/operation身份由principal＋clientRequestId稳定导出，不含金额、attempt、当前时间。重复同正文回原身份；同key异正文409。完整来源/正文先由生成actor持久化，再启动原现金流程。
- 查询先授权；机器seed、TA回执、自动退款不开放HTTP入口。操作员只恢复已有identity与manual tick，不接收新资金正文或自报phase结果。
- seed读原AccountInitializedPB核对，已初始化且余额变化不能重新credit，也不能用当前余额判定原seed冲突。

## 共享类型和端口

- 生成具名DTO/端口；具体银行实现不定义第二份状态模型或通用宿主引擎。
- CashRequestService.submit/getOriginal：原请求、durable acknowledgement、已有身份。
- RuntimeDirectory：唯一actor/PID和ensureCash/ensureTa/ensureRefund/ensureSipDispatch装配；内存registry只缓存句柄。
- DurableJournal：应用namespace内PID发现、带序号的PB事件读取、可取消订阅；启动补扫加持续驱动，不能只用callback或读库清单。
- ReadQueries：账户、完整原请求、订单分层状态、SIP计划/期次、pending操作，附schema版本和每流水位/追平状态。
- TaRefundService.resumeExisting：从真实订单关联恢复TA与退款；只有可信TA拒绝＋原付款成功才能唯一退款。
- SipApplicationService：有限完整日程意图先持久，分步Append/Seal可恢复；现有revision/tick/occurrence身份和可信terminal桥复用。
- RecoveryService：授权后读取Saga完整原identity，UNKNOWN保持原父流程，不能新建现金操作重试。

## 可信入站校验边界

原请求wire金额与领域Money通过现有`DomainConverters.MoneyFromWire`精确转换核等；完整定投日程在`BankTrustedAdmission`核非空、最多1024期、严格递增、全部不早于effectiveSlot。两项由可信应用入站承担，不扩展公共表达式DSL。完整原文进入生成actor之前以及恢复读取之后均执行同一校验；失败不得创建现金/定投执行。RecordCashRequestSource/RecordSipCreateIntent是内部命令，不暴露HTTP或跨节点任意命令入口。所有资金/订单/期次状态仍只由生成event application演进。

生成actor负责原文一次持久、同正文幂等/异正文拒绝、后续付款/config与原文匹配，以及现有单调Append和封存覆盖守卫。C恢复Append时必须验证已持久日程是原完整vector的精确前缀，再按原索引补齐；不可仅用成员覆盖宣称原始顺序合法。测试必须覆盖伪造wire金额、重复/乱序/越界日程、持久后启动前恢复及冲突原文。

## HTTP合同

所有路径位于 `/api/v1`：
- 客户：accounts/me、cash-requests、cash-requests/:clientRequestId、orders/:orderId、sip-plans及详情/修订/暂停/恢复。
- 操作员：operations/pending、operations/:operationId/reconcile、business-clock/tick。
- GET零副作用；JSON闭集、金额字符串解码；页面写动作CSRF/Origin检查、HTML输出转义。
- 付款成功、TA受理、技术effect confirmed都不是客户投资成功；只有相关TAConfirmed才是成功。TA拒绝未退款显示退款处理中。未知/投影未追平/不存在必须分别表达。

## 公共兼容性合同

- 新显式 `scala-cqrs-play-service@1`，基于nominal text领域v4/依赖v6/folds v6和现有有限effect执行，不改变旧profile产物。
- 新 `artifact-binding/v3` / `artifact-contract@3` 在原artifact source residence上增加服务部署合同；旧v1/v2拒绝新字段，不放宽旧门。
- 原 `saga-host-contract@1` / `effect-host-contract@1` 精确依赖artifact@2，不能偷偷改为@3。因此为服务入口新增显式 `saga-host-contract@2` / `effect-host-contract@2`（binding/payload结构和业务语义复用v1，profile版本/依赖准确指artifact@3）；旧@1不变。新profile消费完整v2宿主，不复制或删掉原host依赖。
- 服务声明包含固定栈版本、bootstrap实现pin、受权HTTP action及DTO/端口pin、读模型/原事件字段映射、schema版本、symbolic配置引用。禁止任意Scala/SQL文本注入、动态执行代码或银行名硬编码。
- 缺实现、类型/来源不符、客户暴露机器动作、冲突路由、不可恢复namespace、配置缺失fail-closed；JS/BC独立校验，不让BC调用JS替代typed准入。
- generated build/config/bootstrap/router必须由正式producer/template发射。手写ext与测试从生成区外显式挂载，不复制进generated。生成器回锚与具体手写实现证据分列。

## owner与并行门

以 `OWNERS.json` 为精确路径归属。共享源/contract/bootstrap/router/build/config/公共生成器只由主会话或单一明确委派者修改。A读侧页面、B TA退款、C定投；各自专属测试，不争写BankPaymentJointSpec。

实施fanout前必须同时具备：版本化生成接口fixture通过、合同与owner/SHA固定、双链骨架和ext挂载compile通过。此前代理只读评审或主会话唯一委派的公共前置任务，不宣称A/B/C已开始。

## 验收

按原P26(3)/P27(5)/P28(3)/P29(3)/P30(4)/P31(4)/P32(3)逐包核证。局部测试绿不相加为全demo绿。Mongo/MySQL实际门在资源许可前blocked，H2只证明本地范围。旧P24/P25 32-test行为保留；新应用恢复、CQRS、页面、干净交付用独立回执。
