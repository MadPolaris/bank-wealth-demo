# 隔离区手写迭代与知识回锚（Back-Anchoring）实操记录

## 1. 触发场景：AI Agent 在手写隔离区发现领域规则缺口
在实现 `FundOrderIsolationAdapter.scala` 的过程中，AI Agent 接收到产品侧补充要求：
> “基金申购存在最低起购金额校验（且严禁0元或负数申购），如果在 `Prepare` 阶段不拦截，会导致核心账户 `CreditBalance` 白白执行一次冻结再走 TCC `Compensate`。”

## 2. 错误做法（破坏真源唯一性）
在 `FundOrderIsolationAdapter.encodeCommand` 手写代码中私自加上：
```scala
if (amount.minorUnits <= 0) throw new IllegalArgumentException("62004: invalid amount")
```
这会导致业务规则漂移（Truth Drift）：AST 与 `tree/` 真源不知道 `62004` 错误码的存在，前端 `use-cases.yaml` 也无法感知该前置条件。

## 3. 正确做法：通过 `sourceMap` 逆向回锚（Back-Anchoring）到 `tree/`
AI Agent 检索 `compiled/saga-ir.json` 的 `sourceMap`，定位到 `FundOrder` 聚合的真源文件，按以下 4 步回锚：

1. **回锚至 `tree/inbox/eventStorming/question-es-is-minimum-subscription-amount-enforced-in-aggregate-4.yaml`**：
   记录问题决议：在 `FundOrder` 聚合内通过 `IR-FO-RESERVE-002`（错误码 `62004`）拦截。
2. **回锚至 `tree/aggregates/fund-order/aggregate.yaml`**：
   在 `aggregateRuleRefs` 中注册：
   ```yaml
   {
     "ruleId": "IR-FO-RESERVE-002",
     "errCode": "62004",
     "desc": "Subscription amount must be positive and meet fund minimum threshold (back-anchored rule)."
   }
   ```
3. **回锚至 `tree/aggregates/fund-order/slices/reserve-fund-subscription.slice.yaml`**：
   在 `guards` 中声明结构化守卫：
   ```yaml
   {
     "ruleId": "IR-FO-RESERVE-002",
     "errCode": "62004",
     "onFail": "reject",
     "when": {
       "form": "money-positive",
       "amount": "param.amount"
     },
     "desc": "Subscription amount must be positive."
   }
   ```
4. **回锚至 `tree/use-cases.yaml`**：
   将 `IR-FO-RESERVE-002` (`62004`) 绑定到 `PurchaseFund` 用例的 `preconditions`。
5. **重新编译生成 AST 与新 Digest**：
   编译器重新导出 `compiled/saga-ir.json`，更新脚手架守卫内核，保持手写隔离区 100% 纯粹（仅负责协议编解码与端口适配）。
