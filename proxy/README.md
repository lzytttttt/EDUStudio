# EDUStudio 轻后端代理

统一保管 key、按客户端限额、最小审计日志。前端在设置页填入代理地址后，请求走代理（key 由代理保管，浏览器不再持有）。

## 两种部署形态

| 形态 | 适用 | 文件 |
| --- | --- | --- |
| Cloudflare Workers | 零运维、公网分发（首选） | `worker.js` + `wrangler.toml` |
| Express（Node ≥ 18） | 内网/自有服务器 | `server.mjs` |

两者行为一致：

- `POST /v1/chat/completions`：OpenAI 兼容透传，SSE 原样流式（无缓冲）
- `GET /health`：健康检查 + 限额/模型白名单自描述
- `GET /api/sources/{classes,region,school}`：数据源演示端点（v0.5 M1③），返回与前端 seed 同构的演示数据 + `fetchedAt`，供远端数据源联调；生产替换为真实数据平台查询即可，前端契约不变
- 路径白名单：仅上述端点，其余 404
- `model` 白名单：`deepseek-chat` / `deepseek-reasoner` / `deepseek-v4-flash` / `deepseek-v4-flash-free` / `deepseek-v4-pro`
- 请求体校验：messages ≤ 100 条、单条 content ≤ 32000 字符
- 限额：10 次/分钟 + 200 次/天（按客户端摘要：优先 `X-EDU-TOKEN`，其次 IP）
- 审计：时间 / 客户端摘要 / 角色（`X-EDU-Client`）/ model / 状态码 / usage tokens；**不记录对话内容明文**
- CORS：`ALLOWED_ORIGINS` 域名白名单（未配置时放行，便于本地联调）
- 可选 `X-EDU-TOKEN`：机构内统一分发 token

## Cloudflare 部署（前端 Worker + 代理 Worker）

前端静态站点走一个 **Worker（Static Assets）**，代理走**另一个独立 Worker**：同账号下各自独立部署与扩缩容，跨域由 `ALLOWED_ORIGINS` 放行。

**部署顺序很重要**：先部署前端拿到域名 → 再回填代理 Worker 的 CORS 白名单 → 最后把代理域名注入前端构建变量。

### 一、Worker（代理）

前置：Cloudflare 账号（免费版额度足够 POC 与试点）、Node ≥ 18、以本目录（`proxy/`）为工作目录。

```bash
# 0. 登录（浏览器授权一次）并确认身份
npx --yes wrangler@4 login
npx --yes wrangler@4 whoami          # 输出账号邮箱即登录成功

# 1. 创建 KV 命名空间（共 3 个，必需性见下表）
npx --yes wrangler@4 kv namespace create EDU_RATE_KV
npx --yes wrangler@4 kv namespace create EDU_AUDIT_KV
npx --yes wrangler@4 kv namespace create EDU_SHARE_KV
```

每条命令会打印 `id = "..."`，把三个 id 依次填入 `wrangler.toml` 的 `[[kv_namespaces]]` 段并**取消注释**（文件内已备好模板）。

| 绑定 | 必需性 | 缺失后果 |
| --- | --- | --- |
| `EDU_SHARE_KV` | **必需** | 分享短链 / 批注回流 / 任务链端点返回 `500 kv_not_configured` |
| `EDU_RATE_KV` | 建议 | 静默降级为**不限流**（不报错，但失去 10 次/分 + 200 次/天保护） |
| `EDU_AUDIT_KV` | 建议 | 静默跳过审计写入与错误上报落盘 |

```bash
# 2. 写入上游 key（加密 Secret，不落配置文件、不进版本库）
npx --yes wrangler@4 secret put DEEPSEEK_KEY     # 粘贴真实 key 后回车

# 3. 本地预检（只打包不上线，用于验证配置）
npm run deploy:check

# 4. 发布
npm run deploy
```

发布成功会输出 `https://edustudio-proxy.<account>.workers.dev` —— 这就是前端要填的代理域名（前端地址需带 `/v1` 后缀）。

发布后自检：

```bash
curl https://edustudio-proxy.<account>.workers.dev/health
# → {"ok":true,"upstream":"https://api.deepseek.com/v1","rate":{...},"models":[...]}
```

### 二、前端（Cloudflare Workers · Static Assets）

仓库根目录的 `wrangler.toml` 已显式声明静态资源托管，无需在控制台填写 Framework / Output Directory：

```toml
name = "edustudio"
compatibility_date = "2026-09-14"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

> **此文件不可删除**：缺省时 `wrangler deploy` 会走自动配置（autoconfig），而它要求 Vite ≥ 6
> （本项目 Vite 5.4.x），会以
> `The version of Vite used in the project ("5.4.21") cannot be automatically configured`
> 中断部署。显式配置后该检查不再触发，也无需升级 Vite。

**方式 A · Workers Builds（Git 集成，推 main 自动发布）**

控制台 → Workers & Pages → 选中该 Worker → Settings → Build：

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build variables | `NODE_VERSION=20`（必须） |

再加前端构建变量（Build → Variables and secrets）：

| 变量 | 值 | 作用 |
| --- | --- | --- |
| `VITE_PROXY_URL` | `https://edustudio-proxy.<account>.workers.dev/v1` | 构建时注入为默认代理地址，用户首次打开即为代理模式，无需在设置页手填 |
| `VITE_SOURCE_URL` | 可选 | 远端数据源地址覆盖；缺省由 `VITE_PROXY_URL` 推导为 `<proxy>/api/sources` |

