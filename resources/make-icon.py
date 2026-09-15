"""Rasterise the app icon into a multi-resolution Windows .ico and a 256px .png.

Run from the project root:

    python resources/make-icon.py

Uses only the Python standard library — no Pillow, no ImageMagick, no npm packages — so
regenerating the icon never needs an install on a machine that is only building a release.

The trade-off is that icon.svg's geometry is duplicated as the constants below: **if you edit
icon.svg, mirror the change here and re-run this script.** The shapes are all axis-aligned
rectangles, so the only place anti-aliasing matters is the tile's rounded corners; those are
sampled at 4x4 per pixel.

Windows shows the 16px and 32px entries in Explorer and the taskbar, and the 256px entry in the
installer and large-icon views. macOS takes the .png.
"""

import struct
import zlib
from pathlib import Path

# ─── Geometry, mirroring icon.svg ─────────────────────────────────────────────

TILE = 64.0  # icon.svg's viewBox is 0 0 64 64
TILE_RADIUS = 11.0
BLUE = (0x00, 0x33, 0xA0)  # Boise State blue
WHITE = (0xFF, 0xFF, 0xFF)

# (x, y, width, height) in viewBox units — the same numbers as the <rect>s in icon.svg.
WHITE_RECTS = [
    (10, 14, 44, 8),        # header row, solid
    (10, 30, 44, 1.5),      # row separators
    (10, 39, 44, 1.5),
    (10, 48.5, 44, 1.5),   # closes flush with the column separators at y=50
    (23, 22, 1.5, 28),      # column separators
    (34, 22, 1.5, 28),
    (45, 22, 1.5, 28),
    (10, 22, 1.5, 28),      # outer frame, left and right
    (52.5, 22, 1.5, 28),
]

SAMPLES = 4  # 4x4 supersampling per pixel
SIZES = [16, 32, 48, 256]


def inside_tile(x: float, y: float) -> bool:
    """True when (x, y) falls inside the rounded-rect tile, in viewBox units."""
    r = TILE_RADIUS
    if x < 0 or y < 0 or x > TILE or y > TILE:
        return False
    # Corner circles; the straight edges are everything that is not in a corner box.
    cx = r if x < r else (TILE - r if x > TILE - r else x)
    cy = r if y < r else (TILE - r if y > TILE - r else y)
    if cx == x or cy == y:
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_white(x: float, y: float) -> bool:
    for rx, ry, rw, rh in WHITE_RECTS:
        if rx <= x < rx + rw and ry <= y < ry + rh:
            return True
    return False


def render(size: int) -> bytes:
    """RGBA bytes for one square icon of `size` pixels."""
    scale = TILE / size
    step = scale / SAMPLES
    offset = step / 2
    out = bytearray()

    for py in range(size):
        for px in range(size):
            hits = 0
            white_hits = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    x = (px * SAMPLES + sx) * step + offset
                    y = (py * SAMPLES + sy) * step + offset
                    if inside_tile(x, y):
                        hits += 1
                        if inside_white(x, y):
                            white_hits += 1
            total = SAMPLES * SAMPLES
            if hits == 0:
                out += bytes((0, 0, 0, 0))
                continue
            # Blend white over blue by how much of the pixel the grid covers, then apply the
            # tile's own coverage as alpha so the rounded corners stay smooth.
            w = white_hits / hits
            rgb = tuple(round(BLUE[i] + (WHITE[i] - BLUE[i]) * w) for i in range(3))
            out += bytes((*rgb, round(255 * hits / total)))
    return bytes(out)


def write_png(path: Path, size: int, rgba: bytes) -> bytes:
    """Write a PNG and return its bytes (the .ico embeds the same data)."""
    raw = bytearray()
    stride = size * 4
    for row in range(size):
        raw.append(0)  # filter type 0 (None)
        raw += rgba[row * stride : (row + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    return png


def write_ico(path: Path, entries: list[tuple[int, bytes]]) -> None:
    """Write a .ico containing PNG-compressed entries (supported since Windows Vista)."""
    header = struct.pack("<HHH", 0, 1, len(entries))
    directory = b""
    offset = 6 + 16 * len(entries)
    for size, png in entries:
        # 0 in the width/height byte means 256.
        directory += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0, 0, 1, 32,
            len(png),
            offset,
        )
        offset += len(png)
    path.write_bytes(header + directory + b"".join(png for _, png in entries))


def main() -> None:
    here = Path(__file__).parent
    entries = []
    for size in SIZES:
        rgba = render(size)
        png = write_png(here / f"_icon-{size}.png", size, rgba)
        entries.append((size, png))
        if size == 256:
            write_png(here / "icon.png", size, rgba)

    write_ico(here / "icon.ico", entries)

    # The per-size PNGs exist only to be embedded in the .ico.
    for size in SIZES:
        (here / f"_icon-{size}.png").unlink()

    print(f"Wrote icon.png (256px) and icon.ico ({', '.join(str(s) for s in SIZES)}px)")


if __name__ == "__main__":
    main()
