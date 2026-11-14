/*
 * Coarse south-polar terrain in the browser (LOLA, 480 m/px, 300 km around the pole).
 * - height(lat, lon): bilinear terrain height in km
 * - horizon(lat, lon): 360 deg skyline (same method as pipeline/horizon.py, coarser grid)
 * - project / unproject: polar stereographic <-> map pixels
 * - shade(): shaded-relief image as an ImageData-ready Uint8ClampedArray
 */
(function (root) {
  "use strict";
  const R = 1737.4, D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function Terrain(meta, buf) {
    this.n = meta.n; this.scale = meta.scale_km; this.off = meta.offset_px;
    this.z = new Int16Array(buf);
    this.rhoMax = (this.n / 2 - 1) * this.scale;
  }

  Terrain.load = async function (base) {
    const meta = await (await fetch(base + ".json")).json();
    const buf = await (await fetch(base + ".bin")).arrayBuffer();
    return new Terrain(meta, buf);
  };

  /** lat/lon (deg) -> fractional pixel [line, sample] and stereographic radius (km). */
  Terrain.prototype.project = function (lat, lon) {
    const rho = 2 * R * Math.tan(Math.PI / 4 + lat * D2R / 2);
    const x = rho * Math.sin(lon * D2R), y = rho * Math.cos(lon * D2R);
    return { line: this.off - y / this.scale, sample: this.off + x / this.scale, rho, x, y };
  };

  Terrain.prototype.unproject = function (line, sample) {
    const x = (sample - this.off) * this.scale, y = (this.off - line) * this.scale;
    const rho = Math.hypot(x, y);
    return { lat: (2 * Math.atan(rho / (2 * R)) - Math.PI / 2) * R2D, lon: Math.atan2(x, y) * R2D, rho };
  };

  Terrain.prototype.covers = function (lat, lon) {
    return lat < -60 && this.project(lat, lon).rho < this.rhoMax - 2;
  };

  /** Bilinear height in km (NaN outside). */
  Terrain.prototype.heightPx = function (l, s) {
    const n = this.n;
    if (!(l >= 0 && s >= 0 && l < n - 1 && s < n - 1)) return NaN;
    const l0 = l | 0, s0 = s | 0, fl = l - l0, fs = s - s0, z = this.z, i = l0 * n + s0;
    return ((z[i] * (1 - fs) + z[i + 1] * fs) * (1 - fl) + (z[i + n] * (1 - fs) + z[i + n + 1] * fs) * fl) / 1000;
  };
  Terrain.prototype.height = function (lat, lon) {
    const p = this.project(lat, lon); return this.heightPx(p.line, p.sample);
  };

  /** 360 deg skyline at azStep resolution for an observer obsM metres above the ground. */
  Terrain.prototype.horizon = function (lat, lon, azStep, obsM) {
    azStep = azStep || 0.5; obsM = obsM || 2;
    const hs = this.height(lat, lon);
    if (isNaN(hs)) return null;
    const la = lat * D2R, lo = lon * D2R, cl = Math.cos(la), sl = Math.sin(la);
    const up = [cl * Math.cos(lo), cl * Math.sin(lo), sl];
    const rs = R + hs + obsM / 1000;
    const site = [rs * up[0], rs * up[1], rs * up[2]];
    // distance samples: ~one per pixel near the site, a bit sparser far away
    const dists = [];
    for (let d = 0.4; d < 300; d += d < 30 ? 0.25 : 0.48) dists.push(d);   // start 0.4 km: best match to the 80 m pipeline (rms 0.6 deg)
    const nAz = Math.round(360 / azStep), out = new Float32Array(nAz);
    const sinD = dists.map((d) => Math.sin(d / R)), cosD = dists.map((d) => Math.cos(d / R));
    for (let k = 0; k < nAz; k++) {
      const th = k * azStep * D2R, ct = Math.cos(th), st = Math.sin(th);
      let best = -90;
      for (let j = 0; j < dists.length; j++) {
        // great-circle destination
        const sp2 = sl * cosD[j] + cl * sinD[j] * ct;
        const p2 = Math.asin(sp2);
        const l2 = lo + Math.atan2(st * sinD[j] * cl, cosD[j] - sl * sp2);
        const lat2 = p2 * R2D, lon2 = l2 * R2D;
        const h = this.height(lat2, lon2);
        if (isNaN(h)) break;                        // left the map
        const r = R + h, c2 = Math.cos(p2);
        const vx = r * c2 * Math.cos(l2) - site[0], vy = r * c2 * Math.sin(l2) - site[1], vz = r * sp2 - site[2];
        const e = Math.asin((vx * up[0] + vy * up[1] + vz * up[2]) / Math.hypot(vx, vy, vz)) * R2D;
        if (e > best) best = e;
      }
      out[k] = best;
    }
    return { horizon: Array.from(out), height_km: hs };
  };

  /** Shaded relief (light from the upper left, slightly exaggerated). Returns RGBA bytes. */
  Terrain.prototype.shade = function (tint) {
    const n = this.n, z = this.z, px = new Uint8ClampedArray(n * n * 4);
    const k = 1 / (this.scale * 1000) * 3;          // vertical exaggeration x3
    const az = 315 * D2R, alt = 35 * D2R;
    const lx = Math.cos(alt) * Math.sin(az), ly = Math.cos(alt) * Math.cos(az), lz = Math.sin(alt);
    for (let l = 1; l < n - 1; l++) for (let s = 1; s < n - 1; s++) {
      const i = l * n + s;
      const dx = (z[i + 1] - z[i - 1]) * k / 2, dy = (z[i - n] - z[i + n]) * k / 2;
      const nz = 1 / Math.hypot(dx, dy, 1);
      let v = (-dx * lx - dy * ly + lz) * nz;
      v = Math.max(0, v);
      const e = (z[i] + 7300) / 14600;              // elevation tint
      const g = 30 + 170 * v * (0.75 + 0.25 * e);
      const o = i * 4;
      px[o] = g * tint[0]; px[o + 1] = g * tint[1]; px[o + 2] = g * tint[2]; px[o + 3] = 255;
    }
    return px;
  };

  root.LunarTerrain = Terrain;
})(typeof self !== "undefined" ? self : this);
