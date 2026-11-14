"""
Sun and Earth topocentric azimuth / elevation as seen from a point on the Moon.

Method
------
* Geocentric Sun and Moon vectors (J2000 equatorial, EQJ) from astronomy-engine
  (VSOP87 for the Sun/Earth, ELP/MPP02-derived series for the Moon).
* Moon orientation from the IAU WGCCRE lunar rotation model (pole RA/Dec and
  prime-meridian angle W, including the physical libration terms), giving the
  body-fixed frame used by LOLA (differences from the DE421 Mean-Earth frame
  are at the ~0.01 deg level, checked in validate_horizons.py).
* Vectors are re-centred on the surface site (topocentric parallax matters for
  Earth: up to ~0.26 deg), rotated into local East-North-Up, and converted to
  azimuth (deg, from North through East) and elevation (deg above the local
  geometric horizontal plane, i.e. a smooth sphere with no terrain).

The same math is mirrored in web/js/ephem.js so the browser can compute any
date and any coordinate live.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
import astronomy as ae

R_MOON_KM = 1737.4
AU_KM = 149_597_870.7


def _vec(v) -> np.ndarray:
    return np.array([v.x, v.y, v.z]) * AU_KM


def _rot_x(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])


def _rot_z(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])


def eqj_to_moon_fixed(t: ae.Time) -> np.ndarray:
    """Rotation matrix EQJ -> Moon body-fixed (IAU convention)."""
    axis = ae.RotationAxis(ae.Body.Moon, t)
    ra = math.radians(axis.ra * 15.0)       # astronomy-engine gives RA in hours
    dec = math.radians(axis.dec)
    w = math.radians(axis.spin)
    return _rot_z(w) @ _rot_x(math.pi / 2 - dec) @ _rot_z(math.pi / 2 + ra)


def site_vectors(lat_deg: float, lon_deg: float, height_km: float = 0.0):
    """Body-fixed site position (km) and its local East/North/Up unit vectors."""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    cl, sl, co, so = math.cos(lat), math.sin(lat), math.cos(lon), math.sin(lon)
    up = np.array([cl * co, cl * so, sl])
    east = np.array([-so, co, 0.0])
    north = np.array([-sl * co, -sl * so, cl])
    return (R_MOON_KM + height_km) * up, east, north, up


@dataclass
class SkyPos:
    az: float   # deg, 0 = North, 90 = East
    el: float   # deg above the local geometric horizontal
    dist_km: float


def _azel(vec_fixed, site, east, north, up) -> SkyPos:
    d = vec_fixed - site
    dist = float(np.linalg.norm(d))
    u = d / dist
    e, n, z = float(u @ east), float(u @ north), float(u @ up)
    az = math.degrees(math.atan2(e, n)) % 360.0
    el = math.degrees(math.asin(max(-1.0, min(1.0, z))))
    return SkyPos(az, el, dist)


def to_time(dt: datetime) -> ae.Time:
    dt = dt.astimezone(timezone.utc)
    return ae.Time.Make(dt.year, dt.month, dt.day, dt.hour, dt.minute,
                        dt.second + dt.microsecond / 1e6)


def sun_earth(lat_deg: float, lon_deg: float, when: datetime,
              height_km: float = 0.0) -> tuple[SkyPos, SkyPos]:
    """Topocentric Sun and Earth positions for one site and one UTC instant."""
    t = to_time(when)
    moon_geo = _vec(ae.GeoMoon(t))                      # Earth -> Moon
    sun_geo = _vec(ae.GeoVector(ae.Body.Sun, t, True))  # Earth -> Sun (apparent)
    sun_from_moon = sun_geo - moon_geo
    earth_from_moon = -moon_geo
    rot = eqj_to_moon_fixed(t)
    site, east, north, up = site_vectors(lat_deg, lon_deg, height_km)
    return (_azel(rot @ sun_from_moon, site, east, north, up),
            _azel(rot @ earth_from_moon, site, east, north, up))


def series(lat_deg: float, lon_deg: float, start: datetime, stop: datetime,
           step: timedelta, height_km: float = 0.0):
    """Arrays (times, sun_az, sun_el, earth_az, earth_el) for a time range."""
    times, out = [], []
    t = start
    while t <= stop:
        s, e = sun_earth(lat_deg, lon_deg, t, height_km)
        times.append(t)
        out.append((s.az, s.el, e.az, e.el))
        t += step
    arr = np.array(out)
    return times, arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]


if __name__ == "__main__":
    now = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    for name, lat, lon in [("Shackleton rim (Connecting Ridge)", -89.45, -137.31),
                           ("Apollo 11", 0.674, 23.473)]:
        s, e = sun_earth(lat, lon, now)
        print(f"{name:35s} Sun az={s.az:7.2f} el={s.el:6.2f} | "
              f"Earth az={e.az:7.2f} el={e.el:6.2f}  dist={e.dist_km:,.0f} km")
