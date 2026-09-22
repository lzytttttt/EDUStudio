"""输出校验：透明底真实性 + 覆盖度 + 体积门禁。

六条断言：
  1) mode 为 RGBA
  2) 四角极值像素透明 + 角块 alpha 均值很低（按尺寸自适应采样，避免把圆角抗锯齿误判为底板）
  3) 存在足量半透明边缘像素（证明是真抗锯齿 alpha，不是硬切）
  4) 不透明像素占比落在该资产允许区间
  5) 四周 1px 环带不出现大面积不透明（防模型吐出不透明底板）
  6) 单张体积 < 400KB
"""

from pathlib import Path

import numpy as np
from PIL import Image

MAX_BYTES_SMALL = 400 * 1024   # <=512 边长
MAX_BYTES_LARGE = 900 * 1024   # >512 边长（细节更多的场景图）
CORNER_MEAN_MAX = 4
CORNER_PIXEL_MAX = 8


def _corner_block(h: int, w: int) -> int:
    """角块边长随画布缩放：小图上 5x5 会探到圆角边缘，造成误判。"""
    return max(2, min(5, round(min(h, w) * 0.04)))


def check(path: Path, spec: dict) -> tuple[list[str], dict]:
    """返回 (错误列表, 实测统计)。spec 来自 manifest 的 verify 字段。"""
    errs: list[str] = []
    stats: dict = {}

    with Image.open(path) as im:
        if im.mode != "RGBA":
            errs.append(f"mode={im.mode} 非 RGBA")
            im = im.convert("RGBA")
        alpha = np.asarray(im)[..., 3]

    h, w = alpha.shape
    stats["size"] = f"{w}x{h}"

    # 四角极值像素必须透明
    for name, (py, px) in [("左上", (0, 0)), ("右上", (0, -1)), ("左下", (-1, 0)), ("右下", (-1, -1))]:
        v = int(alpha[py, px])
        stats[f"px{name}"] = v
        if v > CORNER_PIXEL_MAX:
            errs.append(f"{name}极值像素 alpha {v} > {CORNER_PIXEL_MAX}（四角应透明）")

    # 角块均值：按尺寸自适应边长
    b = _corner_block(h, w)
    stats["cornerBlock"] = b
    for name, (sy, sx) in [
        ("左上", (slice(0, b), slice(0, b))),
        ("右上", (slice(0, b), slice(-b, None))),
        ("左下", (slice(-b, None), slice(0, b))),
        ("右下", (slice(-b, None), slice(-b, None))),
    ]:
        m = float(alpha[sy, sx].mean())
        stats[f"blk{name}"] = round(m, 1)
        if m >= CORNER_MEAN_MAX:
            errs.append(f"{name}角 {b}x{b} 块 alpha 均值 {m:.1f} ≥ {CORNER_MEAN_MAX}（四角应透明）")

    semi = int(((alpha > 10) & (alpha < 245)).sum())
    stats["semi"] = semi
    smin = spec.get("semiMin", 20)
    if semi < smin:
        errs.append(f"半透明像素 {semi} < {smin}，疑似硬切 alpha 而非真抗锯齿")

    cov = float((alpha > 128).mean())
    stats["coverage"] = round(cov, 3)
    lo, hi = spec.get("coverage", [0.03, 0.99])
    if not (lo <= cov <= hi):
        errs.append(f"不透明占比 {cov:.1%} 越界 [{lo:.0%}, {hi:.0%}]")

    ring = np.concatenate([alpha[0, :], alpha[-1, :], alpha[:, 0], alpha[:, -1]])
    ring_op = float((ring > 128).mean())
    stats["ringOpaque"] = round(ring_op, 3)
    if not spec.get("allowEdge") and ring_op > 0.25:
        errs.append(f"四周 1px 环带不透明占比 {ring_op:.1%} > 25%，疑似含不透明底板")

    size = path.stat().st_size
    kb = size / 1024
    stats["kb"] = round(kb)
    limit = (spec.get("maxKB") or (900 if min(h, w) > 512 else 400)) * 1024
    if size > limit:
        errs.append(f"体积 {kb:.0f}KB > {limit / 1024:.0f}KB")

    return errs, stats
