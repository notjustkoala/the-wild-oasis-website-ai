# Feature04 最终审查与收尾记录

日期：2026-09-15。范围：网站 BFF/Concierge、员工 Operations UI、政策内容与导入、已部署数据库。

## 结论

- 人工验收：用户已确认完成；不再沿用历史记录中的“等待界面重试”。
- 最终规格复核：完成；验收期间的请求脱敏、当前轮隔离、单次检索、员工豁免证据补充、只解释不写入、引用交互均已复核。
- 最终代码质量审查：完成，由本任务的主审执行，没有派遣独立审查代理。未发现新的未处置 Critical/Important 代码问题。
- 两项回答问题：已修正双端系统指令；尚未取得修正后的真实模型回答，因此记录为“实现修正完成，真实回归待执行”，不是接受原有错误保证。
- 本地回归、匿名真实访问、advisors、数据库事务版本验证已通过；普通登录用户/staff/admin 的真实登录验证和实时生成回归等待明确授权。
- **正式关闭条件尚未全部满足。** 不以本地模拟、匿名隔离或 UI 验收代替剩余证据。

## 规格覆盖与质量复核

| 要求/验收修复 | 实现与证据 | 结论 |
| --- | --- | --- |
| 已确认的政策源与版本 | `content/policies/` 六份 public、一份 staff；`scripts/policy-content.mjs` 校验元数据/标题/scope/hash | 对齐；7 文档、16 Chunk |
| 增量导入与历史隔离 | `scripts/ingest-policies.mjs` 元数据计划、apply-only 向量读取、变化 Chunk embedding；事务同步 RPC | 对齐；数据库实测见下表，真实变化 embedding 次数仍待 live 测试 |
| RLS 权限 | `policy_rag.sql` 两表 RLS、`app_metadata.role`、`SECURITY INVOKER`；匿名与普通用户无同步 RPC 权限设计 | 代码对齐；匿名实测通过，登录角色实测待执行 |
| 员工授权与工具绑定 | `operations-auth.ts` 校验 bearer/getUser；`operations-tools.ts` 使用同一员工 client | 无 service-role 检索替代；真实 BFF 角色矩阵待执行 |
| 当前问题/重复检索/413 | `concierge-request.ts`、双端 agent refinement/prepareStep、`ConciergePanel.tsx` 限制用户文本传输 | 相关路由、agent、UI 回归通过；结构化日期对话保留 |
| 中文姓名与时间单位 | `operations-request.ts` 与 `policy-query-privacy.ts` 共享上下文脱敏，完整时间短语校验 | 真实 SDK HTTP 序列化边界模拟测试通过；不声称通用姓名识别 |
| 员工豁免证据 | `policy-search-plan.ts` 与 `policy-search.ts` 同一 RLS client 查询 public 规则与 staff 审批证据 | 缺失 SOP 则证据不足；保持阈值和输出预算；live 校准仍需证据 |
| 只解释不创建记录 | `policy-query-controls.ts` 与 Operations `prepareStep` | 检索后禁用工具；模拟模型企图调用备注也不能写入 |
| 引用与前后端契约 | 两端 `PolicyCitations.tsx`、员工严格运行时解析器、原生 summary 聚焦 | Tab/反向 Tab/UI 回归通过；用户人工验收覆盖原生交互 |
| 结构化业务与安全 | 原有库存、早餐实时金额、订单、审批/审计仍走结构化工具 | Feature01–03 回归通过；本轮无业务数据写入 |

审查包含错误处理、引用字段和长度、可信身份来源、PII 边界、工具写入门禁、向量维度、hash/版本冲突与回滚。既有五个迁移文件改名逐一核对 Git blob，内容完全相同，且新文件名与远程迁移历史一致；不是删除既有数据库能力。

## 两项回答问题的处置

共享约束位于 `app/_ai/policies/policy-answer-instructions.ts`，两端 agent 都引用它；没有修改已确认的政策事实、版本或向量。

1. **严格 48 小时边界**：来源是 `less than 48 hours`。中文必须保留“不足/少于 48 小时”，不能改成“48 小时以内”；恰好 48 小时不在该区间。边界的费用结论仍须来自实际检索到的收费档位。
2. **无障碍晚申请的无依据保证**：“建议至少提前 72 小时”仍是建议。未规定拒绝规则既不能推出“会拒绝”，也不能推出“不会自动拒绝”；改为说明政策未明确晚申请如何处理并请酒店团队确认，不承诺接待或安排。

这属于模型行为指令修正，没有增加确定性的生成后语义审查器。已准备双端真实模型回归，检查正确来源、一次检索、中文严格边界与建议语气；未执行前不把提示词变更当成真实回答通过的证据。

## 已取得的最终验证证据

