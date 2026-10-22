#!/usr/bin/env python3
"""The feed's avatars: 64x64 PNGs drawn here, not photographs (the real posts' avatars are remote files).

A disc in the author's hue with a darker shoulder shape, deterministic from the handle, so a feed row's avatar is a
committed asset with no network and no licence. Run from the repo root: python3 examples/sky/avatars.py
"""
import struct, zlib

W = H = 64
AUTHORS = {
    # handle: (r, g, b), at the hues the app's avatar ring uses
    "michaelwarburton.bsky.social": (74, 132, 214),
    "titaniasrealm.bsky.social": (216, 150, 60),
    "alexjungle.bsky.social": (86, 168, 120),
    "erikstrub.bsky.social": (126, 108, 200),
    "davidbflower.bsky.social": (70, 160, 176),
    "bittelmethis.bsky.social": (200, 96, 120),
}


def png(path, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    open(path, "wb").write(out + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def avatar(path, hue):
    r, g, b = hue
    rows = []
    for y in range(H):
        row = []
        for x in range(W):
            dx, dy = x - 31.5, y - 31.5
            d = (dx * dx + dy * dy) ** 0.5
            if d > 31:  # outside the disc: transparent
                row += [0, 0, 0, 0]
            elif d > 29.5:  # a rim a shade darker
                row += [int(r * 0.8), int(g * 0.8), int(b * 0.8), 255]
            elif ((x - 31.5) / 13) ** 2 + ((y - 25.5) / 13) ** 2 < 1:  # the head
                row += [min(255, int(r * 1.35)), min(255, int(g * 1.35)), min(255, int(b * 1.35)), 255]
            elif ((x - 31.5) / 21) ** 2 + ((y - 62) / 20) ** 2 < 1:  # the shoulders
                row += [int(r * 0.92), int(g * 0.92), int(b * 0.92), 255]
            else:
                row += [int(r), int(g), int(b), 255]
        rows.append(row)
    png(path, rows)


for handle, hue in AUTHORS.items():
    avatar(f"examples/sky/{handle.split('.')[0]}.png", hue)
    print(f"examples/sky/{handle.split('.')[0]}.png")
