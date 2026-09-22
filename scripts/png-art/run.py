"""透明底 PNG 美术资源生成与校验编排。

用法：
  python run.py --list                      列出全部资产与状态
  python run.py --kind icon,lockup          代码绘制品牌资产（无需 raw）
  python run.py --prompts --group card      打印出图提示词与负向词（喂给出图工具）
  python run.py --group card                把 raw/ 处理成成品（抠图 → 降采样 → 校验）
  python run.py --only card-creation --force  只重生某一张
  python run.py --verify-only               只复校验（幂等性检查用）
  python run.py --sheet                     只重建 contact-sheet
  python run.py --dry-run                   打印将要执行的动作，不落盘

gen 类资产的两段式流程：
  1) 按 --prompts 输出的提示词出图（品红纯色背景），把原图存为 raw/<id>.png
  2) 跑本脚本：raw 无 alpha 则 keying.py 抠成透明底 → trim.py 降采样 → verify.py 校验
  raw 若已自带透明通道（原生 RGBA 出图）则自动跳过抠图。
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import draw_icon
import keying
import lockup
import palette
import trim
import verify

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

MANIFEST = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
ASSETS = MANIFEST["assets"]
BY_ID = {a["id"]: a for a in ASSETS}
STATE_PATH = HERE / ".state.json"
RAW_DIR = HERE / "raw"

CODE_BUILDERS = {"icon": draw_icon.build, "lockup": lockup.build}


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")


def spec_hash(asset: dict) -> str:
    blob = json.dumps(asset, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha1(blob).hexdigest()[:12]


def out_path(asset: dict) -> Path:
    return ROOT / asset["out"]


def compose_prompt(asset: dict) -> str:
    """按 manifest 的风格/配色/背景约束拼装出图提示词。"""
    accent = palette.hex_of(asset["accent"])
    lock = MANIFEST["paletteLock"]
    others = ", ".join(f"{k} {v}" for k, v in lock.items() if k != asset["accent"])
    return (
        f"{MANIFEST['style']} {asset['prompt']}. "
        f"Color palette: dominant accent color {accent} (exact hex {accent}) plus muted supporting tones {others}. "
        f"Keep the illustration flat and clean, using only these colors. "
        f"{MANIFEST['background']}"
    ).replace("  ", " ").strip()


def negative_of(asset: dict) -> str:
    extra = asset.get("negative") or ""
    return (MANIFEST["defaultNegative"] + ", " + extra).strip(", ")


def load_raw(asset: dict) -> Image.Image:
    """读取 raw/<id>.png 并确保它带真实透明通道。

    出图工具产出的 raw 若已自带 alpha（原生 RGBA 出图）则直接使用；
    否则按可控背景抠图（品红键）转成 alpha。
    """
    raw = RAW_DIR / f"{asset['id']}.png"
    if not raw.exists():
        raise SystemExit(
            f"缺少 {raw.relative_to(ROOT)}；请先按 README.md 的出图流程产出该 raw，再重跑本命令"
        )
    img = Image.open(raw).convert("RGBA")
    if keying.has_transparency(img):
        print(f"    → raw {img.size} 已带透明通道，跳过抠图")
        return img
    print(f"    → raw {img.size} 无透明通道，执行品红键抠图")
    return keying.to_alpha(img)


def build_one(asset: dict, force: bool, state: dict) -> str:
    """处理单个资产，返回状态字符串。"""
    dst = out_path(asset)
    h = spec_hash(asset)
    rec = state.get(asset["id"], {})
    if not force and dst.exists() and rec.get("hash") == h:
        return "skip（幂等命中）"

    dst.parent.mkdir(parents=True, exist_ok=True)

    if asset["kind"] in CODE_BUILDERS:
        img = CODE_BUILDERS[asset["kind"]]()[asset["id"]]
        img.save(dst, optimize=True)
    else:
        raw = load_raw(asset)
        trim.fit_to_target(raw, tuple(asset["target"]), asset.get("pad", 0.0)).save(dst, optimize=True)

    state[asset["id"]] = {"hash": h, "out": asset["out"]}
    return f"ok → {asset['out']}"


def check_one(asset: dict) -> tuple[list[str], dict]:
    dst = out_path(asset)
    if not dst.exists():
        return [f"缺失 {dst.relative_to(ROOT)}"], {}
    return verify.check(dst, asset.get("verify", {}))


def build_sheet(tile: int = 256, cols: int = 6) -> Path:
    """拼验收图：每张叠在棋盘格上，透明区域一目了然。"""
    ids = [a["id"] for a in ASSETS]
    rows = (len(ids) + cols - 1) // cols
    cell = tile + 32
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    try:
        from palette import CJK_FONT_BOLD
        from PIL import ImageFont

        font = ImageFont.truetype(CJK_FONT_BOLD, 15)
    except Exception:
        font = None

    for i, aid in enumerate(ids):
        cx, cy = (i % cols) * cell, (i // cols) * cell
        # 棋盘格底
        step = 16
        for yy in range(cy + 16, cy + 16 + tile, step):
            for xx in range(cx + 8, cx + 8 + tile, step):
                shade = 232 if ((xx // step + yy // step) % 2 == 0) else 255
                d.rectangle([xx, yy, xx + step - 1, yy + step - 1], fill=(shade, shade, shade, 255))
        p = out_path(BY_ID[aid])
        if p.exists():
            with Image.open(p) as im:
                t = im.convert("RGBA")
                t.thumbnail((tile, tile), Image.LANCZOS)
                sheet.alpha_composite(t, (cx + 8 + (tile - t.width) // 2, cy + 16 + (tile - t.height) // 2))
        else:
            d.text((cx + 12, cy + 16 + tile // 2), "MISSING", fill=(229, 72, 77, 255), font=font)
        d.text((cx + 8, cy + 2), aid, fill=(38, 34, 29, 255), font=font)

    out = HERE / "contact-sheet.png"
    sheet.convert("RGB").save(out, optimize=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="透明底 PNG 美术资源生成与校验")
    ap.add_argument("--list", action="store_true", help="列出全部资产")
    ap.add_argument("--only", help="只处理指定 id")
    ap.add_argument("--group", help="只处理指定组（logo/icon/card/role/scene）")
    ap.add_argument("--kind", help="只处理指定类型（icon/lockup/gen，逗号分隔）")
    ap.add_argument("--force", action="store_true", help="忽略幂等状态强制重建")
    ap.add_argument("--verify-only", action="store_true", help="只校验不生成")
    ap.add_argument("--sheet", action="store_true", help="只重建 contact-sheet")
    ap.add_argument("--prompts", action="store_true", help="打印选中资产的出图提示词与负向词")
    ap.add_argument("--dry-run", action="store_true", help="只打印动作")
    args = ap.parse_args()

    if args.list:
        state = load_state()
        for a in ASSETS:
            done = "✓" if out_path(a).exists() else "·"
            print(f"{done} {a['id']:<22} {a['kind']:<7} {a['out']}")
        return 0

    if args.sheet:
        print("contact-sheet →", build_sheet().relative_to(ROOT))
        return 0

    targets = ASSETS
    if args.only:
        if args.only not in BY_ID:
            raise SystemExit(f"未知 id：{args.only}")
        targets = [BY_ID[args.only]]
    elif args.group:
        targets = [a for a in targets if a["group"] == args.group]
    elif args.kind:
        kinds = {k.strip() for k in args.kind.split(",")}
        targets = [a for a in targets if a["kind"] in kinds]

    if not targets:
        raise SystemExit("没有匹配的资产")

    if args.prompts:
        for a in targets:
            if a["kind"] != "gen":
                continue
            print(f"### {a['id']}  ({a['officialRatio'][0]}x{a['officialRatio'][1]})")
            print(compose_prompt(a))
            print(f"NEGATIVE: {negative_of(a)}")
            print(f"RAW → {RAW_DIR / (a['id'] + '.png')}")
            print()
        return 0

    state = load_state()
    failed: list[tuple[str, list[str]]] = []

    if not args.verify_only:
        for a in targets:
            if args.dry_run:
                print(f"· {a['id']:<22} {a['kind']:<7} {a['out']}")
                continue
            print(f"▶ {a['id']}")
            try:
                print(f"    {build_one(a, args.force, state)}")
            except Exception as e:
                print(f"    ✗ {type(e).__name__}: {e}")
                failed.append((a["id"], [str(e)]))
        if not args.dry_run:
            save_state(state)

    if args.dry_run:
        return 0

    print("\n── 校验 ──")
    for a in targets:
        errs, stats = check_one(a)
        mark = "✓" if not errs else "✗"
        print(f"{mark} {a['id']:<22} {stats}")
        if errs:
            for e in errs:
                print(f"     - {e}")
            failed.append((a["id"], errs))

    try:
        print("\ncontact-sheet →", build_sheet().relative_to(ROOT))
    except Exception as e:
        print("contact-sheet 生成失败：", e)

    if failed:
        print(f"\n{len(failed)} 张未通过：")
        for i, _ in failed:
            print("  -", i)
        return 1
    print("\n全部通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
