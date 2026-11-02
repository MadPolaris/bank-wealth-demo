# 原付款五类结果与 seed 竞争验收

最后更新: 2026-11-01

## 实际执行

`BankPaymentDeliveryAcceptanceSpec` 四例与 `BankSeedConcurrencySpec` 三例由968 BC963、970 JS956完整140tests分别执行通过。不是只静态查代码，也不以退款补偿代替付款补偿。

五类结果对应：

- succeeded：真实三参与者付款100.00后900.00/100.00，原order成功PB，host原输入/identity/intent/ACK，Monarch完整StageDone snapshot含唯一txid；cursor=`pay-cash-purchase#0`、空metadata、单一RunCompleted。
- rejected-before-effects：50.00本金不足、真实absence与取消fence、无reserve/commit、原order拒绝PB，Monarch无成功checkpoint且有原业务失败事件。
- compensated：真实ReserveFunds ConfirmedReceipt已形成、仅延迟原execute ACK；public Abort发生在commit decision前，真实query确认原reserve并释放100.00。无deduct、无募集入账，原order补偿结果PB，Monarch业务失败而非成功。
- outcome-unknown：真实reserve后只隐藏journal可见性，Saga RecoveryRequired且有Evidence.Uncertain；原order unknown PB，原parent只保RunStarted，无StageDone/RunFailed/RunCompleted。
- recovery-required：恢复真实receipt可见性并受信Reconcile预算1，实际出现预算耗尽且已无Uncertain；原identity不变，原order对应PB，parent仍Pending。再以预算32向前成功，完整记录unknown/recovery-required/succeeded的原host投递序列。

每类均验证实际原order、原txid、完整身份与资金参数；真实decoy order状态/事件不变。完成API拒错目标/操作/账户/金额/fund、篡改CompletionContext、错误result txid/identity/其他kind。Host七输入（含occurrence）任一替换均Conflict且全七持久流不增加。

原parent RunStarted完整七输入/计划cursor、成功后完整解码及重编码snapshot与独立预期相等。失败与Pending分别断言对应耐久事件集合，不能要求五类都有成功checkpoint。每类同PID stop/recover后的host重入无新增金融/技术事件；**不是额外跨JVM证明**。既有934的内部成功交付ACK强杀不重做。

## Seed 三例

- barrier保证两个ensure都完成真实空journal读取，才把原InitializeAccount请求交真实actor；相同配置只有一条AccountInitializedPB。
- 两种初始金额竞争，恰一成功、一因原事实冲突失败；胜出PB/状态一致，重复不增加。
- withholding仅保留真实actor发出的非空Accepted；原请求3秒超时后BankSeedAuthority真实重读PB成功，不再发Initialize。真实reserve导致余额900.00后新authority实例重入不补款。

## 保留边界

965编译误读尚在创作的代理文件，使用不存在receipt.reserveFundsConfirmedTxid；966未执行。代理停止后主改为当前真实payloadTxid，并统一运行968/970，旧失败不覆写。

本次未修改业务Scala、真源、公共生成器或冻结runtime。原25包整包认证、MySQL事务故障完整对应、P32可搬移/许可证/干净缓存/release总执行仍由各自证据判断；不可据七个新增用例宣布全V1通过。
