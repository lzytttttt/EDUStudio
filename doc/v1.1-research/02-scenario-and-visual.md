# v1.1 研究 02 · 第二剧本（单元考闭环）+ 视觉再打磨

> 范围：在 v1.0 Mock 原型上加第二条 mission（不动旧三屏），并对三屏做视觉/可访问性收口。本文只做设计，不含实现。
> 核验：2026-11-12 读 `src/harness/director/*`、`stores/directorStore.ts`、`apps/director/*`、`e2e/*`、`.tmp-v1/*.png`。数字与 `src/data/seed.ts` 一致；`data.ts:4-8` 已校正 82.4 为物理均分/+2.1，t8 的 +1.8 不再出现。
> 工作量：剧本约 2 人日、视觉约 5 人日，P0 约 3.5 人日。

## 1. 第二剧本：单元考闭环 exam_loop

### 1.1 触发：关键词路由，不加可见场景切换

| 输入关键词 | 路由 kind | 依据 |
| --- | --- | --- |
| 单元考／诊断／分层／练习／习题课／薄弱点 | `exam_loop` | 与 `doc/v1.0-01-team-protocol.md` §7.1 模板 A 同名 |
| 家长会／发言稿／讲稿／PPT／家长信／安抚 | `parent_meeting` | 现有剧本 |
| 其余／空 | `parent_meeting` | 保持 v1 默认，现有 E2E 不回归 |

- 落点：`InboxSurface.tsx:436-440` 的 `dispatch` 现固定 toast「已理解 · 拆成 5 个环节」+`openMission()`；改为 `routeMissionKind(draft)`+`startMission(kind)`，文案取模板（单元考为「已理解 · 拆成 4 个环节」）。路由纯函数放 `data.ts`（便于单测），优先级 exam>parent>默认。
- **不加可见场景切换（取舍）**：三屏「少字」+ `01-inbox.png` 示例 chips 已是隐式入口；加 toggle 破坏「事找人」叙事。为演示确定性只加 **URL 参数** `?mission=exam_loop`（无 UI 文案，供 E2E/现场兜底）；同时把 `InboxSurface.tsx:39` 的「单元考家长信」改为「单元考诊断」，避免示例与路由语义打架。
- 风险：现场一句话判错 → 关键词表驱动单测锁定 + `?mission=` 兜底 + 演示句固定。

### 1.2 模板化：`MissionKind` + `MISSION_TEMPLATES`

新增：`MissionKind` 两值；`MissionGate` 扩 `worksheet|lesson`（`ty:80`）；`plan.gate?`（`ty:73`）；`State.kind`（`ty:82`）；`MissionTemplate{kind,title,plan,script,artifacts,gates,meta}`；`MISSION_TEMPLATES` 收口 `data.ts:157/190/205`；`GATE_META`/`GATE_OWNER` 收口 `M:60`/`T:35`。

| 现有硬编码 | 位置 | 改法 |
| --- | --- | --- |
| `MISSION_PLAN` | `data.ts:157` | 移入 `parent_meeting.plan`；派生导出兼容 `M:31,554` |
| `MISSION_SCRIPT` | `data.ts:190` | 移入模板 `script`；`S:164-169 runFrom` 按 `mission.kind` 取 |
| `ARTIFACTS` | `data.ts:205` | 移入模板 `artifacts`；`ArtifactSheet.tsx:10` 按 kind 查（未开战用默认） |
| 初始 title/plan | `S:79,82` | 初始仍 parent_meeting，title/plan 取模板 |
| `finishMission` 写死 | `S:116-135`（+6、+1.6h、「2 个决定」） | 取模板 meta（deliverables/gateCount/savedHours） |
| `confirmPlan` 不分 kind | `S:241-262` | 按 kind 取模板，流程不变 |
| `approveGate` | `S:264-273` | 通用：只续 cursor，按模板脚本走，无需改 |
| `rejectGate` 二选一 | `S:280` | 查 `GATE_OWNER` |
| gate 关卡 id 写死 | `M:47`（t2/t3） | `plan.filter(t.gate)`，盾牌同源 |
| gate 卡文案 | `M:60-79` | 注册表补 worksheet/lesson 两门 |
| done 页统计 | `M:490-495`（6/2/9 写死） | 模板 meta |
| 成员归属 | `T:35-38` | 用统一 `GATE_OWNER` |
| `dispatch` | `InboxSurface.tsx:436-440` | 路由 + `startMission(kind)` |
| d-drill 联动 | `S:183-200` | `DECISION_TO_MISSION={'d-drill':'exam_loop'}`（见 1.4） |

