"""Rasterise the app icon into a multi-resolution Windows .ico and a 1024px .png for macOS.

Run from the project root:

    python resources/make-icon.py

Uses only the Python standard library — no Pillow, no ImageMagick, no npm packages — so
regenerating the icon never needs an install on a machine that is only building a release.

The trade-off is that icon.svg's geometry is duplicated as the constants below: **if you edit
icon.svg, mirror the change here and re-run this script.** Every shape is an axis-aligned
rounded rectangle except the arrowhead, which is an isoceles triangle, so all of them are exact
point-in-shape tests and the whole icon is sampled at 4x4 per pixel.

Windows shows the 16px and 32px entries in Explorer and the taskbar, and the 256px entry in the
installer and large-icon views. macOS takes the .png, which must be at least 512x512.
"""

import struct
import zlib
from pathlib import Path

# ─── Geometry, mirroring icon.svg ─────────────────────────────────────────────

TILE = 64.0  # icon.svg's viewBox is 0 0 64 64
TILE_RADIUS = 11.0
BLUE = (0x00, 0x33, 0xA0)  # Boise State blue
WHITE = (0xFF, 0xFF, 0xFF)

# (x, y, width, height, corner radius) in viewBox units — the same numbers as the <rect>s in
# icon.svg. The table is a solid header bar over two rows of four cells; the last column is
# narrow because it is the points column.
WHITE_RRECTS = [
    (9, 9, 46, 5, 0.8),           # header bar
    (9, 16.5, 13, 6, 0.8),        # row 1
    (24, 16.5, 10, 6, 0.8),
    (36, 16.5, 10, 6, 0.8),
    (48, 16.5, 7, 6, 0.8),
    (9, 25, 13, 6, 0.8),          # row 2
    (24, 25, 10, 6, 0.8),
    (36, 25, 10, 6, 0.8),
    (48, 25, 7, 6, 0.8),
    (29.6, 45.2, 4.8, 8.2, 0.6),  # arrow shaft
    (23, 55, 18, 3.4, 1.5),       # the bar the arrow lifts off
]

# The arrowhead, as its apex and base rather than as three points. An isoceles triangle is
# cheaper and more exact to test by interpolating its half-width down from the apex than by ray
# casting a polygon, and it cannot drift out of agreement with the <path> in icon.svg the way a
# transcribed point list can.
HEAD_APEX_Y, HEAD_BASE_Y = 38.5, 46.3
HEAD_X0, HEAD_X1 = 25.2, 38.8
HEAD_CX = (HEAD_X0 + HEAD_X1) / 2.0
HEAD_HALF = (HEAD_X1 - HEAD_X0) / 2.0

SAMPLES = 4  # 4x4 supersampling per pixel
SIZES = [16, 32, 48, 256]

# macOS rejects an app icon smaller than 512x512, so the .png cannot just be the .ico's largest
# entry — electron-builder fails the Mac build outright with "Icon must be at least 512x512".
# 1024 is Apple's own top size and what it wants for Retina displays.
MAC_PNG_SIZE = 1024


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


def in_rrect(x: float, y: float, x0: float, y0: float, w: float, h: float, r: float) -> bool:
    """Point-in-rounded-rectangle: outside the corner boxes it is a plain bounds check, and
    inside one it is a distance test against that corner's centre."""
    if not (x0 <= x <= x0 + w and y0 <= y <= y0 + h):
        return False
    qx = max(x0 + r - x, x - (x0 + w - r), 0.0)
    qy = max(y0 + r - y, y - (y0 + h - r), 0.0)
    return qx * qx + qy * qy <= r * r


def inside_white(x: float, y: float) -> bool:
    for rect in WHITE_RRECTS:
        if in_rrect(x, y, *rect):
            return True
    # Arrowhead: half-width grows linearly from nothing at the apex to HEAD_HALF at the base.
    if HEAD_APEX_Y <= y <= HEAD_BASE_Y:
        taper = (y - HEAD_APEX_Y) / (HEAD_BASE_Y - HEAD_APEX_Y)
        return abs(x - HEAD_CX) <= HEAD_HALF * taper
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

    write_png(here / "icon.png", MAC_PNG_SIZE, render(MAC_PNG_SIZE))

    write_ico(here / "icon.ico", entries)

    # The per-size PNGs exist only to be embedded in the .ico.
    for size in SIZES:
        (here / f"_icon-{size}.png").unlink()

    print(f"Wrote icon.png ({MAC_PNG_SIZE}px) and icon.ico ({', '.join(str(s) for s in SIZES)}px)")


if __name__ == "__main__":
    main()
