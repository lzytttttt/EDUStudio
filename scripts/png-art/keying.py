"""可控背景抠图：把纯品红背景转成 alpha 通道。

为什么用品红而非绿幕：本项目色板里的 mint #2A9D8F 是绿系，绿幕冲突风险高；
而暖纸色板（米白/靛蓝/珊瑚/琥珀/薄荷）不含高饱和品红，且模型对 magenta 背景响应稳定。

流程：
  1) 自适应取键色（四边环带中位数，防模型偏色）
  2) 色距软阈值 → alpha（过渡带即天然羽化）
  3) 连通域限定：只抠「与画布四边连通」的背景，保护主体内部同色块
  4) 去色溢 despill：压制边缘残留的品红
  5) 调色板吸附：边缘像素吸附到最近 token 色，统一色感
"""

import numpy as np
from PIL import Image, ImageFilter

from palette import PALETTE, hex_to_rgb

DEFAULT_KEY = (255, 0, 255)  # #FF00FF
T0, T1 = 0.10, 0.30  # 色距 <= T0 视为背景，>= T1 视为主体
DESPILL_KW = 0.85
SNAP_DIST = 40.0
MAX_DIST = 441.67  # sqrt(3) * 255


def key_color(rgb: np.ndarray, ring: int = 5) -> tuple[int, int, int]:
    """从四边环带取中位数作为实际键色；若明显偏离品红则回退默认值。"""
    bands = np.concatenate(
        [rgb[:ring].reshape(-1, 3), rgb[-ring:].reshape(-1, 3), rgb[:, :ring].reshape(-1, 3), rgb[:, -ring:].reshape(-1, 3)]
    )
    key = np.median(bands, axis=0).astype(int)
    if np.linalg.norm(key - np.array(DEFAULT_KEY)) / MAX_DIST > 0.30:
        return DEFAULT_KEY
    return (int(key[0]), int(key[1]), int(key[2]))


def _despill(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """压制边缘残留品红：溢出量 spill=(R-min(G,B))/255，按 (1-alpha) 加权削减 R/B。"""
    out = rgb.astype(np.float64)
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    spill = np.clip((r - np.minimum(g, b)) / 255.0, 0, 1)
    edge = (alpha > 0.05) & (alpha < 0.95)
    w = np.where(edge, (1.0 - alpha), 0.0) * DESPILL_KW
    out[..., 0] = np.where(edge, r - spill * (r - g) * w, r)
    out[..., 2] = np.where(edge, b - spill * (b - g) * w, b)
    return np.clip(out, 0, 255)


def _snap_palette(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """把接近某 token 色的不透明像素吸附过去，消除残余色偏。"""
    names = list(PALETTE)
    cols = np.array([hex_to_rgb(PALETTE[n]) for n in names], dtype=np.float64)
    out = rgb.astype(np.float64)
    flat = out.reshape(-1, 3)
    d = np.linalg.norm(flat[:, None, :] - cols[None, :, :], axis=2)
    idx = d.argmin(axis=1)
    best = d[np.arange(len(flat)), idx]
    hit = (best < SNAP_DIST).reshape(alpha.shape) & (alpha >= 0.95)
    out[hit] = cols[idx.reshape(alpha.shape)[hit]]
    return out


def to_alpha(img: Image.Image, *, t0: float = T0, t1: float = T1, snap: bool = True) -> Image.Image:
    """品红背景 → RGBA。img 需为 RGB/RGBA。"""
    rgb = np.asarray(img.convert("RGB")).astype(np.float64)
    key = np.array(key_color(rgb), dtype=np.float64)

    dist = np.linalg.norm(rgb - key, axis=2) / MAX_DIST
    # 色距越大越像主体：dist<=t0 判背景，>=t1 判主体
    alpha = np.clip((dist - t0) / (t1 - t0), 0.0, 1.0)

    # 不做「与边界连通的背景才抠」的连通域保护：实测模型会把品红画进主体
    # （脸颊、衣角），保护逻辑反而让这些品红残留存活。本套色板（palette.py）
    # 按构造不含任何品红/粉/紫，因此画面里出现的品红一律是背景污染，应全部清除。
    alpha[dist <= t0] = 0.0

    # 边缘抗锯齿：先腐蚀 1px 去掉背景侧白/彩边，再轻微羽化
    a_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    alpha = np.asarray(a_img).astype(np.float64) / 255.0

    rgb = _despill(rgb, alpha)
    if snap:
        rgb = _snap_palette(rgb, alpha)

    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def has_transparency(img: Image.Image, min_ratio: float = 0.02) -> bool:
    """判断 raw 是否已自带透明通道（原生 RGBA 出图则无需抠图）。"""
    if img.mode != "RGBA":
        return False
    a = np.asarray(img)[..., 3]
    return float((a < 250).mean()) > min_ratio
