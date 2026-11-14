"""
Build web/data/shade_south_480m.webp: the shaded-relief image for the south-pole map.

The browser used to compute this image itself from the 3 MB terrain grid, so the
map stayed blank until that file had loaded. Pre-rendering it lets the map (and
site selection on it) appear immediately; the terrain grid is still loaded in
the background for custom points.

The shading is the same as Terrain.prototype.shade() in web/js/terrain.js
(light from azimuth 315 deg, altitude 35 deg, vertical exaggeration x3,
elevation tint), so the image matches what the browser drew before.

Run from the project root, after build_dem.py:   python pipeline/build_shade.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
SRC = DATA / "dem_south_480m.bin"
META = DATA / "dem_south_480m.json"
OUT = DATA / "shade_south_480m.webp"
TINT = (0.92, 0.96, 1.08)          # same tint app.js passed to shade()


def shade(z, scale_km):
    """Return an RGBA uint8 image, transparent on the one-pixel border (as in terrain.js)."""
    n = z.shape[0]
    z = z.astype(np.float64)
    k = 1 / (scale_km * 1000) * 3
    az, alt = np.radians(315), np.radians(35)
    lx, ly, lz = np.cos(alt) * np.sin(az), np.cos(alt) * np.cos(az), np.sin(alt)
    c = z[1:-1, 1:-1]
    dx = (z[1:-1, 2:] - z[1:-1, :-2]) * k / 2
    dy = (z[:-2, 1:-1] - z[2:, 1:-1]) * k / 2
    nz = 1 / np.sqrt(dx * dx + dy * dy + 1)
    v = np.maximum(0, (-dx * lx - dy * ly + lz) * nz)
    e = (c + 7300) / 14600
    g = 30 + 170 * v * (0.75 + 0.25 * e)
    rgba = np.zeros((n, n, 4), dtype=np.uint8)
    for ch in range(3):
        # Uint8ClampedArray rounds half to even; np.rint does the same
        rgba[1:-1, 1:-1, ch] = np.clip(np.rint(g * TINT[ch]), 0, 255)
    rgba[1:-1, 1:-1, 3] = 255
    return rgba


def main():
    meta = json.loads(META.read_text())
    n = meta["n"]
    z = np.fromfile(SRC, dtype="<i2").reshape(n, n)
    img = Image.fromarray(shade(z, meta["scale_km"]), "RGBA")
    img.save(OUT, "WEBP", quality=93, method=6)
    print(f"wrote {OUT.relative_to(ROOT)}  {n}x{n}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
