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
- 路径白名单：仅上述两个端点，其余 404
- `model` 白名单：`deepseek-chat` / `deepseek-reasoner` / `deepseek-v4-flash` / `deepseek-v4-flash-free` / `deepseek-v4-pro`
- 请求体校验：messages ≤ 100 条、单条 content ≤ 32000 字符
- 限额：10 次/分钟 + 200 次/天（按客户端摘要：优先 `X-EDU-TOKEN`，其次 IP）
- 审计：时间 / 客户端摘要 / 角色（`X-EDU-Client`）/ model / 状态码 / usage tokens；**不记录对话内容明文**
- CORS：`ALLOWED_ORIGINS` 域名白名单（未配置时放行，便于本地联调）
- 可选 `X-EDU-TOKEN`：机构内统一分发 token

## Cloudflare Workers 部署

```bash
npm i -g wrangler
wrangler kv namespace create EDU_RATE_KV
wrangler kv namespace create EDU_AUDIT_KV
# 把返回的 id 填入 wrangler.toml 的 kv_namespaces（取消注释）
wrangler secret put DEEPSEEK_KEY   # 粘贴真实 key
wrangler deploy
```

生产环境在 `wrangler.toml` 的 `[vars]` 配置：

- `ALLOWED_ORIGINS`：前端域名（逗号分隔）
- `EDU_TOKEN`（可选）：机构统一 token

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

设置页 → 「代理地址」填入 `https://<proxy-host>/v1`（或内网 `http://<host>:8787/v1`）→ 保存。
代理地址非空时，前端请求走代理且不携带 `Authorization`；直连 baseUrl/model/key 字段自动禁用。

## 验收清单（对应 v0.2 专项 02）

- [x] 代理转发后前端功能与直连一致（流式、工具调用、文档生成）
- [x] key 不出现在前端网络请求中（代理模式不携带 Authorization）
- [x] 超限返回 429，前端可感知（LLMError 状态码透传）
- [x] 审计日志可查（Workers KV `audit:YYYY-MM-DD` / Express `proxy-logs/audit-*.jsonl`）