### 1.3 剧本内容（4 环节 / 3 成员 / 2 次拍板）

**教师一句话**：「用高一（3）班这次单元考做个诊断，出一套分层练习，再备一节习题课。」

| # | 成员 | 环节 | 门 | 演示 |
| --- | --- | --- | --- | --- |
| t1 | analyst | 核对单元考数据 | — | 700ms |
| t2 | assessor | 分层练习单（基础 70%／提高 30%） | ✋ worksheet | 800ms |
| t3 | curriculum | 习题课教案（45 分钟 5 环节） | ✋ lesson | 700ms |
| t4 | chief | 三道路径校验 + 作战包 | — | 500ms |

**动态流（约 6–8 秒，含一次数字口径校验）**：核对单元考数据 → **标出 1 处口径：82.4 是物理均分，不是班级均分** → 分层练习起草完成（12 题）→ 分层练习待你过目（门）→ 习题课教案完成（5 环节）→ 教案待你过目（门）→ 三道路径校验完成 → 作战包已生成 → 作战包已交付。

**交付物（4 件，全部落 seed 锚点）**

| id | 标题（owner） | 必含口径 |
| --- | --- | --- |
| a-brief | 学情简报（analyst） | 物理 82.4（+2.1）/数学 78.6（-1.4）/化学 80.2（+0.8）、93%、86、函数单调性 61%{{cite}}；注「82.4 是物理均分，80.4 为三科派生值」 |
| a-drill | 分层练习单（assessor） | 12 题、基础 70%／提高 30%、约 25 分钟；每题标知识点/难度/答案；依据 61% |
| a-lesson | 习题课教案（curriculum） | 45 分钟 5 环节：导入 5／诊断精讲 12／分层练习 15／讲评 8／小结 5 |
| a-pack | 作战包摘要（chief） | 4 件交付、只做 2 个决定、数字来源、待办 2 条 |

- **审批门**：worksheet「分层练习待过目」、lesson「习题课教案待过目」，均「放行」；退回只重跑对应环节。
- **演示压缩**：真实约 15 分钟 → 演示 6–8 秒。**教师改动 3 处**：分层比例 70/30→60/40；删除 1 道偏难题；教案导入换本班实验情境。
- **类型扩展**：`ArtifactTile.kind`（`ty:97`）加「练习/教案/摘要」；`ARTIFACT_ICON`（`M:53`）补 3 图标。

### 1.4 与决策卡 d-drill 的联动（推荐不跳屏）

- **方案 A（推荐，约 6 行）**：`acceptDecision`（`S:183`）命中 `DECISION_TO_MISSION` 且 `mission.status ∈ {idle,planning}` → 用模板覆写 `mission.kind/title/plan/status='planning'`，toast「已采纳 · 单元考闭环计划待确认」；**不自动切屏**，任务条出现入口。现有 E2E「采纳后留战情台」不破。
- 方案 B（不推荐）：采纳即 `openMission()` 跳计划页——省一次点击，但打断「先看再做」，引导/截图时序需重测。
- 边界：mission 已 running/waiting 时不覆盖，仅 toast「已加入待办」。

### 1.5 测试

| 层 | 断言 |
| --- | --- |
| 路由 | 表驱动：单元考/诊断/分层/习题课→exam；家长会/PPT/信件→parent；空/未知→parent；混合句 exam 优先 |
| 模板注册表 | 每模板 plan 4–6、gate=2、plan.gate⊆GATE_META、script 引用 id 存在、demoSeconds=after 和 |
| store | `startMission('exam_loop')`→title/plan；confirmPlan→worksheet 门→放行→lesson 门→放行→done；artifacts=4；`rejectGate('worksheet')`→assessor 重写；parent_meeting 旧断言（`directorStore.test.ts:52-91`）不变 |
| E2E | 新用例：输单元考句→计划 4 环节/2 拍板→开战→两门→作战包 4 卡；断言含「物理均分 82.4」、不含「家长会」 |

