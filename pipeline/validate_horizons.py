"""
Validate pipeline/ephem.py against NASA/JPL Horizons.

Reference values were retrieved from the Horizons API on 2026-11-14 with:
  EPHEM_TYPE=OBSERVER, CENTER='coord@301', COORD_TYPE=GEODETIC,
  SITE_COORD='<E-lon>,<lat>,0', QUANTITIES='4' (apparent AZ/EL, airless),
  START_TIME='2026-11-14 00:00', STEP_SIZE='73 h'
COMMAND='10' (Sun) and '399' (Earth). Rows below are a subset (step index k ->
time = start + 73 h * k).  Columns: k, az_deg, el_deg.
"""
from datetime import datetime, timedelta, timezone

import numpy as np

from ephem import sun_earth

START = datetime(2026, 11, 14, tzinfo=timezone.utc)
STEP = timedelta(hours=73)

SITES = {
    "ridge":    (-89.45, -137.31),   # Shackleton connecting ridge
    "apollo11": (0.674, 23.473),
    "malapert": (-86.0, 0.0),
}

REF = {
    ("ridge", "sun"): [(0, 263.912878, 1.498352), (10, 253.912542, 1.227157),
                       (20, 244.098945, 0.536869), (30, 234.190348, -0.383063),
                       (40, 223.946605, -1.265527), (60, 202.037159, -2.029772),
                       (80, 178.722311, -1.082660), (100, 155.686012, 0.538483),
                       (120, 134.432773, 1.125191)],
    ("ridge", "earth"): [(0, 136.051931, -5.044210), (10, 132.330243, -0.865012),
                         (20, 130.138208, 3.579942), (30, 130.729077, 6.099224),
                         (40, 133.975380, 4.880621), (60, 141.628752, -4.811188),
                         (80, 142.294250, -6.307250), (100, 135.743896, 1.719002),
                         (120, 132.693095, 5.744977)],
    ("apollo11", "sun"): [(0, 91.441764, -13.158066), (10, 91.345197, -3.157377),
                          (20, 90.861933, 6.667410), (30, 90.137645, 16.593282),
                          (40, 89.367345, 26.849019), (60, 88.464246, 48.751413),
                          (80, 90.354186, 72.060760), (100, 251.424234, 84.619612),
                          (120, 265.247338, 63.552352)],
    ("apollo11", "earth"): [(0, 279.017761, 64.944411), (10, 269.274777, 61.429725),
                            (20, 260.723340, 58.835386), (30, 255.687132, 58.931112),
                            (40, 256.634282, 62.360488), (60, 280.522057, 70.495621),
                            (80, 285.422449, 70.844267), (100, 263.018111, 64.663447),
                            (120, 255.475648, 60.920017)],
    ("malapert", "sun"): [(0, 126.637856, -0.830469), (10, 116.644756, -0.413960),
                          (20, 106.807959, -0.379548), (30, 96.857832, -0.539790),
                          (40, 86.577185, -0.632420), (60, 64.678822, 0.190069),
                          (80, 41.457206, 2.466573), (100, 18.437737, 4.835238),
                          (120, 357.101354, 5.505113)],
    ("malapert", "earth"): [(0, 358.776239, -0.649972), (10, 355.012722, 3.490704),
                            (20, 352.744278, 7.904534), (30, 353.300188, 10.433757),
                            (40, 356.597148, 9.257923), (60, 4.333390, -0.392285),
                            (80, 4.996484, -1.888633), (100, 358.410964, 6.112643),
                            (120, 355.291117, 10.107164)],
}


def angdiff(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def main():
    rows = []
    for (site, body), refs in REF.items():
        lat, lon = SITES[site]
        for k, az_ref, el_ref in refs:
            s, e = sun_earth(lat, lon, START + k * STEP)
            p = s if body == "sun" else e
            d_el = p.el - el_ref
            # azimuth error expressed as angle on the sky (shrinks near zenith)
            d_az = angdiff(p.az, az_ref) * np.cos(np.radians(el_ref))
            rows.append((site, body, k, d_az, d_el))
            print(f"{site:9s} {body:5s} k={k:3d}  dAz*cos(el)={d_az:+.4f}  dEl={d_el:+.4f}")
    arr = np.array([[r[3], r[4]] for r in rows])
    print("\nmax |dAz*cos(el)| = %.4f deg   max |dEl| = %.4f deg   rms dEl = %.4f deg"
          % (np.abs(arr[:, 0]).max(), np.abs(arr[:, 1]).max(),
             np.sqrt((arr[:, 1] ** 2).mean())))


if __name__ == "__main__":
    main()
