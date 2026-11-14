"""
Build web/data/safety.json: landing-safety terrain metrics for every polar pad,
from NASA PGDA LOLA products (see pgda.py for the exact files and citations).

For each terrain site (pad position from web/data/sites.json):
  * slope80   NASA LOLA slope map at 80 m/px with its 1-sigma uncertainty:
              value at the pad and statistics over a 500 m radius around it
              (mean, median, p95, p99, share of area < 8 deg / < 10 deg, and the
              conservative share where slope + 1 sigma < 10 deg).
  * slope5    the same at 5 m/px over a 100 m radius (Artemis site size), only
              where one of the six PGDA 5 m site DEMs covers the pad.
  * psr       is the pad inside a permanently shadowed region (20 m/px map),
              PSR share within 500 m, and distance to the nearest PSR pixel
              (searched out to 5 km).
  * grid      slope80 and PSR flag for every point of the 5 x 5 pad grid.

Run after build_data.py:   python pipeline/build_safety.py
Data are fetched as small windows over HTTP and cached in data/raw/pgda_cache/.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgda import Raster, polar_xy  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITES = ROOT / "web" / "data" / "sites.json"
GRID_DIR = ROOT / "web" / "data" / "grid"
OUT = ROOT / "web" / "data" / "safety.json"

AREA_R80_M = 500.0      # area statistics radius on the 80 m slope map
AREA_R5_M = 100.0       # area statistics radius on the 5 m slope maps (~Artemis site)
PSR_SEARCH_M = 5000.0
SITE5 = ["Site01", "Site04", "Site07", "Site11", "Site20", "Site23"]


def disk(shape, centre, radius_px):
    jj, ii = np.indices(shape)
    return np.hypot(jj - centre[0], ii - centre[1]) <= radius_px


def slope_stats(slp, err, x, y, radius_m):
    s, c = slp.window(x, y, radius_m)
    e, _ = err.window(x, y, radius_m)
    m = disk(s.shape, c, radius_m / slp.scale) & np.isfinite(s)
    v = s[m]
    if v.size == 0:
        return None
    ev = np.where(np.isfinite(e[m]), e[m], 0.0)
    r = lambda a: round(float(a), 1)
    return {"pad": r(slp.value(x, y)), "pad_err": r(err.value(x, y)),
            "mean": r(v.mean()), "median": r(np.median(v)),
            "p95": r(np.percentile(v, 95)), "p99": r(np.percentile(v, 99)), "max": r(v.max()),
            "lt8": round(float((v < 8).mean()), 3), "lt10": round(float((v < 10).mean()), 3),
            "lt10_1sigma": round(float(((v + ev) < 10).mean()), 3),
            "err_median": r(np.median(ev)), "n_px": int(v.size), "radius_m": radius_m}


def psr_info(psr, x, y):
    a, c = psr.window(x, y, PSR_SEARCH_M)
    jj, ii = np.indices(a.shape)
    d = np.hypot(jj - c[0], ii - c[1]) * psr.scale
    inside = a > 0.5
    near = d[inside & (d <= PSR_SEARCH_M)]
    return {"pad": bool(psr.value(x, y) > 0.5),
            "share_500m": round(float(inside[d <= AREA_R80_M].mean()), 3),
            "nearest_km": round(float(near.min()) / 1000, 2) if near.size else None,
            "search_km": PSR_SEARCH_M / 1000}


def main():
    t0 = time.time()
    slp80 = Raster("LOLA_20mpp/LDSM_80S_80MPP_ADJ.TIF")
    err80 = Raster("LOLA_20mpp/LDSM_80S_80MPP_ADJ_ERR.TIF")
    psr = Raster("LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF")
    five = {s: (Raster(f"LOLA_5mpp/{s}/{s}_final_adj_5mpp_slp.tif"),
                Raster(f"LOLA_5mpp/{s}/{s}_final_adj_5mpp_slperr.tif")) for s in SITE5}
    data = json.loads(SITES.read_text())
    out = {"area_radius_80m_m": AREA_R80_M, "area_radius_5m_m": AREA_R5_M, "psr_search_km": PSR_SEARCH_M / 1000,
           "sources": {
               "slope80": "NASA GSFC PGDA LOLA LDSM_80S_80MPP_ADJ (+_ERR), Barker et al. 2023, doi:10.3847/PSJ/acf3e1",
               "psr": "NASA GSFC PGDA LOLA LPSR_80S_20MPP_ADJ, Barker et al. 2023, doi:10.3847/PSJ/acf3e1",
               "slope5": "NASA GSFC PGDA LOLA 5 m/px site DEMs (slp, slperr), Barker et al. 2021, doi:10.1016/j.pss.2020.105119"},
           "sites": {}}
    for s in data["sites"]:
        if not s.get("terrain") or s["lat"] > -80.0:
            continue
        x, y = polar_xy(s["lat"], s["lon"])
        rec = {"slope80": slope_stats(slp80, err80, x, y, AREA_R80_M), "psr": psr_info(psr, x, y), "slope5": None}
        for name, (sl, er) in five.items():
            if sl.covers(x, y, margin_px=int(AREA_R5_M / sl.scale) + 1):
                st = slope_stats(sl, er, x, y, AREA_R5_M)
                if st:
                    st["dem"] = name
                    rec["slope5"] = st
                    break
        gfile = GRID_DIR / f"{s['id']}.json"
        if gfile.exists():
            g = json.loads(gfile.read_text())
            cells = []
            for p in g["points"]:
                px, py = polar_xy(p["lat"], p["lon"])
                cells.append({"slope80": round(slp80.value(px, py), 1),
                              "slope80_err": round(err80.value(px, py), 1),
                              "psr": bool(psr.value(px, py) > 0.5)})
            rec["grid"] = cells
        out["sites"][s["id"]] = rec
        s80, s5, p = rec["slope80"], rec["slope5"], rec["psr"]
        print(f"{s['name']:28s} slope80 pad {s80['pad']:4.1f}±{s80['pad_err']:.1f}  p95 {s80['p95']:4.1f}  "
              f"<10° {s80['lt10']:.0%}  | 5m {('%s pad %.1f p95 %.1f' % (s5['dem'], s5['pad'], s5['p95'])) if s5 else '—':28s}"
              f" | PSR pad {p['pad']} near {p['nearest_km']} km  ({time.time() - t0:.0f}s)", flush=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