### 1.6 文件级改动与人日

| 文件 | 改动 | 人日 |
| --- | --- | --- |
| `harness/director/types.ts` | kind/template/gate 类型 | 0.2 |
| `harness/director/data.ts` | 模板化 + exam_loop 数据 + 路由 + 注册表 | 0.6 |
| `stores/directorStore.ts` | 按 kind 运行 + d-drill 联动 + finish meta | 0.4 |
| `apps/director/MissionSurface.tsx` | 门/统计/回退按模板 | 0.3 |
| `apps/director/InboxSurface.tsx` | 路由/文案/示例词 | 0.1 |
| `TeamSurface.tsx`、`ArtifactSheet.tsx` | 门归属/交付物查找 | 0.1 |
| 单测 + E2E | 上述断言 | 0.5 |
| 合计 |  | **2.2（1.5–2.5）** |

## 2. 视觉再打磨

### 2.1 逐屏审计（1440×900／390×844）

> 截图：`.tmp-v1/01…12`。缩写：I/M/T/D/S/G=Inbox/Mission/TeamSurface、DirectorApp、directorStore、GuideBar；Sh=shared、ty=types。每条「现状（file:line+截图）→改法→验收」。

| # | 屏/尺寸 | 现状 | 改法 | 验收 |
| --- | --- | --- | --- | --- |
| V1 | 作战·1440 | 04 两条 toast 叠在标题上；`DirectorApp.tsx:133` toast `top-16`，`MissionSurface.tsx:266` 头部贴顶 | toast 下移至 `top-[4.75rem]`、最多 2 条同类合并；作战室首屏留 56px 顶距 | 1440/390 不遮 H1；同屏 ≤2 条 |
| V2 | 作战·1440 | 05 审批卡 560 居中、与 900 grid 不对齐（`M:332`）；「改一改」「退回」同走 onReject（`M:394-405`）；gate toast 与卡标题重复（`S:151`） | 卡宽对齐右列（640）；删「退回」只留「改一改」；gate 不出 toast | 边缘对齐；同屏一个返工入口、一处提示 |
| V3 | 作战·1440 | 04 内容止于 ~y430、下半屏空（`M:266`）；06「6 件」vs 4 卡（`M:490-495`）、toast 重复「2 个决定」（`S:134`+`M:488`）、卡高 140（`M:421-463`） | live 区 min-h 撑满居中；统计取模板 meta；toast 改「已交付 · 可导出」；lg 下 3 列 | 底部空白 ≤25%；数字=可点卡数；卡内 ≥2 行 |
| V4 | 作战·1440 | 03 计划卡 620 居中，上下各 ~220px 空（`M:178`） | 卡宽 720、置于视口垂直中线 | 卡中线=视口中线 ±10% |
| V5 | 战情·1440 | 01 内容止于 ~y660、底空 200px（`InboxSurface.tsx:444`）；planning 时 0% 空进度（`I:359-367`） | ≥lg 用 `justify-between`，晚间战报贴底；planning 隐进度条改「待确认」三点 | 内容底距 dock ≤120px；无空进度条 |
| V6 | 战情/战队·390 | 11/12 dock 压第 4 卡；`DirectorApp.tsx:97` 无安全区 | dock `bottom-[max(12px,env(safe-area-inset-bottom))]`；滚动区 pb=dock+安全区+24 | 滚到底最后卡完整；不压 home indicator |
| V7 | 战队·1440 | 08 内容止于 ~y640；周报左「本周」右三数（`T:75-88`） | 页面垂直居中；周报三格等分 | 底部空白 ≤25%；三格等分 |
| V8 | 引导 | 10 光圈整格包三卡（`data.ts:266`+`I:488`）；step3 目标 idle 时 null（`I:310`）；自动 4.2s 无暂停（`GuideBar.tsx:13,39`）；点卡片仍倒计时 | 目标改首张未处理卡（新增 `data-guide="decision-first"`，文案「先看这一张」）；空目标自动跳步；hover/focus 暂停、6s；点击高亮目标即推进 | 光圈宽≈单卡；任一步无空指；悬停 3s 不跳 |
| V9 | 全局·390 | dock 用 `◈▶◎`（`D:22-26`），与 lucide 不一致、跨平台字形不同 | 换 lucide Inbox/Play/Users 18px + `aria-hidden` | 三平台字形一致 |
| V10 | 战情·390 | 11 一屏见 1.5 卡（~240px）；9–11px 小字密集（`I:448`、`Sh:198`） | 移动卡 p-4、收敛预览行；字号收口见 2.2 | 一屏见 2 张卡头；无 9px 字 |