> `VITE_PROXY_URL` 属于**构建期**变量，必须配在 Build 的 Variables and secrets 中；
> 写进 `wrangler.toml` 的 `[vars]` 是运行时变量，构建阶段读不到。
> 构建变量改动后需重新推送 / Retry deployment 才生效。

**方式 B · 命令行直传**

```bash
# 在仓库根目录执行
npm run build                          # 含单测 + tsc 类型检查 + vite build，不过则不产出
npx --yes wrangler@4 deploy            # 读取根目录 wrangler.toml，上传 dist/ 作为静态资源
```

部署完成后拿到 `https://edustudio.<account>.workers.dev` 域名。

> 已验证的运行时行为：`/` 与未知路径返回 `index.html`（200，SPA 回退），`/assets/*.js`
> 正常返回 `text/javascript`，`public/_headers` 的安全响应头与长缓存生效。
> `public/_redirects` 中的 Pages 专用 catch-all 规则默认已注释 —— 在 Workers 下 wrangler 会将其
> 判定为「Infinite loop detected」并忽略（产生部署告警），SPA 回退统一由 `not_found_handling` 承担；
> 若改用 Cloudflare Pages / Netlify，取消该行注释即可。同一份产物也兼容 Vercel（`vercel.json`）。

### 三、回填 CORS 白名单（必做）

拿到前端域名后（Workers 默认域名形如 `https://edustudio.<account>.workers.dev`），
把它写进 `proxy/wrangler.toml` 的 `[vars]`：

```toml
[vars]
UPSTREAM = "https://api.deepseek.com/v1"
ALLOWED_ORIGINS = "https://edustudio.<account>.workers.dev"
```

改完在 `proxy/` 目录重新 `npm run deploy` 生效。多个来源用逗号分隔（如默认域名 + 自有域名）：

```toml
ALLOWED_ORIGINS = "https://edustudio.<account>.workers.dev,https://edu.example.com"
```

> 未配置 `ALLOWED_ORIGINS` 时代理对任意来源放行（便于本地联调），生产环境务必配置。
> `EDU_TOKEN`（可选）：机构内统一分发的静态 token，配置后前端需带 `X-EDU-TOKEN`，留空即关闭鉴权。

### 四、验收清单（Cloudflare 路径）

- [ ] `curl <proxy-worker>/health` 返回 `ok:true` 且 `models` 列表正确
- [ ] 浏览器打开前端站点 → 设置页「代理地址」已自动填好（未手动填写即为注入成功）
- [ ] 发起一次真实对话：逐 token 流式渲染，无整段延迟
- [ ] 浏览器 DevTools 网络面板：请求头**不含** `Authorization`，key 未进前端
- [ ] 连续快速调用 > 10 次/分钟 → 返回 429，前端 toast 提示且输入保留
- [ ] 从非白名单域名发起请求 → 403 `origin_not_allowed`
- [ ] KV 中可查到 `audit:YYYY-MM-DD` 审计记录（含角色 / model / 状态码 / usage，无对话明文）

## 旧版「只跑 Worker」快速路径

仅需代理、前端已部署在别处（Vercel 等）时，按上面第一章执行，并把 `ALLOWED_ORIGINS` 填成该前端域名即可。

## Express 部署

```bash
npm install express
# Linux/macOS
DEEPSEEK_KEY=sk-xxx node proxy/server.mjs
# Windows PowerShell
$env:DEEPSEEK_KEY='sk-xxx'; node proxy/server.mjs
```

环境变量：`PORT`（默认 8787）、`UPSTREAM`（默认 `https://api.deepseek.com/v1`）、
`RATE_LIMIT_PER_MINUTE`（默认 10）、`RATE_LIMIT_PER_DAY`（默认 200）、
`ALLOWED_ORIGINS`、`EDU_TOKEN`、`AUDIT_DIR`（默认 `./proxy-logs`）。

## 前端接入

**方式一 · 构建时注入（推荐，用户零配置）**：设置 `VITE_PROXY_URL=https://<proxy-host>/v1`（见根目录 `.env.example`），
前端首次打开即为代理模式，`proxyUrl` 已预填；用户在设置页仍可随时改回直连。

**方式二 · 设置页手填**：设置页 → 「代理地址」填入 `https://<proxy-host>/v1`（或内网 `http://<host>:8787/v1`）→ 保存。

两种方式等价：代理地址非空时，前端请求走代理且不携带 `Authorization`；直连 baseUrl/model/key 字段自动禁用。

数据源（v0.5）：设置页 → 「数据来源」选「远端数据平台」，地址填 `https://<proxy-host>/api/sources`
（配置了 `VITE_PROXY_URL` 时该地址会随构建自动推导，无需手填）。
请求失败自动回落演示数据并在 UI 标注；导入的班级成绩 CSV 始终最优先。

## 验收清单（对应 v0.2 专项 02）

- [x] 代理转发后前端功能与直连一致（流式、工具调用、文档生成）
- [x] key 不出现在前端网络请求中（代理模式不携带 Authorization）
- [x] 超限返回 429，前端可感知（LLMError 状态码透传）
- [x] 审计日志可查（Workers KV `audit:YYYY-MM-DD` / Express `proxy-logs/audit-*.jsonl`）
