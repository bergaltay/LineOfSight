"""
Build web/data/dem_south_480m.bin: a coarse south-polar terrain grid for the browser.

Source: LOLA LDEM_75S_240M, 2x2 block-averaged to 480 m/px and cropped to
300 km around the pole. Stored as little-endian int16 metres above 1737.4 km.
The browser uses it to draw the shaded-relief map and to compute an
approximate horizon for any point the user clicks.

Run from the project root:   python pipeline/build_dem.py
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from horizon import load_dems  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "dem_south_480m.bin"
META = ROOT / "web" / "data" / "dem_south_480m.json"
HALF_PX = 625                      # 625 px * 0.48 km = 300 km half-width


def main():
    _, far = load_dems()           # 3812 px, 240 m, offset 1905.5
    z = far.z.astype(np.float32)
    n2 = far.n // 2                # 1906
    zz = z[:n2 * 2, :n2 * 2].reshape(n2, 2, n2, 2).mean(axis=(1, 3))   # 480 m, offset 952.5
    c = 953                        # first index right of centre (offset 952.5)
    crop = zz[c - HALF_PX:c + HALF_PX, c - HALF_PX:c + HALF_PX]
    m = np.round(crop * 1000).astype("<i2")
    OUT.write_bytes(m.tobytes())
    meta = {"n": int(m.shape[0]), "scale_km": 0.48, "offset_px": HALF_PX - 0.5,
            "radius_km": 1737.4, "units": "m", "dtype": "int16-le",
            "source": "LOLA LDEM_75S_240M, 2x2 mean"}
    META.write_text(json.dumps(meta))
    print(f"wrote {OUT} {m.shape} {OUT.stat().st_size / 1e6:.1f} MB, "
          f"range {m.min()}..{m.max()} m")


if __name__ == "__main__":
    main()
