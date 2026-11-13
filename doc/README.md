# EDUStudio 文档中心

本目录存放 EDUStudio 的迭代计划与技术方案文档。文档与代码现状严格对齐，
引用的文件路径与契约名均可在 `src/` 中找到对应实现。

## 文档索引

| 文档 | 优先级 | 内容 |
| --- | --- | --- |
| [v0.2-roadmap.md](./v0.2-roadmap.md) | — | v0.2 路线图总览：里程碑、优先级、依赖图、包体预算 |
| [v0.2-01-deepseek-adapter.md](./v0.2-01-deepseek-adapter.md) | P0 | DeepSeek 真实接入：SSE 解析、function-calling 编排、运行时切换 |
| [v0.2-02-proxy.md](./v0.2-02-proxy.md) | P0 | 轻后端代理：Workers / Express 双方案、限额与审计 |
| [v0.3-roadmap.md](./v0.3-roadmap.md) | — | v0.3 路线图总览：角色深化、Artifact 增强、个性化、质量保障 |
| [v0.3-01-role-deepening.md](./v0.3-01-role-deepening.md) | P1 | 角色深化：试题编辑器、预警看板、区域指标看板 |
| [v0.3-02-artifact-enhancement.md](./v0.3-02-artifact-enhancement.md) | P1 | Artifact 增强：全格式导出、版本历史、模板库 |
| [v0.3-03-personalization.md](./v0.3-03-personalization.md) | P2 | 记忆与个性化：偏好注入 system prompt、快捷指令自定义 |
| [v0.3-04-quality.md](./v0.3-04-quality.md) | P2 | 质量保障：harness 契约单测 + 关键流程 E2E 进 CI |
| [v0.3-05-ui-ux.md](./v0.3-05-ui-ux.md) | P1 | UI 与交互优化：字号调节、操作说明引导、移动端优化（追加专项） |
| [v0.4-roadmap.md](./v0.4-roadmap.md) | — | v0.4 路线图总览：Agent 多轮循环、协作分享、E2E/CI、性能治理 |
| [v0.5-roadmap.md](./v0.5-roadmap.md) | — | v0.5 路线图总览：真实数据接入、协同闭环、Agent 工具生态、发布工程 |
| [v0.6-roadmap.md](./v0.6-roadmap.md) | — | v0.6 路线图总览：自进化技能系统、可演示剧本、三栏拖拽调宽 |
| [v0.6-06-login-appearance-mobile.md](./v0.6-06-login-appearance-mobile.md) | 增量 | v0.6.1 小型优化：登录页改版、字号全局缩放、移动端体验 |
| [v0.7-briefing-interaction-stamp.md](./v0.7-briefing-interaction-stamp.md) | — | v0.7 智能简报：生成增强、卡片交互、落章动效、专注模式 |
| [v0.8-roadmap.md](./v0.8-roadmap.md) | — | v0.8 路线图总览：API 模式数据驱动闭环、LLM 技能提炼落地 |
| [v0.8-01-focus-mobile-doc-nav.md](./v0.8-01-focus-mobile-doc-nav.md) | 增量 | v0.8.1 小型优化：专注模式移动端操作、工作台多文档跳转 |
| [v0.8-02-briefing-kept-cards-physics.md](./v0.8-02-briefing-kept-cards-physics.md) | 增量 | v0.8.2 小型优化：简报保留卡物理动效（桌面端盖章卡甩飞停留）、拖回重新批阅 |
| [v0.8-03-briefing-entry-intro.md](./v0.8-03-briefing-entry-intro.md) | 增量 | v0.8.3 小型优化：简报卡牌生成切入动画——首进与重新过一遍均播放（无文字，设计风格对齐） |
| [v0.8-04-briefing-regenerate-dialog.md](./v0.8-04-briefing-regenerate-dialog.md) | 增量 | v0.8.4 小型优化：简报自定义重新生成弹窗——提示词 / 种类 / 参考资料 / 高级自定义（数量 / 风格 / payload / 超时重试），Mock 按种类过滤 |
| [v0.9-roadmap.md](./v0.9-roadmap.md) | — | v0.9 路线图总览：Agent 主路径修复、数据安全网、决策责任边界提示、导航与诊断打磨 |
| [v0.9.1-roadmap.md](./v0.9.1-roadmap.md) | — | v0.9.1 路线图总览：AI Native 记忆分层（L2 情景 + L3 语义偏好）+ 产出自评闭环（规则版 Evaluator）+ 反馈收割 |
| [v0.9.2-roadmap.md](./v0.9.2-roadmap.md) | — | v0.9.2 路线图总览：工作台 UI 优化·教育者视角（执行轨迹业务化 / 角色主工作台默认激活 / 任务列表卡片化与相对时间 / 中栏任务仪表盘 / 下发待回执角标） |
| [v0.9.2-01-briefing-one-card-one-task.md](./v0.9.2-01-briefing-one-card-one-task.md) | 增量 | v0.9.2 里程碑：简报「一卡一任务」——采纳的卡片各自成独立任务会话（会话归属 `cardId` / 后台任务绑定 `sessionId` / 任务直达），不升版本号 |
| [v0.9.3-roadmap.md](./v0.9.3-roadmap.md) | — | v0.9.3 路线图总览：演示演出打磨（生成即见的文档流 / 编辑态方向键防误触 / 演示日期与数据新鲜度 / 流式渲染节流与订阅治理 / 向导节奏与首进体验 / 宣传片工程化） |
| [v0.9.4-roadmap.md](./v0.9.4-roadmap.md) | — | v0.9.4 路线图总览：Loom 空间任务台（简报任务平铺 / 拖拽编排 / 可视依赖 / 人机协同） |
| [v0.9.4-01-loom-implementation.md](./v0.9.4-01-loom-implementation.md) | 参考 | v0.9.4 Loom 实施参考材料：代码现状核验、执行架构三项前置决策（sendMessage 复用 / 输出采集口径 / 墓碑防复活）、设计缺口修正、M1~M7 里程碑检查表与交付记录 |
| [v0.9.4-02-loom-ux-polish.md](./v0.9.4-02-loom-ux-polish.md) | 增量 | v0.9.4 增量：空间任务台体验打磨（画布高度可拖拽至中栏 80% / 标题统一「xx画布」/ 大字档位节点可读性 / 画布通知分级堆叠） |
| [v0.9.4-03-loom-llm-hardening.md](./v0.9.4-03-loom-llm-hardening.md) | 增量 | v0.9.4 增量：画布真实接入 LLM 修复（便签不执行 / 文档节点接线 / artifact 入 Trace / 上游穿透与注入 / function-calling 补 plan / 降级可见） |
| [v0.9.4-04-art-assets.md](./v0.9.4-04-art-assets.md) | 增量 | v0.9.4 增量：png-art 美术资源接入（简报卡类型插画 / 角色形象 / 空态插画 / 品牌标与 favicon-PWA 图标；零新依赖，图片不进包体门禁） |
| [v0.9.4-05-art-role-rework.md](./v0.9.4-05-art-role-rework.md) | 增量 | v0.9.4 增量：角色画像与 mascot 重做（纯 token 单色人像消除「脸色不对」/ 纸感书本精灵 mascot / `trim` 限幅放大让主体填满画布；零新增色） |
| [v0.9.5-roadmap.md](./v0.9.5-roadmap.md) | — | v0.9.5 路线图总览：路演可信度专项（报告模板按数据渲染 / 预置演示数据包 / 数字可溯源 / 任务链接入 Agent 工具集 / 零依赖 OOXML 导出） |
| [v1.0-roadmap.md](./v1.0-roadmap.md) | — | v1.0 产品计划：总指挥模式（事找人 + 异步托管）——四表面 / 6 Agent 战队 / 编排协议 / 10 分钟演示 / 里程碑与验收 |
| [v1.0-01-team-protocol.md](./v1.0-01-team-protocol.md) | 参考 | v1.0 实现协议：6 个 AgentSpec、Mission/TeamTask/Handoff 契约、编排状态机、Mock 剧本结构、授权矩阵与演示分镜 |
| [v1.0-research/01-paradigm-and-competitive.md](./v1.0-research/01-paradigm-and-competitive.md) | 研究 | 外部范式与竞品：OpenAI dots / Meta Muse / Manus Cue 拆解、事找人设计法则、教师时间证据（含 20 条来源） |
| [v1.0-research/02-swarm-architecture.md](./v1.0-research/02-swarm-architecture.md) | 研究 | 多 Agent 编排架构：现状 file:line 核验、AgentSpec/Mission/TeamTask/Handoff 草案、MissionRunner 调度、包体与阶段落点 |
| [v1.0-research/03-director-ux-and-demo.md](./v1.0-research/03-director-ux-and-demo.md) | 研究 | Director 交互：四表面信息架构、事找人优先级/打扰预算、授权与信任、10 分钟演示脚本 |
| [v1.0-research/04-agent-roster-and-scenarios.md](./v1.0-research/04-agent-roster-and-scenarios.md) | 研究 | 战队编制：6 Agent 规格与 rubric、单体 vs 战队对比、编排协议、三条端到端剧本（A/B/C） |
| [v1.1-roadmap.md](./v1.1-roadmap.md) | — | **v1.1 路线图（已实施，v1.1.0）**：原型加固——真 LLM 拆解接入 / 状态持久化 / 第二剧本（单元考闭环）/ 视觉再打磨；含 P0 前置修复、里程碑、验收与风险 |
| [v1.1-research/01-llm-and-persistence.md](./v1.1-research/01-llm-and-persistence.md) | 研究 | v1.1 研究：真 LLM 拆解（planner/validate/回退）+ 状态持久化（schema/paused/迁移/备份）+ 数据上下文等 P0 前置修复 |
| [v1.1-research/02-scenario-and-visual.md](./v1.1-research/02-scenario-and-visual.md) | 研究 | v1.1 研究：第二剧本（单元考闭环）模板化设计 + 逐屏视觉审计/P0 清单/视觉基线 |
| [v1.2-roadmap.md](./v1.2-roadmap.md) | — | **v1.2 路线图（实施中：M0 已完成，2026-11-13）**：双核一体——总指挥模式并入主产品。融合设计 F1–F9 / 前端接口契约（Route·StudioBus·DirectorPorts·实体映射·持久化 v2·功能开关）/ 真执行 MissionRunner / 平滑迁移（影子→默认→收口、承诺变更登记、回滚）；M0 实测 811 单测 / 35 E2E / 主 chunk 102.1KB / 全 JS 343.2KB / Director 33.9KB（见 §11.4） |