| 检查 | 本次结果 |
| --- | --- |
| 网站 `npm run check` | exit 0；lint/typecheck、33 文件 441 测试、完整构建及 13 页生成通过；隔离输出 `.next/feature04-final-20260915` |
| 网站新增 opt-in 测试类型检查 | `npm run typecheck` exit 0；live 文件不属于默认 Vitest include，没有偷偷调用网络回归 |
| 员工 `npm run check` | exit 0；lint/typecheck、8 文件 70 测试、Vite 默认 dist 构建通过，1818 modules |
| 员工变更 TS/TSX 显式 lint | 默认 lint 仅覆盖 js/jsx，因此对变更源码及两份测试单独执行 eslint；修正既有 import 顺序后 0 warning/error |
| 员工测试 import 修正后回归 | 两份相关文件 54 测试通过 |
| `npm run policies:check` | 7 文档/16 Chunk 通过 |
| 真实 metadata-only dry-run | `insert=0, update=0, unchanged=7, deactivate=0, embed=0, reuse=0`；早先网络读取失败，单独重跑 exit 0 |
| 真实匿名表/RPC 隔离 | server-only 仅确认 staff 源存在：1 文档/4 Chunk；匿名 staff 文档、Chunk、RPC 命中均为 0 |
| 数据库版本事务测试 | `supabase/tests/policy-version-closeout.sql` 执行通过；首次同步、重复同步、单 Chunk 更新、未变化向量复用、旧版不可读/不可检索、版本回退/同版本冲突拒绝、无效向量整次回滚 |
| 事务清理 | ROLLBACK 后 probe 文档数 0；正式 corpus 仍为 7 current 文档/16 Chunk，全为 v1 |
| 业务数据快照 | 800 bookings、3 approvals、6 audit rows；这是本轮只读快照，不用单次计数推断此前无任何变更；本轮事务脚本不写业务表 |

数据库事务测试复用现有 768 维向量用于验证数据库行为，**没有调用 Gemini 生成变化向量**。变化 Chunk 的真实 embedding 次数由 opt-in live 测试单独核验；两项证据不可混淆。事务故障夹具首次因复用旧 Chunk ID 触发唯一键错误，已修正 v3 ID 后重跑完整测试通过；没有遗留测试记录。

## Advisors 与非阻断限制

2026-09-15 对当前开发项目 `tupdbxiujsfaifqulgmt` 实际执行 security/performance advisors：

- Feature04 安全告警：0。两张政策表开启 RLS；检索/同步函数均为 invoker。
- Feature04 性能信息：`policy_chunks_fts_idx` 和 `policy_chunks_embedding_hnsw_idx` 尚未使用，级别 INFO。保留设计中的索引；16 Chunk 的小语料尚不能证明大规模索引利用率或延迟。[Supabase unused-index 说明](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
- 既有范围：两个 Feature03 审批函数可由 authenticated 执行 SECURITY DEFINER（WARN）；Auth leaked-password protection 未启用（WARN）；另有 9 项既有 unused-index INFO。未擅自改动审批权限或认证设置。[函数告警说明](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[密码保护说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- 网站既有四项 `next/no-img-element`、Edge jose、sharp、Browserslist 提示及员工 React Router future notices 仍在，未由本次修正引入。
- 中文保守词汇会拒绝未识别表达；例如“提前72小时提出无障碍需求可以吗？”仍不是支持范围的证明。未知身份/未知词项失败关闭，不把它记录为完整自然语言覆盖。
- 历史 synthetic retrieval 指标仍只是本地排名指标；不能将其 96.88% recall 声称为 Gemini/Postgres 实测或真实回答正确率。

## 待授权的最后验证

可审阅脚本：`tests/ai/policy-closeout.live.ts`，命令：

```sh
npx vitest run --config tests/policy-live.config.mjs
```

脚本仅允许当前开发项目，创建 ordinary/staff/admin 三个随机临时账号，使用真实登录 token 检查表/RPC、禁止同步写入与 BFF 401/403/授权边界，最后注销并删除账号；ordinary 的 user_metadata 伪造 admin 也不能获得权限。答复测试仅允许员工政策检索，不访问业务表或调用备注 RPC。另用内存中的公共政策措辞修改验证一次真实 embedding 与一次现有向量复用，不 apply 政策。

运行时的 counts/answer 报告写入忽略目录 `.next/feature04-evidence/live-closeout.json`，不写凭据/身份/向量；清理失败会使测试失败。

自动审批在首次提权运行前拒绝了该脚本，理由为临时账号变更、演示员工政策发送给外部模型和清理失败风险需要更明确授权。**目前没有通过此脚本创建账号或执行模型调用。** 已向用户请求授权；回答未到前不得绕过限制，也不得标记正式关闭。最终关闭还需检查该 live 结果、账号清理记录，并更新这里的状态。
