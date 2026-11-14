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
from horizon import (load_dems, horizon_profile, smooth_sphere_horizon, find_pad,  # noqa: E402
                     destination, slope_at)
from sites import SITES  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "sites.json"
AZ_STEP = 0.5
OBS_HEIGHT_M = 2.0
PAD_RADIUS_KM = 1.5    # search radius around the published region centre
PAD_MAX_SLOPE = 8.0    # deg; Artemis HLS requires < 10 deg
GRID_N = 5             # pad-nudge grid: GRID_N x GRID_N points centred on the pad
GRID_KM = 1.0          # spacing between grid points
BUILD_GRID = "--no-grid" not in sys.argv
GRID_DIR = OUT.parent / "grid"


def write_grid(sid, plat, plon, dems):
    """Horizons on a GRID_N x GRID_N lattice (km offsets east/north of the pad)."""
    half = GRID_N // 2
    pts = []
    for j in range(half, -half - 1, -1):          # north offsets, top row first
        for i in range(-half, half + 1):          # east offsets
            la, lo = destination(plat, plon, 0.0, j * GRID_KM)
            la, lo = destination(float(la), float(lo), 90.0, i * GRID_KM)
            la, lo = float(la), float(lo)
            _, el, _, h = horizon_profile(la, lo, dems, AZ_STEP, OBS_HEIGHT_M)
            pts.append({"de": i * GRID_KM, "dn": j * GRID_KM, "lat": round(la, 5), "lon": round(lo, 5),
                        "height_km": round(h, 3), "slope_deg": round(slope_at(la, lo, dems[0]), 1),
                        "h100": [int(round(float(v) * 100)) for v in el]})
    GRID_DIR.mkdir(parents=True, exist_ok=True)
    (GRID_DIR / f"{sid}.json").write_text(json.dumps(
        {"n": GRID_N, "spacing_km": GRID_KM, "az_step": AZ_STEP, "points": pts}, separators=(",", ":")))


def main():
    dems = load_dems()
    out = {"az_step": AZ_STEP, "obs_height_m": OBS_HEIGHT_M,
           "dem": ["LOLA LDEM_80S_80M", "LOLA LDEM_75S_240M"], "sites": []}
    for sid, name, lat, lon, group, note, snap in SITES:
        t0 = time.time()
        rec = {"id": sid, "name": name, "lat": lat, "lon": lon, "group": group, "note": note,
               "snapped": snap}
        if lat <= -76.0:
            if snap:
                pad = None
                for radius, max_slope in ((PAD_RADIUS_KM, PAD_MAX_SLOPE), (3.0, PAD_MAX_SLOPE), (3.0, 10.0)):
                    pad = find_pad(lat, lon, dems[0], radius, max_slope)
                    if pad:
                        break
                if pad is None:
                    raise RuntimeError(f"no gentle ground near {name}")
            else:   # actual touchdown point: keep it exactly
                pad = (lat, lon, None, slope_at(lat, lon, dems[0]), 0.0)
            plat, plon, _, pslope, poff = pad
            az, el, dist, h = horizon_profile(plat, plon, dems, AZ_STEP, OBS_HEIGHT_M)
            rec.update(region_lat=lat, region_lon=lon, lat=round(plat, 5), lon=round(plon, 5),
                       pad_slope_deg=round(pslope, 1), pad_offset_km=round(poff, 2),
                       terrain=True, height_km=round(h, 3),
                       horizon=[round(float(v), 3) for v in el],
                       horizon_dist_km=[round(float(v), 1) for v in dist])
            if BUILD_GRID:
                write_grid(sid, plat, plon, dems)
                rec["grid"] = {"n": GRID_N, "spacing_km": GRID_KM}
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
