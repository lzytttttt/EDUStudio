# EDUStudio · 教育 Agent 工作台

面向 K12 教育从业者（教育局 / 学校管理 / 教师）的轻量 AI Agent 工作台。
定位：通用 Agent Harness（Codex/CodeBuddy 类）对教育从业者太臃肿、成本高；EDUStudio 以
**解耦 Harness + Mock 兜底 + DeepSeek 级低成本模型** 的模式，构建开箱即用、离线可演示的教育工作台。

## 快速开始

```bash
npm install
npm run dev      # 开发（端口被占用时 Vite 自动顺延）
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览生产构建
```

## 三屏流程

1. **登录页** — 选择身份（教育局 / 学校管理 / 教师），角色决定 system prompt、简报剧本与工具集
2. **今日简报** — 卡片流首页：洞察 / 决策 / 创作 / 待办 / 数据 / 提问六类卡片，
   支持 ← 跳过、↑ 收藏、→ 采纳（键盘 / 触摸 / 拖拽）；采纳的卡片自动注入工作台执行
3. **工作台** — 三栏布局：左侧任务 / 收藏 / 文档，中间对话流 + Agent 执行轨迹
   （Plan → Tool Call → Result → Reflect → Done），右侧 Artifact 预览与编辑（自研 Markdown 渲染）

## 架构：解耦 Harness 层

```
src/harness/
├── types.ts             # 核心契约（LLMProvider / AgentProvider / BriefingCard / RolePreset…）
├── providerRegistry.ts  # 统一注册中心，ACTIVE_MODE = 'mock' | 'api' 一键切换
├── llm/                 # MockLLMProvider（流式打字机）+ DeepSeekAdapter 骨架
├── agent/               # ToolRegistry + MockOrchestrator（Plan→Act→Reflect 剧本驱动）+ API 骨架
├── briefing/            # 今日简报卡片 Provider
├── artifacts/           # 文档生成 Provider（教案 / 报告 / 通知模板）
├── roles/               # 三角色预设（system prompt + 工具集）
└── scripts/             # 预制剧本：简报卡组 / Agent 步骤 / 文档模板（含降级剧本）
```

- **业务代码只依赖 `harness/types` 契约**，Mock ↔ API 切换零业务改动
- 接入真实模型：实现 `DeepSeekAdapter.streamChat`（OpenAI 兼容 SSE）与 `Orchestrator`
  （function-calling 优先，Plan-JSON 降级），再把 `providerRegistry.ts` 的 `ACTIVE_MODE` 改为 `'api'`
- 任何输入都有响应：剧本未命中时走角色化降级剧本，演示零翻车

## 数据分层与持久化

Raw（`src/data/seed.ts` 种子数据）→ Aggregated（工具聚合）→ Agent Output（trace / 文档）→ Presentation（渲染）。
会话、收藏、文档、版本历史、偏好画像、登录态均存 LocalStorage（`edustudio:` 前缀），设置弹层可一键清空。

## 技术栈

Vite 5 · React 18 · TypeScript 5 · Tailwind CSS 3 · Zustand · lucide-react / react-icons · recharts · Vitest
（无路由库：阶段状态机 login → briefing → workbench；Markdown 渲染器自研零依赖）

## 响应式

桌面三栏；<1280px 右栏折叠为抽屉；<768px 单栏 + 顶栏抽屉导航，简报滑卡保持完整触控体验。
v0.3 起支持阅读区字号三档调节、iOS 安全区避让与输入防缩放。

## 质量保障

`npm test` 运行 Vitest 单测（39 例，覆盖 SSE 解析 / 增量归一化 / Markdown 渲染 / 工具注册 / 剧本与模板匹配 / 存储往返 / 偏好注入 / 导出工具）；
`npm run build` 前置执行单测 + tsc 类型检查，双闸门保障交付质量。

---

v0.3 · 角色深化（出题工作台 / 校情驾驶舱 / 区域看板）+ 文档增强（导出 / 版本历史 / 模板库）+ 偏好个性化 + UI/交互优化 · 架构模式参考 EduOS-95（仅借鉴模式，未复用代码）

## 许可协议

本项目采用 [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](./LICENSE) 协议发布。

- **署名（BY）**：使用时须注明出处。
- **非商业性使用（NC）**：不得用于商业目的。

详见 [LICENSE](./LICENSE) 文件。
