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
| [v0.8-03-briefing-entry-intro.md](./v0.8-03-briefing-entry-intro.md) | 增量 | v0.8.3 小型优化：简报首次进入卡牌生成切入动画（无文字，设计风格对齐） |
| [v0.9-roadmap.md](./v0.9-roadmap.md) | — | v0.9 路线图总览：Agent 主路径修复、数据安全网、决策责任边界提示、导航与诊断打磨 |

## 文档规范

- 统一模板：背景与目标 → 现状与改动文件 → 技术方案 → 任务拆解 → 验收标准 → 风险与对策
- 任务拆解标注优先级（P0/P1/P2）与依赖关系；验收标准可测试、可演示
- 保持轻量定位：方案不引入重依赖，标注对生产包体（当前 gzip 84KB JS）的增量预算

## 版本约定

- v0.1（已交付）：Mock 全流程工作台（登录 → 今日简报 → 三栏工作台）
- v0.2（已交付）：DeepSeek 真实接入 + 轻后端代理（M1）；角色深化 + Artifact 增强（M2）与个性化 + 质量护栏（M3）顺延至 v0.3
- v0.3（已交付）：角色深化 + Artifact 增强（M1），记忆与个性化 + 质量保障（M2），UI/交互优化（追加专项：字号调节 / 操作说明 / 移动端）
- v0.4（已交付）：Agent 多轮循环、协作分享、E2E/CI、性能治理，见 [v0.4-roadmap.md](./v0.4-roadmap.md)
- v0.5（已交付）：真实数据接入 + 协同深化，见 [v0.5-roadmap.md](./v0.5-roadmap.md)
- v0.6（已交付）：自进化技能系统；v0.6.1 小型优化（登录改版 / 字号缩放 / 移动端）
- v0.7（已交付）：智能简报（生成增强 / 卡片交互 / 落章动效 / 专注模式）
- v0.8（已交付）：API 模式数据驱动闭环 + LLM 技能提炼落地；v0.8.1 小型优化（专注模式移动端操作 / 工作台多文档跳转），见 [v0.8-01-focus-mobile-doc-nav.md](./v0.8-01-focus-mobile-doc-nav.md)；v0.8.2 小型优化（简报保留卡物理动效 / 拖回重新批阅），见 [v0.8-02-briefing-kept-cards-physics.md](./v0.8-02-briefing-kept-cards-physics.md)；v0.8.3 小型优化（简报首次进入卡牌生成切入动画），见 [v0.8-03-briefing-entry-intro.md](./v0.8-03-briefing-entry-intro.md)
- v0.9（规划中）：信任与健壮性专项（function-calling 接线 / 数据备份安全网 / 决策责任边界提示 / 导航与诊断打磨），见 [v0.9-roadmap.md](./v0.9-roadmap.md)
