"""
Build web/data/sites.json: site metadata + 360 deg terrain horizon profiles.

Run from the project root:   python pipeline/build_data.py
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from horizon import load_dems, horizon_profile, smooth_sphere_horizon, find_pad  # noqa: E402
from sites import SITES  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "sites.json"
AZ_STEP = 0.5
OBS_HEIGHT_M = 2.0
PAD_RADIUS_KM = 1.5    # search radius around the published region centre
PAD_MAX_SLOPE = 8.0    # deg; Artemis HLS requires < 10 deg


def main():
    dems = load_dems()
    out = {"az_step": AZ_STEP, "obs_height_m": OBS_HEIGHT_M,
           "dem": ["LOLA LDEM_80S_80M", "LOLA LDEM_75S_240M"], "sites": []}
    for sid, name, lat, lon, group, note in SITES:
        t0 = time.time()
        rec = {"id": sid, "name": name, "lat": lat, "lon": lon, "group": group, "note": note}
        if lat <= -76.0:
            pad = None
            for radius, max_slope in ((PAD_RADIUS_KM, PAD_MAX_SLOPE), (3.0, PAD_MAX_SLOPE), (3.0, 10.0)):
                pad = find_pad(lat, lon, dems[0], radius, max_slope)
                if pad:
                    break
            if pad is None:
                raise RuntimeError(f"no gentle ground near {name}")
            plat, plon, _, pslope, poff = pad
            az, el, dist, h = horizon_profile(plat, plon, dems, AZ_STEP, OBS_HEIGHT_M)
            rec.update(region_lat=lat, region_lon=lon, lat=round(plat, 5), lon=round(plon, 5),
                       pad_slope_deg=round(pslope, 1), pad_offset_km=round(poff, 2),
                       terrain=True, height_km=round(h, 3),
                       horizon=[round(float(v), 3) for v in el],
                       horizon_dist_km=[round(float(v), 1) for v in dist])
            print(f"{name:28s} pad {plat:.4f},{plon:.4f} ({poff:.2f} km from centre, slope {pslope:.1f}) "
                  f"h={h:+.3f} km  horizon {el.min():+.2f}..{el.max():+.2f} median {np.median(el):+.2f}"
                  f"  ({time.time() - t0:.1f}s)")
        else:
            dip = smooth_sphere_horizon(OBS_HEIGHT_M)
            rec.update(terrain=False, height_km=None,
                       horizon=[round(dip, 3)] * int(360 / AZ_STEP), horizon_dist_km=None)
            print(f"{name:32s} (no polar DEM, bare-sphere horizon {dip:.3f} deg)")
        out["sites"].append(rec)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
