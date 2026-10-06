#!/usr/bin/env python3
"""Regenerates every installer icon from the Whiparc brand mark.

Source of truth: apps/web/public/icons/icon-512.png (the square app icon used
by the web manifest). Requires Pillow (`pip install pillow`).

Outputs:
  installers/windows/whiparc.ico       multi-size .ico, classic BMP/DIB frames
  installers/linux/icons/<N>x<N>.png   freedesktop hicolor theme sizes
  installers/linux/icons/whiparc.svg   scalable hicolor icon
  installers/macos/resources/background.png  installer window branding

The .ico deliberately uses uncompressed BMP frames at every size (including
256x256) instead of PNG-compressed frames: they are valid on every Windows
version and every NSIS / go-winres release, so a toolchain upgrade or a
distro's older makensis can never silently fall back to a default icon.
"""
import shutil
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/web/public/icons/icon-512.png"
SVG = ROOT / "apps/web/app/icon.svg"
ICO_OUT = ROOT / "installers/windows/whiparc.ico"
LINUX_DIR = ROOT / "installers/linux/icons"
MACOS_BG = ROOT / "installers/macos/resources/background.png"

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]


def resize(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def dib_frame(img: Image.Image) -> bytes:
    """ICO image entry: BITMAPINFOHEADER + bottom-up BGRA pixels + AND mask."""
    w, h = img.size
    rgba = img.convert("RGBA")
    px = rgba.load()
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    pixels = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            pixels += bytes((b, g, r, a))
    # 1-bpp AND mask, rows padded to 32 bits. All zero: alpha channel rules.
    mask = bytes(((w + 31) // 32) * 4 * h)
    return header + bytes(pixels) + mask


def write_ico(frames: list[Image.Image], out: Path) -> None:
    blobs = [dib_frame(f) for f in frames]
    offset = 6 + 16 * len(frames)
    directory = bytearray()
    for f, blob in zip(frames, blobs):
        w, h = f.size
        directory += struct.pack(
            "<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset
        )
        offset += len(blob)
    out.write_bytes(
        struct.pack("<HHH", 0, 1, len(frames)) + bytes(directory) + b"".join(blobs)
    )


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    write_ico([resize(src, s) for s in ICO_SIZES], ICO_OUT)

    LINUX_DIR.mkdir(parents=True, exist_ok=True)
    for s in LINUX_SIZES:
        resize(src, s).save(LINUX_DIR / f"{s}x{s}.png", optimize=True)
    shutil.copyfile(SVG, LINUX_DIR / "whiparc.svg")
    MACOS_BG.parent.mkdir(parents=True, exist_ok=True)
    resize(src, 128).save(MACOS_BG, optimize=True)
    print(f"wrote {ICO_OUT.relative_to(ROOT)} and {len(LINUX_SIZES)} PNGs + SVG")


if __name__ == "__main__":
    main()
