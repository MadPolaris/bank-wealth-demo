# bank-service-pages/v1 — 正式页面与浏览器交互

最后更新: 2026-11-01

原P26–P32客户/操作员页面的实现合同，不是新增业务政策或验收通过。713恢复711的3491项源码；714完成真实Scala/Play先验。旧无页面输入与输出保持字节兼容，银行release-service-631历史输入保持。

## 公共typed能力

在现有truthsrc.play-service/v1、artifact-binding/contract v3中增加可选`pages`对象。缺省不发射任何页面代码，不注入空值。明确采用旧输入兼容的加法扩展：旧reader不支持新输入，不称双向兼容。

```
"pages": {
  "schemaVersion": "truthsrc.service-pages/v1",
  "shellPath": "/bank/v1",
  "scriptPath": "/bank/v1/client-script",
  "renderer": {"id": "example.bankwealth.web.BankBrowserPages", "version": "1"},
  "aliases": [{"endpointId": "<existing-id>", "path": "/bank/v1/accounts/me"}]
}
```

- 对象字段闭集；aliases为非空有界数组（最多256），endpointId唯一，必须引用既有endpoint，path参数名称与顺序精确相同。继承method/audience/CSRF/input/output/实现pin；不得覆盖这些字段。
- shellPath/scriptPath必须纯静态规范路径；两条GET与所有API/alias按method与segment通配重叠检查，拒绝重复、wildcard、traversal、query/fragment/编码路径声明。
- renderer.id为显式合格FQN，version非空有界文本；只核已安装对象，不由metadata反射加载renderer。
- shell/script为唯一额外公开GET，仅静态内容，无RequestHeader/principal/config/业务函数参数，不调用任何业务端口，不等待业务ready。别名调用与API共用原action，所有失败状态含401/403/409/503保留。aliases只改变最终格式，GET仍零业务副作用。
- strict JSON、auth先于DTO、CSRF/Origin、ready及错误恢复不弱化，未知路由不处理。不接受extraRouter/Handler、任意controller method或Scala文本。

生成合同（只对有pages输入发射）：

```scala
trait PageRenderer {
  def implementation: String
  def version: String
  def shell: String
  def script: String
  def render(endpointId: String, status: Int, value: JsValue): String
}
// Composition 增加默认实现以不迫使既有组合根增加占位件
// 有pages时requireInstalled必须核Some/非null及id/version。
def pages: Option[PageRenderer] = None
```

生成端掌握HTTP Result/status与安全headers；renderer只能提供文本，不获得router或endpoint。HTML和script均no-store/nosniff/no-referrer，HTML CSP `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`。script响应application/javascript。页面结果含业务数据全转义，无内联script/用户控制HTML槽。

## 银行浏览器

使用已存在Bearer＋X-CSRF-Token/Origin认证，不新增cookie或服务端会话、角色来源。公开壳让用户输入受信demo配置发放的token与CSRF；仅保存在JS闭包内，禁止local/sessionStorage、cookie、URL、日志、HTML预置真实凭证。页面角色选择仅选择验证哪个受保护查询，不是身份声明；成功200后才显示对应工作区，401/403清理凭证和旧业务结果。退出清理内存/输入/DOM，刷新需重新输入。

BankBrowserPages通过静态shell/script与现有BankPageRenderer转义提供：客户账户、现金提交与原请求、订单、定投列表/创建/详情/期次/修订/暂停/恢复；操作员pending/已有operation reconcile/manual tick。14个别名来自正式源，不任意重写prefix。表单只构造现有封闭DTO；Money/minorUnits始终文本，不转浮点，slot/revision遵守既有wire类型。业务状态与投影水位按服务响应呈现，不将付款/TA accepted当投资成功。

主会话BankServiceFactory只挂renderer，保留BankBusinessClock和已有bindings。旧BankPagesController不挂第二router且历史测试保持；新浏览器走正式生成action。

## 本轮owner

- MAIN：合同/协调、bank-service.formal.yaml正式源、BankServiceFactory挂载、fresh完整输入/目标/金样生成、最终测试与保护回执、全部重型运行。
- JS公共单一委派：`schema/play-service-v1.schema.json`、`lib/products/service-deployment.mjs`、`generators/scala-cqrs-play-service/render-service.mjs`及必要新同目录helper、`test/service-pages*.mjs`新测试/fixture；不改旧fixture，不构建、不生成目标。
- BC公共单一委派：`ServiceDeploymentProducts.scala`、`ProductServiceModel.scala`、`ProductServiceBuilder.scala`、`ProductServiceTemplate.scala`及必要新同目录helper、`ServicePagesProductsSpec.scala`/`ProductServicePagesSpec.scala`新测试；不改旧golden，不构建。金样由MAIN正式生成。
- A页面单一委派：新`v1/handwritten/scala/example/bankwealth/web/BankBrowserPages.scala`、新`v1/test/scala/BankBrowserPagesSpec.scala`与新`tools/v1-browser-check.mjs`；不修改shared auth/factory/真源/旧页面/readside、不启动服务/浏览器/测试。

所有委派必须先捕获自己路径现有SHA或不存在；重型执行位1，代理只代码。三runtime冻结，不下载/新提交/服务或共享应用操作。测试用testkit/H2证明本地，真实Mongo/MySQL独立验收，不冒混同。

## 实施核验记录

三路委派在EOF/quota中断后由主会话接管，不作为代理完成。当前renderer为`object BankBrowserPages`，Factory使用该单例，仅静态文本，无业务服务或配置引用。两个生成器有pages时发射统一action及静态GET；没有pages时保留旧源码字节。734已通过JS生成应用的真实浏览器transport验证（26条记录、14表单、精确Long、401/403/退出/刷新清理）；查询使用未知投影测试桩、写端口一律503，不是实际银行资金、生产Factory或Mongo/MySQL验收。

HTTP transport fixture显式`service.test-tier=http-transport`，只复用testkit存储配置且不启动业务actor，允许独占loopback port0；不会启动UnitTestMain或降低单元no-network门。单元测试继续`service.test-tier=unit`与UnitNoNetwork。

最终回执及同源码双链/公共全量在本轮scratch交接中核定。早红719、726、731/732和旧targets保持；不升级为原25包总验收。

## 验证

JS/BC独立静态反例（未知键、缺pin、非法path、alias关联/参数/重叠、payload/source不等）及无pages兼容；fresh独立非银行fixture、正式双链金样/真实compile与router边界；银行新完整输入与双链应用各suite；缓存浏览器真实登录/导航/14操作和失败处理，记录HTTP/DOM，不读取真实credential。全量公共回归与原25包欠门保持。