### 2.2 最小 design token（只收口，不重设计）

| 类 | 值 | 现状问题 |
| --- | --- | --- |
| 间距 | 4/8/12/16/20/24/32/40；卡内 20（移动 16） | 3/3.5/5 混用（`I:444,464`）→ 4 的倍数 |
| 圆角 | 卡 24、sheet 28、pill 999、输入 24 | 22/24/26/28 混用（`I:516`、`Sh:346`） |
| 字号 | 11 最小／12 标签／14 正文／16 标题／22 H1／24 大数字 | 现 9/10px（`Sh:198,387`）→ 删 9px，10px→11/12 |
| 图标 | 行内 14／按钮 16–18／dock 18 | 11–17 混用（`Sh:249,280`）→ 三类 |
| 动效 | 160/240/420ms；`cubic-bezier(.22,1,.36,1)`；呼吸 2.4s；错峰 ≤6 档×60ms | 现 0.45–0.6s 多档（`director.css:19-23,71-86`）→ 三档 |
| 触控 | dock ≥44、icon ≥40、radio/主按钮 ≥44 | 现 icon 36（`Sh:275`）→ 40/44 |
| 对比度 | 文本变体 amber-ink `#7a5a0f`、coral-ink `#c2413b`、mint-ink `#1f7a6e`（5.92/4.64/5.16）；`ink-mute` 仅 ≥18px | 现 amber 4.00、coral 2.52、白字 coral 2.78、ink-mute 2.36（见 2.4） |

### 2.3 引导升级

- **首访 vs 常态**：保留首访一次自动（`D:40-48`+localStorage）；之后仅「?」入口+每屏首进轻提示，不再自动。
- **目标细化**：`GUIDE_STEPS`（`data.ts:265-270`）由整格改首卡（`data-guide="decision-first"` 挂第一张未处理卡，`I:492-500` 按 index 传），文案改「先看这一张」。
- **切屏过渡**：保留先 setScreen 后定位（`G:27-37`），改等 `d-fade`（约 450ms）结束再 ring，防跳位。
- **跳过后重看**：现有「?」→`startGuide(true)`（`D:72`）保留；强制重看不写 seen 标记（`S:314-331`）。
- **真实操作衔接**：点击高亮目标即暂停并推进；打开 Sheet 暂停，关闭续跑。

### 2.4 可访问性

| 项 | 现状 | 改法 | 验收 |
| --- | --- | --- | --- |
| aria/title | IconButton 已有 aria-label+title（`Sh:271-274`）；dock 字形与角标无读屏（`D:116-122`） | 字形 `aria-hidden`；角标加 sr-only「N 件待决策」 | 读屏只念「战情/作战/战队」 |
| 焦点 | 多数按钮有 focus-visible ring；dock 无（`D:104-115`）；Sheet 无 trap/初始/恢复（`Sh:313-359`） | 统一 ring-2/45+offset；Sheet 聚焦关闭钮、Tab 循环、关闭还原 | 纯键盘走通三屏 + 两 Sheet |
| aria-live | 动态流已 `aria-live`（`M:314`）；toast 无（`D:133`）；gate 出现无播报 | toast `role=status aria-live=polite`；gate 出现 polite 播报「1 件待拍板」 | 读屏能听到结果与门 |
| 对比度 | amber 4.00（`Sh:63`）、coral 文字 2.52、白字 coral 按钮 2.78、ink-mute 2.36（10px 标签） | 用 2.2 文本变体；coral 仅作图标/圆点；ink-mute 限大号 | 正文 ≥4.5、大字 ≥3 |
| reduced-motion | `director.css:155-167` 已关主要动效，`index.css` 关 drift；仍缺 dock 点/progress | 补 `.d-dot::after` 与 progress transition；e2e `emulateMedia` | 动效全关后截图稳定 |
| 触控/键盘 | dock tab ~44、radio h-11（`T:274`）；icon 36 | 移动 icon 40、dock 44；radio 支持 ←/→ | 命中≥40；方向键可切 |
| 长文本 | FeedRow 截断无 title（`M:130`）；标题 truncate | `title={item.text}`；截断处补 title | hover/长按可读全文 |

