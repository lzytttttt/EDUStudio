"""Logo / 头图排印合成：图形标记（代码绘制）+ 中文（雅黑 Bold 排字）。

中文字形一律不交给图像模型（易糊字错字），全部由 Pillow 排印保证正确。
所有文字以 2x 尺寸绘制到 2x 画布，再 LANCZOS 降采样，避免小字号发虚。
"""

from PIL import Image, ImageDraw, ImageFont

from draw_icon import draw_mark
from palette import CJK_FONT_BOLD, CJK_FONT_REGULAR, rgba

WORDMARK = "智教工坊"
TAGLINE = "EDUStudio · 教育 Agent 工作台"

SS = 2  # 排印超采样倍数


def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def _ink_bbox(d: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    """返回文字墨迹的 (宽, 高) —— 用实际墨迹框而非 font metrics（雅黑 ttc 行高偏差大）。"""
    b = d.textbbox((0, 0), text, font=font)
    return b[2] - b[0], b[3] - b[1]


def _draw_ink(d: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, font, fill) -> None:
    """按墨迹左上角定位绘制文字。"""
    b = d.textbbox((0, 0), text, font=font)
    d.text((xy[0] - b[0], xy[1] - b[1]), text, font=font, fill=fill)


def _lockup(
    w: int,
    h: int,
    *,
    mark_size: int,
    gap_mark_text: int,
    size_wordmark: int,
    size_tagline: int,
    gap_text: int,
    layout: str,
) -> Image.Image:
    """通用 lockup 排版。layout: 'horizontal' | 'vertical'。"""
    W, H = w * SS, h * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    f_word = _font(CJK_FONT_BOLD, size_wordmark * SS)
    f_tag = _font(CJK_FONT_REGULAR, size_tagline * SS)
    w1, h1 = _ink_bbox(d, WORDMARK, f_word)
    w2, h2 = _ink_bbox(d, TAGLINE, f_tag)
    ms = mark_size * SS

    if layout == "horizontal":
        gap_mt, gap_t = gap_mark_text * SS, gap_text * SS
        text_w = max(w1, w2)
        text_h = h1 + gap_t + h2
        group_w = ms + gap_mt + text_w
        gx = (W - group_w) // 2
        tx = gx + ms + gap_mt
        ty = (H - text_h) // 2
        img.alpha_composite(draw_mark(ms, pad_ratio=0.0), (gx, (H - ms) // 2))
        _draw_ink(d, (tx, ty), WORDMARK, f_word, rgba("ink"))
        _draw_ink(d, (tx, ty + h1 + gap_t), TAGLINE, f_tag, rgba("ink_soft"))
    else:
        gap_mt, gap_t = gap_mark_text * SS, gap_text * SS
        block_h = ms + gap_mt + h1 + gap_t + h2
        y = (H - block_h) // 2
        img.alpha_composite(draw_mark(ms, pad_ratio=0.0), ((W - ms) // 2, y))
        y += ms + gap_mt
        _draw_ink(d, ((W - w1) // 2, y), WORDMARK, f_word, rgba("ink"))
        y += h1 + gap_t
        _draw_ink(d, ((W - w2) // 2, y), TAGLINE, f_tag, rgba("ink_soft"))

    return img.resize((w, h), Image.LANCZOS)


def build() -> dict[str, Image.Image]:
    """产出 3 张排印资产（id → 图像）。"""
    return {
        "logo-horizontal": _lockup(
            1200, 320,
            mark_size=224, gap_mark_text=48, size_wordmark=128, size_tagline=40, gap_text=12,
            layout="horizontal",
        ),
        "logo-vertical": _lockup(
            640, 760,
            mark_size=160, gap_mark_text=40, size_wordmark=96, size_tagline=32, gap_text=12,
            layout="vertical",
        ),
        "banner-readme": _lockup(
            1600, 640,
            mark_size=240, gap_mark_text=56, size_wordmark=140, size_tagline=44, gap_text=16,
            layout="horizontal",
        ),
    }


if __name__ == "__main__":
    for k, v in build().items():
        print(k, v.mode, v.size)
