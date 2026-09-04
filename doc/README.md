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

## 文档规范

- 统一模板：背景与目标 → 现状与改动文件 → 技术方案 → 任务拆解 → 验收标准 → 风险与对策
- 任务拆解标注优先级（P0/P1/P2）与依赖关系；验收标准可测试、可演示
- 保持轻量定位：方案不引入重依赖，标注对生产包体（当前 gzip 84KB JS）的增量预算

## 版本约定

- v0.1（已交付）：Mock 全流程工作台（登录 → 今日简报 → 三栏工作台）
- v0.2（已交付）：DeepSeek 真实接入 + 轻后端代理（M1）；角色深化 + Artifact 增强（M2）与个性化 + 质量护栏（M3）顺延至 v0.3
- v0.3（已交付）：角色深化 + Artifact 增强（M1），记忆与个性化 + 质量保障（M2），UI/交互优化（追加专项：字号调节 / 操作说明 / 移动端）
- v0.4（规划中）：见 [v0.4-roadmap.md](./v0.4-roadmap.md)