### 2.5 v1 三屏视觉基线

- 新增 `e2e/director-visual.spec.ts`（不并旧 `visual.spec.ts`，避免旧基线冲突出）；页面 `/?v1=1&tour=0`，`clock.install(2026-11-10T09:42)`、reducedMotion、清 `edustudio:*`。
- 三张：`director-inbox.png`、`director-mission-plan.png`（填「家长会材料」→交战队）、`director-team.png`（点 dock 战队）。
- mask 动态内容：给问候/日期/省时/toast 层加 `data-testid`（`director-greeting/date/saved`、顶层 `director-toasts`）后 `toHaveScreenshot(...,{mask:[...]})`；等 3s 让 toast 消失作兜底。
- 阈值：全局 5%（`playwright.config.ts:31`），director 用例收紧 `maxDiffPixelRatio:0.02`；平台后缀基线（win32 本地、CI Linux 工件回填，沿 `visual.spec.ts:6-15`）。
- 生成：`npx playwright test e2e/director-visual.spec.ts --update-snapshots`，提交 `*-chromium-win32.png`。

### 2.6 工作量排序

| 级 | 项 | 人日 |
| --- | --- | --- |
| P0（演示前必须） | V1 toast 重叠、V2 审批卡三项、V3 done 口径、V8 引导首卡、V6 移动安全区、2.4 对比度、toast/gate a11y、三屏基线 | 2.5 |
| P1 | 留白/居中（V3-7）、done 卡密度、V9 图标、V8 引导时序、焦点、feed title | 1.5 |
| P2 | V7 周报分布、V10 移动卡密度、移动端基线、9px 字号全量替换、Sheet 键盘方向键 | 1.0 |
| 合计 |  | **5（4–5）** |

## 3. 范围护栏

- 不改：旧三屏（登录/简报/工作台）、Loom、chat/artifact 业务逻辑；视觉项只动 className/CSS/aria/testid，不改 store 语义。
- 不引：动画库、暗色主题、3D/插图重绘、新字体包、新高饱和品牌色（只加深同色相文本变体）。
- 不改 seed 数字；`data.ts:4-8` 的 82.4 校正为唯一口径，文案不得再出现「班级均分 82.4」「+1.8」。
- 不加新页面/路由；场景切换无 UI 文案，`?mission=` 仅演示/E2E。
- 包体：director 仍独立 lazy chunk（`App.tsx:12-13`），新增模板估 +2–4KB gzip；总预算 330KB（`budget.mjs`）以内，改后跑 `check:budget`。

## 4. 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 字体 diff | 基线误报 | win32/linux 双基线；阈值 2%+mask；首月允许失败同旧规 |
| 动画/时序抖动 | 截图与 E2E 不稳 | `animations:'disabled'`+reducedMotion+固定 clock；引导用例 `tour` 显式；toast 层 mask |
| 移动安全区 | dock 压 home indicator | `env(safe-area-inset-bottom)`（`index.html:5` 已具备）+ 滚动区 pb 补偿 |
| 演示性能 | blur/backdrop + 12 组定时器 | 惰性 chunk 不变、新增模板零依赖；移动端关 `d-sheen`/orb blur（P2） |
| 路由误判 | 现场进错剧本 | 关键词单测 + `?mission=` 兜底 + 演示句固定 |
| 视觉改动触及逻辑 | 剧情回归 | 视觉项不改 store；剧本科目改动单独提交边界 |
