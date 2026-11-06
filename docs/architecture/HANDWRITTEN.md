# 手写代码的当前来源映射

唯一手写源码根是 `handwritten/scala/`。35份源码保留迁移前字节；文件来源关系放在本目录的 [HANDWRITTEN-SOURCE-MAP.json](HANDWRITTEN-SOURCE-MAP.json)，不混入源码 inventory，也不复制进 generated。

## 映射说明

- `implements`、`supports`、`legacy-adapter` 是明确的银行 owner 声明，不是生成器从名称推断出的业务关系。
- 旧映射来自固定 `4515b6b97d91714116b451b4e930dc81e112e528:v1/integration/HANDWRITTEN-SOURCE-MAP.json`，原数字 pointer 仅对其 `release-bridge-1069/request.json` 有意义。迁移时先解开原 pointer，再以每层数组元素的显式 id/name 查找当前对象，不能原样套用下标。
- 新映射绑定当前作者快照、`bank-v1` 文档摘要、全部35文件摘要及每条实际引用的值摘要。证据定位或真源变化后，旧映射明确过期；不自动重签。
- `BankRuntime` 现消费生成的本地仓储；`BankReadside`、`BankReadsideSchema` 消费生成的 JDBC 读侧。银行 owner、安全选择、DTO和业务投影选择仍手写。此说明承接此前获准兼容迁移，不是本批改写业务。
- 验证证明 **file级关联的真实字节及来源pointer可解析**，不证明自动语义正确、唯一symbol/span、运行行为或完整业务验收。

在银行根运行：

```bash
node tools/verify-handwritten-map.mjs
node --test --test-concurrency=1 test/v1-retirement-source-map.test.mjs
```

校验失败时检查当前作者/手写改动及映射时点；不能删除文件、放宽固定库存或把当前失败填成1134通过。历史映射和旧签收继续由[历史索引](../HISTORY.md)定位。