## 文档规范

- 统一模板：背景与目标 → 现状与改动文件 → 技术方案 → 任务拆解 → 验收标准 → 风险与对策
- 任务拆解标注优先级（P0/P1/P2）与依赖关系；验收标准可测试、可演示
- 保持轻量定位：方案不引入重依赖，标注对生产包体（v1.2 M0 实测主 chunk 102.1KB / 全部 JS 343.2KB gzip，门禁 120 / 348KB；总指挥模式整体独立 lazy chunk DirectorApp 33.9KB（门槛 50KB），简报/分享已拆为 lazy chunk；旧 v1.1 基线 119.5 / 340.04KB、旧 v1.0 预览基线 119.3 / 323.3KB）的增量预算

## 版本约定

- v0.1（已交付）：Mock 全流程工作台（登录 → 今日简报 → 三栏工作台）
- v0.2（已交付）：DeepSeek 真实接入 + 轻后端代理（M1）；角色深化 + Artifact 增强（M2）与个性化 + 质量护栏（M3）顺延至 v0.3
- v0.3（已交付）：角色深化 + Artifact 增强（M1），记忆与个性化 + 质量保障（M2），UI/交互优化（追加专项：字号调节 / 操作说明 / 移动端）
- v0.4（已交付）：Agent 多轮循环、协作分享、E2E/CI、性能治理，见 [v0.4-roadmap.md](./v0.4-roadmap.md)
- v0.5（已交付）：真实数据接入 + 协同深化，见 [v0.5-roadmap.md](./v0.5-roadmap.md)
- v0.6（已交付）：自进化技能系统；v0.6.1 小型优化（登录改版 / 字号缩放 / 移动端）
- v0.7（已交付）：智能简报（生成增强 / 卡片交互 / 落章动效 / 专注模式）
- v0.8（已交付）：API 模式数据驱动闭环 + LLM 技能提炼落地；v0.8.1 小型优化（专注模式移动端操作 / 工作台多文档跳转），见 [v0.8-01-focus-mobile-doc-nav.md](./v0.8-01-focus-mobile-doc-nav.md)；v0.8.2 小型优化（简报保留卡物理动效 / 拖回重新批阅），见 [v0.8-02-briefing-kept-cards-physics.md](./v0.8-02-briefing-kept-cards-physics.md)；v0.8.3 小型优化（简报卡牌生成切入动画：首进与重新过一遍均播放），见 [v0.8-03-briefing-entry-intro.md](./v0.8-03-briefing-entry-intro.md)；v0.8.4 小型优化（简报自定义重新生成弹窗：提示词 / 种类 / 参考资料 / 高级自定义），见 [v0.8-04-briefing-regenerate-dialog.md](./v0.8-04-briefing-regenerate-dialog.md)
- v0.9（已交付）：信任与健壮性专项（function-calling 接线 / 数据备份安全网 / 决策责任边界提示 / Mock 边界标识 / 导航与返回键 / 导入文档化与卡组周派生 / 诊断打磨 / 质量与发布），见 [v0.9-roadmap.md](./v0.9-roadmap.md)
- v0.9.1（已完成）：AI Native 记忆分层 + 产出自评闭环（MemoryProvider：L2 情景 / L3 语义偏好；规则版 Evaluator；反馈收割三写点；单键 edustudio:memory 并入备份白名单），见 [v0.9.1-roadmap.md](./v0.9.1-roadmap.md)
- v0.9.2（已完成）：工作台 UI 优化·教育者视角（ToolDef `display` 契约 + 13 工具人话文案与「显示技术细节」开关、角色默认 tab、侧栏任务卡与相对时间、中栏进度仪表盘、下发待回执角标），见 [v0.9.2-roadmap.md](./v0.9.2-roadmap.md)；追加里程碑「简报一卡一任务」（采纳卡片各自成独立任务会话），见 [v0.9.2-01-briefing-one-card-one-task.md](./v0.9.2-01-briefing-one-card-one-task.md)
- v0.9.3（已完成）：演示演出打磨（生成即见的文档流与文档 tab 角标、编辑态方向键防误触、演示日期与数据新鲜度、流式渲染节流与订阅治理、演示向导节奏与首进体验、宣传片工程化），见 [v0.9.3-roadmap.md](./v0.9.3-roadmap.md)
- v0.9.4（已完成）：Loom 空间任务台（简报任务平铺进画布、拖拽编排与可视依赖、单飞串行拓扑真实执行、Agent Trace 空间投影、人工确认节点；零新依赖，画布整体懒加载），见 [v0.9.4-roadmap.md](./v0.9.4-roadmap.md) 与实施参考 [v0.9.4-01-loom-implementation.md](./v0.9.4-01-loom-implementation.md)；增量 v0.9.4-02 体验打磨（画布高度可拖拽 / 标题统一「xx画布」/ 大字档位可读性 / 通知分级），见 [v0.9.4-02-loom-ux-polish.md](./v0.9.4-02-loom-ux-polish.md)；增量 v0.9.4-03 画布真实接入 LLM 修复（便签不执行 / 文档节点接线 / artifact 入 Trace / 上游穿透与注入 / function-calling 补 plan / 降级可见），见 [v0.9.4-03-loom-llm-hardening.md](./v0.9.4-03-loom-llm-hardening.md)；增量 v0.9.4-04 png-art 美术资源接入（6 张卡片类型插画 / 3 角色形象 / 4 处空态插画（含 mascot）/ 品牌标与 favicon-PWA 图标 / README 横幅；零新依赖，图片不进包体门禁），见 [v0.9.4-04-art-assets.md](./v0.9.4-04-art-assets.md)；增量 v0.9.4-05 角色画像与 mascot 重做（纯 token 单色人像消除「脸色不对」/ 纸感书本精灵 mascot / trim 限幅放大让主体填满画布），见 [v0.9.4-05-art-role-rework.md](./v0.9.4-05-art-role-rework.md)
- v0.9.5（已完成）：路演可信度专项 —— 以「10 分钟路演能否被当场问倒」为唯一标尺，补数据真实性、跨角色闭环与产物可用度三块缺口；验收标准改为可现场演示的动作。P0 报告按 `REGION_METRICS` / `SCHOOL_ALERTS` 逐项渲染（消除冻结快照，模板源码零数据字面量）+ 12 校四片区三学段演示数据与报告聚焦下拉 + 数字 hover 溯源（`{{值~来源}}` 行内规则），P1 `listTaskFlows` / `dispatchTaskFlow` 进 Agent 工具集（仅管理侧）+ 断网降级显式横幅与恢复后自动补推队列 + 预置 3/5 回执的进行中任务链，P2 手写 zip STORE + 最小 OOXML 的真 docx 与新增 xlsx 导出；第 0 步重校包体门禁 297 → 310，主 chunk 阈值 120 不动、靠懒加载守住（report / taskFlow / knowledgeRun 三个新 chunk），见 [v0.9.5-roadmap.md](./v0.9.5-roadmap.md)
- v1.0（预览完成，产品计划待全量实施）：总指挥模式（Director）——事找人 + 异步托管，三屏原型（战情台 / 作战室 / 战队）以 `?v1=1` 直达、独立 lazy chunk 接入，Mock 编排 + 引导 + 授权演示；单测 474 / E2E 28（含 5 条 v1 用例）/ 主 chunk 119.3KB / 全 JS 323.3KB（门禁 330），零新依赖，旧三屏与 `?demo=1` 全保留；产品计划见 [v1.0-roadmap.md](./v1.0-roadmap.md)，实现协议见 [v1.0-01-team-protocol.md](./v1.0-01-team-protocol.md)
- v1.1（已完成，v1.1.0）：原型加固——真 LLM 拆解接入（planner + validatePlan 8 条矩阵 + 事实快照 citations + 模板兜底可见，`?llm=0` 强制模板）、状态持久化（`edustudio:director` v1 / schema 迁移 / 刷新 `running→paused` 续跑 / 决策授权保留 / 备份白名单）、第二剧本「单元考闭环」（MissionTemplate 注册表 + 关键词意图路由 + d-drill 采纳联动 + 4 件可溯源交付物）、视觉再打磨（V1–V10 P0 清单 + 对比度/a11y/引导收口 + 三屏 2% 视觉基线）；含 dataContext 百分比重复 ×100、t8 文案口径等 P0 前置修复。实测 662 单测 / 35 E2E / 主 chunk 119.5KB / 全 JS 340.04KB（门禁 342），零新依赖，见 [v1.1-roadmap.md](./v1.1-roadmap.md) 与配套研究 [v1.1-research/01](./v1.1-research/01-llm-and-persistence.md)、[02](./v1.1-research/02-scenario-and-visual.md)
- v1.2（实施中：M0 已完成，2026-11-13）：双核一体——总指挥模式并入主产品。M0 已交付：三个入口 P0 缺陷修复（`?v1=1` 不粘默认入口 / 不污染旧引导 / 不覆盖校局身份）、`src/studio/` 前端接口契约骨架（contracts / 同步总线 / URL 路由与 Navigator / 功能开关 / 实体映射 / 派生收件箱 / StudioDigest 只读投影 / 并发治理）+ `routeStore`/`inboxStore`、`BriefingPage`/`ShareView` 懒加载腾出主 chunk 预算（119.5 → 102.1KB）、源码层 + 产物层 chunk 边界门禁、Director chunk ≤50KB 新门槛。实测 811 单测 / 35 E2E / 7 视觉 / 全部 JS 343.2KB（门禁 348），零新依赖；M1 起做统一外壳与 `?v2=1` 影子发布。计划与 M0 实测见 [v1.2-roadmap.md](./v1.2-roadmap.md) §11.4
