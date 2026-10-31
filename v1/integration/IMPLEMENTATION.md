# 银行并行实施接口合同（待最终双链核验发锁）

最后更新: 2026-10-31

接口源码位于 `v1/handwritten/scala/example/bankwealth/integration/BankApplicationPorts.scala`、`BankRuntimeDirectory.scala`、`BankJournal.scala`；业务 DTO 来自 `v1/tree`，正式完整输入 `v1/formal-inputs/release-service-631`，不是第二份手写DTO。`BankServiceService.Outcome[A]`为闭集Failure或成功A，HTTP状态400/401/403/404/409/503；未知业务状态应保留在成功响应的进度字段，不伪造成失败。

## 共同规则

- 所有principal来自生成服务Authority边界；依`BankDemoConfiguration.customer/operator`核身份与角色。查询先授权再读库/actor/journal，不能把客户端account/order owner当事实。
- 完整源新增cashRequestSource、createIntent；`BankTrustedAdmission`负责原wire/domain金额核等与完整有限严格递增日程核验。恢复再次核入站；C补日程必须先核已持久prefix，禁止只凭集合覆盖重建顺序。
- `BankJournal`读取真实事件携PID/sequence；保留PB与PersistentMonarch原始RunStarted。不能只用callback或RAM目录恢复。父流程ID与payment TransactionIdentity不同，必须用实际选中paymentTxId。
- `ensure*`仅获取/装配原身份的actor图，不自动创造新资金正文，不等开始或业务成功；启动由相应服务在持久意图后执行。句柄缓存不是业务权威。
- Money继续38/2/CNY，HTTP minorUnits字符串；TA nav/shares原文本。TA accepted/effect confirmed/付款成功不等投资成功，只有可信相关TAConfirmed才是客户成功。
- 不编辑generated，所有外部源码/测试由显式挂载。不能更改旧tree/根binding/376历史输入/历史journal与失败产物，不改运行引擎，不下载/提交/发布。必要Docker集成允许，但由主会话串行登记资源；代理不启服务、不自行跑重型。

## A：读侧与页面

实现`BankReadQueries`。构造建议`BankReadside(journal, config, dataSource)`，event/checkpoint同事务，按PID/seq连续水位，冲突payload拒绝，早到关联可重试。所有查询输出生成的metadata响应；客户只自己account/order/plan，操作员pending专用。页面类接受同一queries与业务服务，不定义平行业务语义。HTML可以手写模板，但不得把任意用户值无转义拼入HTML。JSON写器由主会话BankServiceJson供给。

先交付可实例化类、接口所需构造参数与独立测试。页面服务当前生成router只API，页面路由接线由主会话集成，不自行改公共generator或shared配置。文件归属沿OWNERS.A。

## B：TA与退款

实现`BankTaRefundService`，建议类`BankTaRefundApplication(directory,journal,client,scenarioForOrder,onTerminal)`。scenario受信demo配置，不接受HTTP forced outcome。复用BankTaBridge/BankRefundBindings/BankTaEffectBindings，保taRequestId跨register/submit/accept/ingest间隙；拒绝+已付款建立唯一退款，独立反向Saga，不当普通补偿。

MockTAClient新配置对象显式Node/worker/owned evidence root，旧构造可保兼容但生产调用不得引用旧scratch。不启动worker测试，由主会话队列。onTerminal只能传已核订单，C使用真实桥再核first terminal，不互改C文件。文件归属沿OWNERS.B。

## C：定投与恢复

实现`BankSipApplicationService`，建议类`BankSipApplication(directory,journal,config,admission)`；create先RecordSipCreateIntent，再Create/Append/Seal。BankAccountKey有schemaVersion字段，不是早期空record草案。Cash内部提交使用持久SipOccurrence，不接受客户构造账户。

恢复read createIntent后用admission.validateSip，现有dueSlots map按位置必须是完整intent.request.dueSlots精确prefix；错序/多项/冲突拒绝。按旧Observe/Skip/Trigger命令/政策和稳定occurrence恢复，不等前一期TA终态，不自动三败暂停。recordTerminal复用BankSipTerminalBridge.record。需每期dispatch实际parent.start，不只建立句柄。文件归属沿OWNERS.C。

## 验收范围

双链compile和当前28-test只是共享接口/actor前置，不是P26–P32整包完成。A/B/C交付后主会话在同一冻结外部源码窗口执行各专属测试、完整联合、跨JVM、实际HTTP与必要Docker集成。原25包数量不变。
