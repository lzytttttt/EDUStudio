"""alpha bbox 裁剪 + 补边 + 等比 LANCZOS 缩放（限幅放大）。"""

from PIL import Image

MAX_UPSCALE = 1.35


def fit_to_target(img: Image.Image, target: tuple[int, int], pad: float, min_fill: float = 0.30) -> Image.Image:
    """把 raw 裁到内容包围盒，按 pad 留白等比缩放并居中放入目标画布。

    k 限幅在 MAX_UPSCALE 以内：源为扁平矢量插画，轻放大视觉近乎无损，可把主体填满画布
    （角色图要在 44px 渲染框里可辨，主体占比不够就必然糊）。超出限幅说明源过小，报错要求重出图。
    内容小于内区且无需放大时保持原始像素居中。
    """
    bbox = img.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("图像全透明，无内容可裁剪")
    img = img.crop(bbox)

    tw, th = target
    inner_w, inner_h = tw * (1 - 2 * pad), th * (1 - 2 * pad)
    need = min(inner_w / img.width, inner_h / img.height)
    if need > MAX_UPSCALE:
        raise ValueError(
            f"raw 内容 {img.size} 放到目标内区需放大 {need:.2f}x（> {MAX_UPSCALE}x 上限），"
            f"源过小；请提高出图尺寸或让主体占画幅更大"
        )
    fill = max(img.width / inner_w, img.height / inner_h)
    if need <= 1.0 and fill < min_fill:
        raise ValueError(
            f"raw 内容 {img.size} 仅占目标内区 {fill:.0%}（< {min_fill:.0%}），主体过小；请重生成更满的构图"
        )

    k = min(need, MAX_UPSCALE)
    nw, nh = max(1, round(img.width * k)), max(1, round(img.height * k))
    img = img.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((tw - nw) // 2, (th - nh) // 2))
    return canvas
