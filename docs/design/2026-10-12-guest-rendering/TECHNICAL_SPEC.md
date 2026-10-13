# 顾客端静态展示与动态预订

需求日期：2026-10-12。用户授权直接实现首页/关于 SSG、小屋 SSG/ISR、库存独立动态请求、登录状态独立读取和最终实时提交校验。

## 渲染与数据边界

| 内容 | 策略 | 实现 |
| --- | --- | --- |
| 首页、关于 | SSG，dynamic=error 防止意外加入请求时读取 | app/page.js、app/about/page.js |
| 公开小屋列表、详情 | ISR 3600 秒；公开数据缓存同样 3600 秒 | public-cabin-data.js、cabins 页面 |
| 动态房间参数 | 构建生成已有 ID；dynamicParams=true 允许新增 ID 按需生成 | generateStaticParams |
| 筛选 | 初始全列表预渲染，挂载后读取 capacity URL；操作更新 history 与本地状态 | CabinCatalog、Filter、CabinList |
| 登录状态 | 一份共享客户端请求，private/no-store，仅 name/image | GuestSessionProvider、/api/guest/session |
| 库存/价格/容量/规则 | 动态 no-store，最小公开字段及 date-only 日期 | /api/cabins/[cabinId]/availability、Reservation.tsx |
| 最终提交 | 现有 session→schema→实时规则/取价/库存检查→数据库约束 | actions、booking-service、迁移 |

公共布局的 Header 不再调用服务端 auth。客户端 Provider 不传服务端初始用户，静态 HTML 始终只有通用导航和预订加载占位，避免跨用户缓存。

公开缓存仅包含房型展示信息。鉴权会话、预订规则、当前库存、最终写入与 AI 实时工具不会读取此缓存。保留原 api/cabins/[cabinId] 并明确 no-store，避免旧入口缓存库存。

## 交互和失败处理

- 会话和库存独立并行加载，单个共享 session 请求供导航和表单消费。
- 读取设置 15 秒客户端期限；失败显示重试，库存失败不显示可提交表单，会话失败不伪装为匿名成功。
- AbortController 清理切页/卸载/旧请求。房间 ID 改变立即隐藏上一房间的数据，返回结果校验 cabin ID。
- 重新聚焦标签页刷新会话和库存；按当前规则检查容量、日期和占用情况。最终服务器仍重新校验，客户端新鲜结果不替代数据库一致性。
- AI 预填继续使用 ReservationContext；日期字符串按本地日历构造，避免 UTC 偏移。日历/表单使用实时报价而非 ISR 卡片价格。

## 取舍

小屋构建重新依赖公开数据库读取；失败不能伪造空目录或生成不存在的成功结果。主页和关于页本身不读取业务数据库，但同一次完整构建仍包括小屋读取。

后台编辑公开介绍/照片/列表价后，ISR 3600 秒过期由后续请求触发再生成，期间可能返回旧内容；不保证严格一小时内生效。本轮没有增加跨端立即失效接口。当前预订区与最终提交使用实时数据，因此库存/实际报价不等公共缓存刷新。

最终数据库排斥约束、服务端业务规则和生产部署不在本轮改变范围内。测试禁止写实际订单或付费模型调用。

## 验证

2026-10-12 本地验证：

- 完整 npm run check 成功：lint、TypeScript、62 文件/848 测试及 Next 生产构建通过。保留原有四处 img 警告和 Browserslist 陈旧提示；未补装或升级依赖。
- 新增 18 个行为检查覆盖最小会话/no-store、匿名与错误区别、库存 ID/字段/错误、加载前禁用、失败重试、旧房间请求取消/忽略、错误房间/日期、共享 session、默认列表预渲染与 URL 筛选。
- npm run verify:rendering 通过：首页/关于 SSG，列表与 8 个详情 ISR 3600 秒，公开卡片确实存在于生成 HTML；新增动态读取接口不进入预渲染清单。
- 本地生产服务真实 HTTP：首页/关于 x-nextjs-cache HIT；列表/详情 HIT 与 s-maxage=3600；会话 private,no-store；真实公开库存 no-store/200；非法 ID 400、不存在 ID 404。首页携带不同 Cookie 返回相同 HTML。
- 隔离 Edge 浏览器、localhost:3101：URL 人数筛选正确；真实日历/匿名登录提示正常；合成 session 显示表单；390px 无横向溢出。真实公开报价 250 的三晚显示 750。
- 浏览器 HTTP fixture：模拟当前价格改为 320，三晚显示 960 且所选日期保留；库存 503 保留静态介绍并隐藏提交入口；解除库存 fixture 后重试恢复真实日历/表单。合成姓名/价格不作为真实身份或数据库写入证据。
- 移动端 fixture 截图保存在 ignored output/playwright/guest-rendering-mobile-fixture.png，已视觉检查；没有提交实际预订、调用模型、创建身份或部署。
- 初始 Windows 沙箱 realpath EPERM 导致 Next 误判依赖不存在，自动补装及时终止；在获准的沙箱外运行检查成功，package-lock 未改变。第一次组件测试发现既有 .js JSX 不被 Vitest 转换，增加 Next .js JSX pre-transform 后定向与完整测试均通过。

进度与生产验收继续只维护在员工仓库 docs/FEATURE06_PROGRESS.md；本文件是设计说明和验证结果，不是第二份任务状态记录。

## 2026-10-13 人工反馈修复

- D：真实 DayPicker 的占用夜晚在选择新入住时禁用，允许合法半开区间的退房边界；占用样式应用到 day button。库存变化使既有选择失效时清空并提示。
- G：用户具体房间/日期在数据库已存在，但旧生产 availability 未返回，不能仅凭响应 no-store 断言新鲜性。公开 Supabase 上游 fetch 显式 no-store；持续有效库存按 endDate 大于今日查询，包含已开始但未结束的非取消预订。
- 加载：首次大号转圈，刷新小转圈；刷新保留日历和所看月份，提供显式 Refresh availability；未完成刷新不允许提交。
- 补验：实际 DayPicker 点击退房/入住边界、库存刷新阻断新订单、未来月份保留，以及上游 fetch 缓存策略。发布后必须用用户给出的2026-12-01至12-04样例核对API/日历，不能复用昨天“其他订单已显示”的证据。
