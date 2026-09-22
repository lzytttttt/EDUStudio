# scripts/png-art · 透明底 PNG 美术资源生成

为 EDUStudio 生成一套透明底 PNG 美术资源（23 张），输出到项目 `png/`（其中 4 张应用图标输出到 `public/`，见下），**不改动任何应用源码**。

> 应用侧消费入口是 `src/theme/art.ts`（v0.9.4-04 接入，方案与验收见 [../../doc/v0.9.4-04-art-assets.md](../../doc/v0.9.4-04-art-assets.md)）。
> **为什么 icon 组单独落在 `public/`**：`index.html` 只能引用绝对路径，且 `site.webmanifest` 的 `icons[].src` 无法指向带哈希的文件名——只有这 4 张需要稳定 URL，故不与其他 19 张一起走 Vite 哈希管线。

配色唯一来源是 `src/theme/tokens.css`（见 `palette.py`）；品牌图形母题是「靛蓝圆角方块 + 白色四角星」，自 v0.9.4-04 起以 `draw_icon.py` 为唯一事实源（`index.html` 已改为引用本工具产出的 PNG 图标集，母题不再内联在 HTML 中）。

## 两类产出

| kind | 张数 | 产出方式 | 是否需要出图工具 |
| --- | --- | --- | --- |
| `icon` / `lockup` | 9 | Pillow 代码绘制与排印 | 否 |
| `gen` | 14 | 出图工具出品红底原图 → `keying.py` 抠成透明底 | 是 |

**为什么品牌资产不交给模型**：App 图标必须与现有 favicon 像素级同源，模型无法保证；中文字形（「智教工坊」）模型易糊字错字，一律由 Pillow + 雅黑 Bold 排印。

**为什么 gen 类走「品红底 + 抠图」**：出图工具无法直接产出带 alpha 的 PNG。选品红 `#FF00FF` 而非绿幕，是因为本项目色板里的 `mint #2A9D8F` 是绿系、绿幕冲突风险高，而暖纸色板（米白/靛蓝/珊瑚/琥珀/薄荷）不含任何高饱和品红。

## gen 类的两段式流程

### 1. 导出提示词

```bash
py run.py --prompts --group card      # 打印提示词与负向词
```

提示词由 `manifest.json` 的 `style` / `background` / `defaultNegative` + 每张的 `prompt` / `accent` 拼装，**不要在别处另写提示词**。

关键约束（已固化在 manifest）：纯品红满幅背景、禁止任何背景板/卡片/条纹/边框、主体内不得出现品红粉紫、只使用 token 色。

**人物类资产的配色原则（role 组）**：不做肤色，走「**纯 token 单色人像**」——脸用 `surface` 纸白、五官用 `ink` 点与线、服装用 accent 色块，肩侧悬浮一枚小图标作为角色徽记。
理由有两条：一是浅肤色在应用的柔性底色（`mint-soft` / `primary-soft` / `coral-soft`）与暖纸底上几乎没有明度差，44px 渲染尺寸下会糊成一片；二是肤色必然引入 token 之外的色值，而单色人像与卡片插画（同为「token 色 + 扁平几何」）完全同族。

### 2. 出图并归位

按提示词出图，把原图存为 `raw/<id>.png`（该目录已被 gitignore，属可重跑的中间件）。

### 3. 抠图并产出成品

```bash
py run.py --group card                # 抠图 → 缩放 → 校验
py run.py --only card-creation --force   # 只重生某一张
```

`raw` 若已自带透明通道（原生 RGBA 出图）则自动跳过抠图，两种来源通用。

**缩放规则（`trim.py`）**：裁到 alpha bbox → 按 `pad` 补透明边（卡片/角色 8%、场景 6%）→ 等比 LANCZOS。
`k` **限幅在 ≤1.35×**：源为扁平矢量，轻放大近乎无损，能让主体填满画布 —— 这对小渲染框是刚需
（角色图在应用里只有 44px，主体占比不够就必然糊）。超出 1.35× 说明源过小，报错要求重出图，不做糊图兜底。

## 命令一览

```bash
py run.py --list                     # 列出全部资产与完成状态
py run.py --kind icon,lockup         # 品牌 9 张（无需 raw，随时可跑）
py run.py --prompts --only card-data # 打印某张的提示词
py run.py --group scene              # 处理某组（logo/icon/card/role/scene）
py run.py --verify-only              # 只复校验（幂等性检查）
py run.py --sheet                    # 重建 contact-sheet.png 验收图
py run.py --dry-run                  # 打印将执行的动作，不落盘
```

`.state.json` 记 `id → sha1(manifest 项)`，manifest 未变且成品存在即 skip，重跑不重复抠图。

## 抠图算法（`keying.py`）

