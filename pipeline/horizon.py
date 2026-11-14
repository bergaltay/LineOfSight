"""
Terrain horizon profiles from LOLA polar stereographic DEMs.

For every azimuth (0.5 deg step) we march outward along the great circle that
leaves the site in that direction, look up the terrain height in the DEM,
place each sample in 3-D (Moon-centred, spherical radius 1737.4 km + height)
and compute its elevation angle above the site's local horizontal plane.
The horizon elevation in that direction is the maximum over all samples.

Because samples are placed on the real sphere, the drop-off caused by lunar
curvature is included automatically (no atmosphere, so no refraction term:
the horizon is purely terrain + sphere geometry, as the challenge notes).

Two DEMs are used:
  * near field  LDEM_80S_80M  (80 m/px, poleward of 80 S, ~304 km radius)
  * far field   LDEM_75S_240M (240 m/px, poleward of 75 S, ~457 km radius)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

R_MOON_KM = 1737.4
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"


@dataclass
class PolarDEM:
    """South-polar stereographic LOLA DEM (heights in km above 1737.4 km)."""
    path: Path
    n: int              # LINES == LINE_SAMPLES
    scale_km: float     # MAP_SCALE
    offset_px: float    # LINE/SAMPLE_PROJECTION_OFFSET
    max_lat: float      # MAXIMUM_LATITUDE (e.g. -80)

    def __post_init__(self):
        self.z = np.fromfile(self.path, dtype="<f4").reshape(self.n, self.n)
        self.rho_max = 2 * R_MOON_KM * math.tan(math.pi / 4 + math.radians(self.max_lat) / 2)

    # --- projection ---------------------------------------------------------
    def latlon_to_px(self, lat, lon):
        lat, lon = np.radians(lat), np.radians(lon)
        rho = 2 * R_MOON_KM * np.tan(np.pi / 4 + lat / 2)
        x, y = rho * np.sin(lon), rho * np.cos(lon)
        sample = self.offset_px + x / self.scale_km
        line = self.offset_px - y / self.scale_km
        return line, sample, rho

    def px_to_latlon(self, line, sample):
        x = (sample - self.offset_px) * self.scale_km
        y = (self.offset_px - line) * self.scale_km
        rho = np.hypot(x, y)
        lat = np.degrees(2 * np.arctan(rho / (2 * R_MOON_KM)) - np.pi / 2)
        lon = np.degrees(np.arctan2(x, y))
        return lat, lon

    def height(self, lat, lon):
        """Bilinear terrain height (km); NaN outside the map."""
        line, sample, rho = self.latlon_to_px(lat, lon)
        h = map_coordinates(self.z, [np.atleast_1d(line), np.atleast_1d(sample)],
                            order=1, mode="constant", cval=np.nan)
        h = np.asarray(h).reshape(np.shape(line))
        h[np.asarray(rho) >= self.rho_max] = np.nan
        return h


def load_dems():
    near = PolarDEM(RAW / "ldem_80s_80m_float.img", 7600, 0.080, 3799.5, -80.0)
    far = PolarDEM(RAW / "ldem_75s_240m_float.img", 3812, 0.240, 1905.5, -75.0)
    return near, far


def _unit(lat, lon):
    lat, lon = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def destination(lat0, lon0, az, dist_km):
    """Great-circle destination points. az, dist_km broadcast against each other."""
    phi1, lam1 = math.radians(lat0), math.radians(lon0)
    th, d = np.radians(az), np.asarray(dist_km) / R_MOON_KM
    phi2 = np.arcsin(np.sin(phi1) * np.cos(d) + np.cos(phi1) * np.sin(d) * np.cos(th))
    lam2 = lam1 + np.arctan2(np.sin(th) * np.sin(d) * np.cos(phi1),
                             np.cos(d) - np.sin(phi1) * np.sin(phi2))
    return np.degrees(phi2), (np.degrees(lam2) + 180) % 360 - 180


def horizon_profile(lat, lon, dems, az_step=0.5, obs_height_m=2.0,
                    near_max_km=250.0, far_max_km=450.0):
    """Return (azimuths, horizon elevation deg, distance to horizon km, site height km)."""
    near, far = dems
    h_site = float(near.height(np.array([lat]), np.array([lon]))[0])
    if np.isnan(h_site):
        h_site = float(far.height(np.array([lat]), np.array([lon]))[0])
    if np.isnan(h_site):
        raise ValueError(f"site {lat},{lon} is outside DEM coverage")

    az = np.arange(0.0, 360.0, az_step)
    # distance samples: dense near the site, ~pixel-sized steps further out
    d_near = np.concatenate([np.arange(0.04, 2.0, 0.04), np.arange(2.0, near_max_km, 0.08)])
    d_far = np.arange(near_max_km, far_max_km, 0.24)

    up = _unit(np.array(lat), np.array(lon))
    site = (R_MOON_KM + h_site + obs_height_m / 1000.0) * up

    best_el = np.full(az.size, -90.0)
    best_d = np.zeros(az.size)
    for dem, dist in ((near, d_near), (far, d_far)):
        for i0 in range(0, az.size, 60):              # chunk to bound memory
            a = az[i0:i0 + 60, None]
            plat, plon = destination(lat, lon, a, dist[None, :])
            h = dem.height(plat, plon)
            if dem is near:                            # fill gaps from far DEM
                miss = np.isnan(h)
                if miss.any():
                    h[miss] = far.height(plat[miss], plon[miss])
            p = (R_MOON_KM + h)[..., None] * _unit(plat, plon)
            v = p - site
            el = np.degrees(np.arcsin(np.clip((v @ up) / np.linalg.norm(v, axis=-1), -1, 1)))
            el = np.where(np.isnan(el), -90.0, el)
            k = el.argmax(axis=1)
            e = el[np.arange(el.shape[0]), k]
            better = e > best_el[i0:i0 + 60]
            best_el[i0:i0 + 60][better] = e[better]
            best_d[i0:i0 + 60][better] = dist[k][better]
    return az, best_el, best_d, h_site


def find_pad(lat, lon, dem, radius_km=1.5, max_slope_deg=8.0):
    """
    Pick a plausible landing pad near a region centre: the highest DEM cell
    within `radius_km` whose local slope is below `max_slope_deg`
    (Artemis landing requirement: slopes < 10 deg). Returns
    (lat, lon, height_km, slope_deg, offset_km) or None.
    """
    line, sample, _ = dem.latlon_to_px(np.array(lat), np.array(lon))
    r = int(math.ceil(radius_km / dem.scale_km)) + 2
    l0, s0 = int(round(float(line))), int(round(float(sample)))
    win = dem.z[l0 - r:l0 + r + 1, s0 - r:s0 + r + 1].astype(float)
    gy, gx = np.gradient(win, dem.scale_km)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    jj, ii = np.mgrid[-r:r + 1, -r:r + 1]
    dist = np.hypot(jj, ii) * dem.scale_km
    ok = (dist <= radius_km) & (slope < max_slope_deg) & np.isfinite(win)
    if not ok.any():
        return None
    cand = np.where(ok, win, -np.inf)
    j, i = np.unravel_index(np.argmax(cand), cand.shape)
    plat, plon = dem.px_to_latlon(l0 - r + j, s0 - r + i)
    return float(plat), float(plon), float(win[j, i]), float(slope[j, i]), float(dist[j, i])


def slope_at(lat, lon, dem):
    """Local terrain slope (deg) from a 3x3 pixel neighbourhood."""
    line, sample, _ = dem.latlon_to_px(np.array(lat), np.array(lon))
    l0, s0 = int(round(float(line))), int(round(float(sample)))
    win = dem.z[l0 - 1:l0 + 2, s0 - 1:s0 + 2].astype(float)
    gy, gx = np.gradient(win, dem.scale_km)
    return float(np.degrees(np.arctan(np.hypot(gx[1, 1], gy[1, 1]))))


def smooth_sphere_horizon(obs_height_m=2.0):
    """Geometric horizon dip for a bare sphere (used where no polar DEM exists)."""
    r = R_MOON_KM
    return -math.degrees(math.acos(r / (r + obs_height_m / 1000.0)))
