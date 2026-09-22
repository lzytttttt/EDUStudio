"""代码绘制品牌标记：星形多边形即品牌母题「靛蓝圆角方块 + 白色四角星」的唯一实现。

星形路径：M16 7l2.2 5.6L24 14.8l-5.8 2.2L16 22.6l-2.2-5.6L8 14.8l5.8-2.2z
viewBox 32，底层 rect rx=8（= 25% 边长），星形填白。
（该路径原内联在 index.html 的 data:image/svg+xml favicon 里；v0.9.4-04 起 index.html 改为引用
本工具产出的 PNG 图标集，母题以本文件为准。）

以 4x 超采样绘制再 LANCZOS 降采样，保证各尺寸彼此同源且边缘干净。
"""

from PIL import Image, ImageDraw

from palette import rgba

# favicon 路径的 8 个顶点，逐段对应（viewBox 32）
STAR_VIEWBOX = 32.0
STAR_PTS = [
    (16.0, 7.0),
    (18.2, 12.6),
    (24.0, 14.8),
    (18.2, 17.0),
    (16.0, 22.6),
    (13.8, 17.0),
    (8.0, 14.8),
    (13.8, 12.6),
]
RADIUS_RATIO = 0.25  # rx 8 / 32
SS = 4  # 超采样倍数


def draw_mark(
    size: int,
    *,
    pad_ratio: float = 0.0,
    square_fill: str = "primary",
    star_fill: str = "surface",
    star_only: bool = False,
    star_scale: float = 1.0,
) -> Image.Image:
    """绘制品牌标记。

    pad_ratio  四周透明留白占比（0 = 满幅）
    star_only  只画星形（单色标记用）
    star_scale 星形相对自身中心缩放（>1 放大）
    """
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    inset = px * pad_ratio
    x0, y0, x1, y1 = inset, inset, px - 1 - inset, px - 1 - inset
    side = x1 - x0
    box = (x0, y0, x1, y1)

    if not star_only:
        d.rounded_rectangle(box, radius=int(side * RADIUS_RATIO), fill=rgba(square_fill))

    # viewBox 等比映射进 box
    k = side / STAR_VIEWBOX
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    pts = [((x0 + x * k - cx) * star_scale + cx, (y0 + y * k - cy) * star_scale + cy) for x, y in STAR_PTS]
    d.polygon(pts, fill=rgba(star_fill))

    return img.resize((size, size), Image.LANCZOS)


# 交付清单：id → 参数（尺寸在此展开，见 manifest.json 的 brand 组）
ICON_SIZES = (512, 192, 180, 64)


def build() -> dict[str, Image.Image]:
    """产出 6 张代码绘制资产（id → 图像）。"""
    out: dict[str, Image.Image] = {}
    for s in ICON_SIZES:
        out[f"icon-{s}"] = draw_mark(s)
    out["favicon-64"] = draw_mark(64)
    out["mark-color-512"] = draw_mark(512, pad_ratio=0.12)
    out["mark-mono-512"] = draw_mark(512, star_only=True, star_scale=1.6, star_fill="ink")
    return out


if __name__ == "__main__":
    for k, v in build().items():
        print(k, v.mode, v.size)
