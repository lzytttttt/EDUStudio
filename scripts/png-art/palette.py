"""设计 token 色（唯一色源）：src/theme/tokens.css

所有绘制/校验脚本只从这里取色，禁止在别处硬编码 hex。
"""

PALETTE = {
    "bg": "#FAF8F5",
    "surface": "#FFFFFF",
    "surface_2": "#F3F1EC",
    "ink": "#26221D",
    "ink_soft": "#6B6660",
    "ink_mute": "#A8A39D",
    "line": "#ECE8E2",
    "primary": "#4F46E5",
    "primary_deep": "#4338CA",
    "primary_soft": "#EEF2FF",
    "coral": "#FF6B6B",
    "coral_soft": "#FFF1F1",
    "amber": "#F6C453",
    "amber_soft": "#FEF6E4",
    "mint": "#2A9D8F",
    "mint_soft": "#E8FAF8",
    "danger": "#E5484D",
}

# 卡片类型 → 主色 token 名（源：src/apps/briefing/BriefingCardView.tsx:9-14）
CARD_ACCENT = {
    "insight": "mint",
    "decision": "amber",
    "creation": "primary",
    "todo": "coral",
    "data": "primary",
    "question": "coral",
}

# 角色 → 主色 token 名（源：src/harness/roles/index.ts）
ROLE_ACCENT = {
    "teacher": "mint",
    "admin": "primary",
    "district": "coral",
}

CJK_FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
CJK_FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
CJK_FONT_HEI = "C:/Windows/Fonts/simhei.ttf"


def rgba(name: str, alpha: int = 255) -> tuple[int, int, int, int]:
    """token 名 → RGBA 元组。"""
    h = PALETTE[name].lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def hex_of(name: str) -> str:
    return PALETTE[name]


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    """'#RRGGBB' → (r, g, b)。"""
    h = value.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