1. **自适应取键色**：取四边 5px 环带中位数作为实际键色，明显偏离品红时回退 `#FF00FF`（防出图偏色）。
2. **色距软阈值**：`d = ‖rgb-key‖/441.67`，`α = clip((d-t0)/(t1-t0), 0, 1)`，`t0=0.10`、`t1=0.30`；过渡带即天然羽化。
3. **边缘抗锯齿**：alpha 先 `MinFilter(3)` 腐蚀 1px（去掉背景侧白边/彩边），再 0.6px 高斯羽化。
4. **去色溢 despill**：边缘像素按 `spill=(R-min(G,B))/255` 压制品红，权重随 `(1-α)` 递增。
5. **调色板吸附**：不透明且距最近 token 色 <40 的像素吸附过去，统一色感。
6. **不做连通域保护**（重要）：曾实现「仅抠与画布边界连通的背景」，但实测模型会把品红画进主体（脸颊、衣角），保护逻辑反而让这些品红残留存活 —— 比偶尔挖洞更糟。本套色板按构造不含品红，画面里出现的品红一律是背景污染，全部清除。

## 校验（六条断言）

`verify.py` 逐张断言：

1. `mode` 为 RGBA
2. 四角极值像素透明 + 角块 alpha 均值极低（角块边长随画布自适应，避免把圆角抗锯齿误判为不透明底板）
3. 存在足量半透明边缘像素（证明是真抗锯齿 alpha，不是硬切）
4. 不透明像素占比落在该资产允许区间（`manifest.json` 的 `verify.coverage`）
5. 四周 1px 环带无大面积不透明（防吐出不透明底板）
6. 单张体积达标（≤512 边长限 400KB，>512 限 900KB；可用 `verify.maxKB` 覆盖）

**断言查不出美学与抠图瑕疵**，必须配合人工看 `contact-sheet.png`：每张叠在棋盘格上，透明区域一目了然。建议再叠深色与 `#FAF8F5` 两种底色各看一次。

## 文件

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | **单一事实源**：23 张资产的尺寸/留白/提示词/校验区间 |
| `palette.py` | token 色常量（唯一色源） |
| `draw_icon.py` | 代码绘制图标与星形标记（4x 超采样） |
| `lockup.py` | Logo / 头图中文排印合成（2x 超采样，墨迹居中） |
| `keying.py` | 品红键抠图（自适应键色 + 软阈值 + despill + 调色板吸附） |
| `trim.py` | alpha bbox 裁剪 + 补边 + LANCZOS 缩放（**限幅放大 ≤1.35×**） |
| `verify.py` | 六条断言 |
| `run.py` | CLI 编排 + 幂等 + contact-sheet |
| `raw/` | 出图原始件（gitignore，可重跑再生成） |

## 附：让同类资产风格一致的做法

**分张生成必然漂移。** 同一批 `role` 资产里，单独生成的教师明显比另两位构图更大、五官更繁复、脸颊带红晕 —— 即使提示词写「同款极简头像」也压不住，因为每次生成都是独立采样。

可靠做法是**一张图里画多个主体**，同一趟采样天然共享风格、构图与尺度，再切开：

- 提示词强调「one single row, evenly spaced, each occupying an equal third, identical framing, identical head size, identical eye level, wide empty gaps between them」
- 切开时不要等分：先抠出 alpha，取**面积最大的连续内容行带**（可顺带丢掉模型乱加的残影），再在该带内按**列方向的空隙**切出各主体
- 实测效果：三位角色的不透明占比从 `0.38 / 0.383 / 0.384`（分张）收敛到 `0.238 / 0.226 / 0.207`（同图），切出的原始宽度 `346 / 343 / 339`

本例的三段切分是一次性操作（未固化为脚本）；若要复用，按上面两条规则实现即可。

## 附：ModelScope / Qwen-Image-2.1 路线的尝试结论

曾尝试用 **Qwen-Image-2.1**（该模型原生支持 RGBA 透明输出，若可用则无需抠图）替代抠图路线，结论是**该端点当前不可用**，故回到抠图方案。记录如下备查：

- 端点：`https://studio-qwen-qwen-image-2-1.api-inference.modelscope.net`（Gradio，官方 HF Space `qwen-qwen-image-2-1.hf.space` 是同一应用的另一部署）
- 鉴权：`Authorization: Bearer <ModelScope token>`，`/gradio_api/info` 正常返回 42 个端点
- 生成端点 `/generate_with_enhance`，10 参：`input_images, original_prompt, enable_extend, custom_size, log_dir, seed, randomize_seed, height, width, negative_prompt`
- **无独立透明开关**，RGBA 仅由提示词触发；`enable_extend`（智能改写提示词）默认开启，会改写提示词
- 图片下载域 `*.ms.show` **拒绝 Authorization 头（403）且要求 `Referer` 指向应用地址**
- SSE 协议：先推 `generating`（内容是「Generating image...」**静态占位图**，路径哈希恒定）再推 `complete`；**绝不能把 `generating` 当结果**，否则会把占位图静默存成成品
- **失败表现**：恒定「占位图 → `error: null`」，6 种参数组合（custom_size 开关、log_dir、普通/RGBA 提示词、input_images=None、negative=None、固定 seed）全部同样失败；ModelScope 侧 1.2~18s 秒失败，HF 侧排队 319s 后同样失败 → 判定为应用侧推理阶段故障，与调用参数无关
