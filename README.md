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

## 部署

### 前端（Vercel，推荐）

纯静态 SPA，零后端依赖即可上线（`ACTIVE_MODE` 默认 `mock`，离线可演示）：

1. 在 Vercel 导入本仓库（GitHub：`lzytttttt/EDUStudio`）。
2. Framework 选 **Vite**（自动识别），Build Command `npm run build`，Output Directory `dist`。
3. 也可在仓库根目录执行 `vercel` 一键部署；`vercel.json` 已内置构建参数与 SPA 回退重写。

> `npm run build` 前置执行 Vitest 单测 + `tsc` 类型检查，任一不过则构建失败，天然构成上线质量闸门。

### 轻后端代理（Docker，可选）

key 托管 / 限额 / 审计 / 分享短链 / 任务链 / 错误上报 可一条命令拉起：

```bash
DEEPSEEK_KEY=sk-xxx docker compose up -d        # PowerShell：$env:DEEPSEEK_KEY='sk-xxx'; docker compose up -d
```

前端设置页 → 模式选「代理」，地址填 `http://<主机>:8787/v1`；审计日志与分享/任务链数据持久化在 `edustudio-data` 卷。

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

v0.5 起数据经 `harness/sources/`（SourceProvider）统一取数：**CSV 导入 > 远端数据平台 > 静态 seed**
三级优先，远端失败自动降级并在 UI 标注「演示数据」；简报/看板/Agent 工具均标注数据来源与新鲜度（超 7 天提示刷新）。
教师可在简报页导入班级成绩 CSV（宽表/长表通吃，列名模糊匹配 + 预览确认），简报首卡即基于真实数据生成。

## 技术栈

Vite 5 · React 18 · TypeScript 5 · Tailwind CSS 3 · Zustand · lucide-react / react-icons · recharts · Vitest
（无路由库：阶段状态机 login → briefing → workbench；Markdown 渲染器自研零依赖）

## 响应式

桌面三栏；<1280px 右栏折叠为抽屉；<768px 单栏 + 底部三标签导航（列表/会话/文档）+ 简报滑卡完整触控体验（惯性回弹）。
v0.3 起支持阅读区字号四档调节（超大档面向高龄用户：20px 阅读字号并自动隐藏次要信息）、iOS 安全区避让与输入防缩放。

## 质量保障

`npm test` 运行 Vitest 单测（82 例，覆盖 SSE 解析 / 增量归一化 / Markdown 渲染 / 工具注册 / 剧本与模板匹配 / 存储往返 / 偏好注入 / 导出工具 / CSV 成绩解析 / 数据源降级 / 上下文压缩）；
`npm run build` 前置执行单测 + tsc 类型检查，双闸门保障交付质量；Playwright 3 条关键路径 E2E + 4 张基线视觉回归（阈值 5%，首月观察期）+ 包体预算门禁 + Lighthouse CI（性能 ≥ 0.85）。

---

v0.5 · 真实数据接入与协同深化（SourceProvider 数据源 / CSV 成绩导入 / 分享短链与批注回流 / 任务链跨端同步 / 通知中心 / 课标与跨文档 Agent 工具 / 上下文压缩与 token 预算 / 视觉回归与 Lighthouse / Docker 部署 / Key 生命周期与导出水印）
v0.4 · 分享协作 + 任务流看板 + e2e 测试 + 数据提供/密钥盒 · 架构模式参考 EduOS-95（仅借鉴模式，未复用代码）

## 许可协议

本项目采用 [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](./LICENSE) 协议发布。

- **署名（BY）**：使用时须注明出处。
- **非商业性使用（NC）**：不得用于商业目的。

详见 [LICENSE](./LICENSE) 文件。
