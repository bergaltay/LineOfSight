/*
 * Lunar surface ephemeris + visibility metrics (browser & Node).
 * Mirrors pipeline/ephem.py, validated against JPL Horizons (max error ~0.003 deg).
 *
 * Depends on astronomy-engine (global `Astronomy` in the browser).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../vendor/astronomy.browser.min.js"));
  } else {
    root.LunarEphem = factory(root.Astronomy);
  }
})(typeof self !== "undefined" ? self : this, function (A) {
  "use strict";

  const R_MOON = 1737.4;          // km
  const AU = 149597870.7;         // km
  const SUN_RADIUS_KM = 695700;
  const EARTH_RADIUS_KM = 6371;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => Math.sqrt(dot(a, a));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vec = (v) => [v.x * AU, v.y * AU, v.z * AU];

  function matMul(m, v) {
    return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
  }
  function mm(a, b) {
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
    return r;
  }
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
  const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; };

  /** EQJ -> Moon body-fixed rotation (IAU lunar rotation model with librations). */
  function moonFixed(t) {
    const ax = A.RotationAxis(A.Body.Moon, t);
    return mm(rotZ(ax.spin * D2R), mm(rotX(Math.PI / 2 - ax.dec * D2R), rotZ(Math.PI / 2 + ax.ra * 15 * D2R)));
  }

  function siteFrame(latDeg, lonDeg, heightKm) {
    const la = latDeg * D2R, lo = lonDeg * D2R;
    const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    const up = [cl * co, cl * so, sl];
    const r = R_MOON + (heightKm || 0);
    return { pos: [r * up[0], r * up[1], r * up[2]], up,
             east: [-so, co, 0], north: [-sl * co, -sl * so, cl] };
  }

  function azel(v, f) {
    const d = sub(v, f.pos), n = norm(d);
    const e = dot(d, f.east) / n, no = dot(d, f.north) / n, z = dot(d, f.up) / n;
    let az = Math.atan2(e, no) * R2D; if (az < 0) az += 360;
    return { az, el: Math.asin(Math.max(-1, Math.min(1, z))) * R2D, dist: n };
  }

  /** Topocentric Sun & Earth for one site and one Date (UTC). */
  function sunEarth(latDeg, lonDeg, date, heightKm) {
    const t = A.MakeTime(date);
    const moon = vec(A.GeoMoon(t));
    const sun = vec(A.GeoVector(A.Body.Sun, t, true));
    const R = moonFixed(t);
    const f = siteFrame(latDeg, lonDeg, heightKm);
    const s = azel(matMul(R, sub(sun, moon)), f);
    const e = azel(matMul(R, [-moon[0], -moon[1], -moon[2]]), f);
    s.radius = Math.asin(SUN_RADIUS_KM / s.dist) * R2D;
    e.radius = Math.asin(EARTH_RADIUS_KM / e.dist) * R2D;
    return { sun: s, earth: e };
  }

  /** Horizon elevation at an azimuth (linear interpolation of the profile). */
  function horizonAt(profile, azStep, az) {
    const n = profile.length;
    const x = ((az % 360) + 360) % 360 / azStep;
    const i = Math.floor(x), f = x - i;
    return profile[i % n] * (1 - f) + profile[(i + 1) % n] * f;
  }

  /** Fraction of a disc of angular radius r whose centre is h deg above the horizon line. */
  function discFraction(h, r) {
    if (h >= r) return 1;
    if (h <= -r) return 0;
    const d = h / r;                           // signed centre offset in radii
    return 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
  }

  function visibility(body, profile, azStep) {
    const hz = horizonAt(profile, azStep, body.az);
    const clearance = body.el - hz;
    return { horizon: hz, clearance, fraction: discFraction(clearance, body.radius) };
  }

  /**
   * Sample a site over a time window.
   * Returns per-step arrays and summary metrics for power (Sun) and comms (Earth).
   */
  function timeline(site, start, hours, stepMin) {
    stepMin = stepMin || 60;
    const n = Math.floor(hours * 60 / stepMin) + 1;
    const azStep = site.azStep;
    const t0 = start.getTime();
    const rows = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(t0 + i * stepMin * 60000);
      const p = sunEarth(site.lat, site.lon, d, site.height_km || 0);
      const vs = visibility(p.sun, site.horizon, azStep);
      const ve = visibility(p.earth, site.horizon, azStep);
      rows.push({ t: d, sun: p.sun, earth: p.earth, sunVis: vs, earthVis: ve,
                  sunUp: vs.fraction > 0.5, earthUp: ve.fraction > 0.5 });
    }
    return { rows, stepMin, summary: summarize(rows, stepMin) };
  }

  function longestRun(rows, pred, stepMin) {
    let best = 0, cur = 0;
    for (const r of rows) { if (pred(r)) { cur++; best = Math.max(best, cur); } else cur = 0; }
    return best * stepMin / 60;               // hours
  }

  function summarize(rows, stepMin) {
    const n = rows.length;
    const cnt = (p) => rows.filter(p).length / n;
    const sunFrac = rows.reduce((a, r) => a + r.sunVis.fraction, 0) / n;
    const sunEls = rows.filter((r) => r.sunUp).map((r) => r.sun.el);
    return {
      sunPct: 100 * cnt((r) => r.sunUp),
      sunDiscPct: 100 * sunFrac,
      earthPct: 100 * cnt((r) => r.earthUp),
      bothPct: 100 * cnt((r) => r.sunUp && r.earthUp),
      longestDarkH: longestRun(rows, (r) => !r.sunUp, stepMin),
      longestNoCommsH: longestRun(rows, (r) => !r.earthUp, stepMin),
      meanSunElWhenUp: sunEls.length ? sunEls.reduce((a, b) => a + b, 0) / sunEls.length : null,
      maxSunEl: Math.max(...rows.map((r) => r.sun.el)),
    };
  }

  /** Next change of state (set or rise) for 'sunUp' / 'earthUp' after index i, in hours. */
  function nextChange(tl, i, key) {
    const rows = tl.rows, s = rows[i][key];
    for (let j = i + 1; j < rows.length; j++)
      if (rows[j][key] !== s) return { hours: (j - i) * tl.stepMin / 60, toState: rows[j][key], at: rows[j].t };
    return null;
  }

  return { sunEarth, horizonAt, discFraction, visibility, timeline, summarize, nextChange, R_MOON };
});
