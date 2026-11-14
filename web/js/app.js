/* Lunar Landing Site Navigator — UI */
(function () {
  "use strict";
  const E = window.LunarEphem;
  const HOURS = 720;              // 30-day window after landing
  const STEP_MIN = 60;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const C = {};
  ["--sun", "--earth", "--both", "--dark", "--rim", "--dust", "--regolith", "--terrain-top", "--terrain-bottom", "--night"]
    .forEach((k) => (C[k.slice(2)] = css(k)));

  let DATA = null, TERRAIN = null, SHADE = null;
  let met = 0;                    // hours after landing (shared by A and B)
  let timer = null;
  const S = {};                   // scenario state keyed by "A" / "B"
  const GRIDS = {};               // site id -> grid data (or pending promise)
  const CACHE = new Map();        // memoised heavy computations

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const fmtPct = (v) => `${Math.round(v)}%`;
  const fmtH = (h) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${Math.round(h)} h`);
  const fmtDeg = (v, sign) => `${sign && v > 0 ? "+" : ""}${v.toFixed(2)}°`;
  function fmtCountdown(h) {
    const d = Math.floor(h / 24), hh = Math.round(h - d * 24);
    return d > 0 ? `${d} d ${hh} h` : `${hh} h`;
  }
  const isoDate = (d) => d.toISOString().slice(0, 10);
  const isoHour = (d) => d.toISOString().slice(11, 16);
  const dirName = (az) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(az / 45) % 8];
  const offName = (i, j) => [j ? `${Math.abs(j)} km ${j > 0 ? "N" : "S"}` : "", i ? `${Math.abs(i)} km ${i > 0 ? "E" : "W"}` : ""]
    .filter(Boolean).join(", ") || "the pad";
  const later = (fn) => setTimeout(fn, 0);

  function siteById(id) { return DATA.sites.find((s) => s.id === id); }

  function sphereHorizon() {
    const dip = -Math.acos(E.R_MOON / (E.R_MOON + DATA.obs_height_m / 1000)) * 180 / Math.PI;
    return new Array(360 / DATA.az_step).fill(dip);
  }

  /** The effective site for a scenario: base site, a nudged grid point, or a custom point. */
  function siteForScenario(sc) {
    if (sc.siteId === "custom") {
      const name = `Custom point (${sc.lat.toFixed(3)}°, ${sc.lon.toFixed(3)}°)`;
      if (sc.customHz) return { id: "custom", name, lat: sc.lat, lon: sc.lon, terrain: "coarse",
        height_km: sc.customHz.height_km, horizon: sc.customHz.horizon, azStep: DATA.az_step };
      return { id: "custom", name, lat: sc.lat, lon: sc.lon, terrain: false, height_km: 0,
        horizon: sphereHorizon(), azStep: DATA.az_step };
    }
    const base = siteById(sc.siteId);
    const g = GRIDS[sc.siteId];
    if (base.grid && g && !g.then && (sc.off.i || sc.off.j)) {
      const p = gridPoint(g, sc.off.i, sc.off.j);
      return { ...base, lat: p.lat, lon: p.lon, height_km: p.height_km, slope_deg: p.slope_deg,
               horizon: p.h100.map((v) => v / 100), azStep: g.az_step, nudged: true };
    }
    return { ...base, slope_deg: base.pad_slope_deg, azStep: DATA.az_step };
  }

  function gridPoint(g, i, j) {
    const half = (g.n - 1) / 2;
    return g.points[(half - j) * g.n + (i + half)];
  }

  function loadGrid(id) {
    if (GRIDS[id]) return Promise.resolve(GRIDS[id]);
    GRIDS[id] = fetch(`data/grid/${id}.json`).then((r) => r.json()).then((g) => (GRIDS[id] = g));
    return GRIDS[id];
  }

  // ---------- compute ----------
  function recompute(key) {
    const sc = S[key];
    sc.site = siteForScenario(sc);
    sc.tl = E.timeline(sc.site, sc.landing, HOURS, STEP_MIN);
  }

  function memo(key, fn) {
    if (!CACHE.has(key)) CACHE.set(key, fn());
    return CACHE.get(key);
  }

  // ---------- render: scenario cards ----------
  function renderCard(key) {
    const sc = S[key], el = sc.el, site = sc.site;
    const note = $(".note", el);
    note.classList.toggle("warn", !site.terrain);
    if (site.id === "custom") {
      note.textContent = site.terrain
        ? `Custom point, ${site.height_km >= 0 ? "+" : ""}${site.height_km.toFixed(2)} km. Skyline computed in your browser from 480 m terrain: typically within 0.6° of the full 80 m model, so treat values close to the line with care.`
        : "Custom point outside the polar terrain map: the horizon is modelled as a smooth sphere.";
    } else if (!site.terrain) {
      note.textContent = `${site.note} Outside the polar terrain maps: horizon modelled as a smooth sphere.`;
    } else {
      const where = site.nudged ? `Pad moved ${offName(sc.off.i, sc.off.j)}`
        : site.snapped ? `Landing pad ${site.pad_offset_km.toFixed(1)} km from NASA's region centre` : "Actual touchdown point";
      note.textContent = `${site.note} ${where}: ${site.slope_deg.toFixed(1)}° slope, ` +
        `${site.height_km >= 0 ? "+" : ""}${site.height_km.toFixed(2)} km elevation.`;
    }

    const i = Math.min(met, sc.tl.rows.length - 1), r = sc.tl.rows[i];
    const neverEarth = sc.tl.rows.every((x) => x.earth.el < -2);
    for (const [body, upKey, vis] of [["sun", "sunUp", "sunVis"], ["earth", "earthUp", "earthVis"]]) {
      const box = $(`.body.${body}`, el), up = r[upKey];
      box.classList.toggle("off", !up);
      const nc = E.nextChange(sc.tl, i, upKey);
      $(".state", box).textContent = body === "sun"
        ? (up ? "Sunlit: solar power" : "In shadow: on battery")
        : (up ? "Earth in view: direct radio" : neverEarth ? "Earth never rises: relay needed" : "Earth hidden: no direct radio");
      $(".count", box).textContent = nc
        ? `${body === "sun" ? (up ? "Sunset" : "Sunrise") : (up ? "Earthset" : "Earthrise")} in ${fmtCountdown(nc.hours)}`
        : `${up ? "Stays up" : "Stays down"} for the rest of the 30 days`;
      const p = r[body];
      $(".elev", box).textContent = fmtDeg(p.el);
      $(".clear", box).textContent = fmtDeg(r[vis].clearance, true);
      $(".pos", box).textContent = `Azimuth ${p.az.toFixed(1)}° (${dirName(p.az)}), skyline ${fmtDeg(r[vis].horizon)}, ` +
        `${Math.round(r[vis].fraction * 100)}% of disc visible`;
    }
    renderStats(key);
  }

  const STATS = [
    ["sunPct", "Time in sunlight", fmtPct, 1],
    ["earthPct", "Time Earth in view", fmtPct, 1],
    ["bothPct", "Power and Earth link", fmtPct, 1],
    ["longestDarkH", "Longest darkness", fmtH, -1],
    ["longestNoCommsH", "Longest radio gap", fmtH, -1],
    ["meanSunElWhenUp", "Average Sun height", (v) => (v == null ? "–" : `${v.toFixed(1)}°`), 1],
  ];

  function renderStats(key) {
    const sm = S[key].tl.summary, other = key === "B" ? S.A.tl.summary : null;
    const dl = $(".stats", S[key].el);
    dl.innerHTML = "";
    for (const [k, label, fmt, goodDir] of STATS) {
      const div = document.createElement("div");
      let delta = "";
      if (other && sm[k] != null && other[k] != null) {
        const d = sm[k] - other[k];
        const unit = k.endsWith("H") ? "h" : k === "meanSunElWhenUp" ? "°" : " pts";
        if (Math.abs(d) >= (unit === "°" ? 0.05 : 0.5)) {
          const cls = d * goodDir > 0 ? "up" : "down";
          delta = `<span class="delta ${cls}" title="Compared with plan A">${d > 0 ? "+" : "−"}${unit === "°" ? Math.abs(d).toFixed(1) : Math.round(Math.abs(d))}${unit}</span>`;
        }
      }
      div.innerHTML = `<dt>${label}</dt><dd>${fmt(sm[k])}${delta}</dd>`;
      dl.appendChild(div);
    }
  }

  // ---------- render: pad nudge grid ----------
  function gridSummaries(sc, g) {
    const key = `grid|${sc.siteId}|${sc.landing.getTime()}`;
    return memo(key, () => g.points.map((p) => {
      const s = { lat: p.lat, lon: p.lon, height_km: p.height_km, azStep: g.az_step, horizon: p.h100.map((v) => v / 100) };
      return E.timeline(s, sc.landing, HOURS, 120).summary;
    }));
  }

  function renderNudge(key) {
    const sc = S[key], box = $(".nudge", sc.el), base = sc.siteId !== "custom" && siteById(sc.siteId);
    if (!base || !base.grid) { box.hidden = true; return; }
    box.hidden = false;
    const g = GRIDS[sc.siteId];
    const gridEl = $(".grid", box), text = $(".nudge-text", box);
    if (!g || g.then) {
      gridEl.innerHTML = ""; text.textContent = "Loading nearby terrain…";
      loadGrid(sc.siteId).then(() => { recompute(key); renderAll(); });
      return;
    }
    const metric = $(".metric input:checked", box).value;
    const sums = gridSummaries(sc, g);
    const color = metric === "sunPct" ? C.sun : metric === "earthPct" ? C.earth : C.both;
    const half = (g.n - 1) / 2;
    gridEl.style.gridTemplateColumns = `repeat(${g.n}, 1fr)`;
    gridEl.innerHTML = "";
    let best = null;
    g.points.forEach((p, k) => {
      const i = p.de / g.spacing_km, j = p.dn / g.spacing_km, v = sums[k][metric];
      const steep = p.slope_deg > 10;
      if (!steep && (!best || v > best.v)) best = { i, j, v };
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cell" + (i === sc.off.i && j === sc.off.j ? " on" : "") + (steep ? " steep" : "") + (!i && !j ? " pad" : "");
      b.style.setProperty("--fill", color);
      b.style.setProperty("--a", (0.08 + 0.92 * v / 100).toFixed(2));
      b.textContent = Math.round(v);
      b.title = `${offName(i, j)}: ${Math.round(v)}%, slope ${p.slope_deg.toFixed(1)}°${steep ? " (too steep to land)" : ""}`;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => { sc.off = { i, j }; update(key); });
      gridEl.appendChild(b);
    });
    const cur = sums[(half - sc.off.j) * g.n + (sc.off.i + half)][metric];
    const label = metric === "sunPct" ? "sunlight" : metric === "earthPct" ? "Earth visibility" : "power and Earth link";
    const pt = gridPoint(g, sc.off.i, sc.off.j);
    let msg = `Each square is a pad 1 km apart, coloured by ${label} over these 30 days. Here: ${Math.round(cur)}%` +
      `${pt.slope_deg > 10 ? `, but the ground slopes ${pt.slope_deg.toFixed(0)}°, too steep to land` : ""}.`;
    if (best && best.v - cur >= 1) msg += best.i || best.j
      ? ` Best landable spot nearby: ${offName(best.i, best.j)} with ${Math.round(best.v)}%.`
      : ` The original pad is the best landable spot here (${Math.round(best.v)}%).`;
    text.textContent = msg;
  }

  // ---------- canvases ----------
  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function niceStep(range) {
    for (const s of [0.5, 1, 2, 5, 10, 15, 30]) if (range / s <= 7) return s;
    return 45;
  }

  function renderPano(key) {
    const sc = S[key], fig = $(`.pano[data-key="${key}"]`), cv = $("canvas", fig);
    const { ctx, w, h } = setupCanvas(cv);
    const site = sc.site, rows = sc.tl.rows, prof = site.horizon, step = site.azStep;
    $(".cap", fig).textContent = `${site.name}${site.nudged ? ` (moved ${offName(sc.off.i, sc.off.j)})` : ""}, landing ${isoDate(sc.landing)}`;

    let lo = Math.min(...prof), hi = Math.max(...prof);
    for (const r of rows) { hi = Math.max(hi, Math.min(r.sun.el, 90), Math.min(r.earth.el, 90)); }
    lo = Math.max(-10, Math.floor(lo - 1)); hi = Math.min(90, Math.ceil(hi + 1.5));
    if (hi - lo < 6) hi = lo + 6;
    const padL = 34, padB = 20, pw = w - padL - 6, ph = h - padB - 6;
    const X = (az) => padL + (az / 360) * pw;
    const Y = (el) => 6 + (1 - (el - lo) / (hi - lo)) * ph;

    const g = ctx.createLinearGradient(0, 6, 0, 6 + ph);
    g.addColorStop(0, "#0c1018"); g.addColorStop(1, "#1d2533");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    ctx.font = "11px Barlow, sans-serif"; ctx.fillStyle = C.dust; ctx.strokeStyle = "rgba(139,147,163,.18)"; ctx.lineWidth = 1;
    const ys = niceStep(hi - lo);
    for (let e = Math.ceil(lo / ys) * ys; e <= hi; e += ys) {
      ctx.beginPath(); ctx.moveTo(padL, Y(e) + .5); ctx.lineTo(padL + pw, Y(e) + .5); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(`${+e.toFixed(1)}°`, padL - 5, Y(e) + 4);
    }
    ctx.textAlign = "center";
    ["N", "E", "S", "W", "N"].forEach((n, k) => {
      const x = X(k * 90);
      ctx.beginPath(); ctx.moveTo(x + .5, 6); ctx.lineTo(x + .5, 6 + ph); ctx.stroke();
      ctx.fillText(n, Math.min(Math.max(x, padL + 6), padL + pw - 6), h - 5);
    });

    ctx.save(); ctx.beginPath(); ctx.rect(padL, 6, pw, ph); ctx.clip();
    const track = (body, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.85;
      ctx.beginPath(); let prev = null;
      for (const r of rows) {
        const p = r[body], x = X(p.az), y = Y(Math.min(p.el, 90));
        if (prev === null || Math.abs(p.az - prev) > 180) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prev = p.az;
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    };
    track("earth", C.earth);
    track("sun", C.sun);

    const tg = ctx.createLinearGradient(0, Y(hi), 0, 6 + ph);
    tg.addColorStop(0, C["terrain-top"]); tg.addColorStop(1, C["terrain-bottom"]);
    ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(X(0), 6 + ph);
    for (let k = 0; k <= prof.length; k++) ctx.lineTo(X(k * step), Y(prof[k % prof.length]));
    ctx.lineTo(X(360), 6 + ph); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#aab2c0"; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k <= prof.length; k++) { const x = X(k * step), y = Y(prof[k % prof.length]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();

    const r = rows[Math.min(met, rows.length - 1)];
    const pxPerDeg = ph / (hi - lo);
    for (const [body, vis, color] of [["earth", "earthVis", C.earth], ["sun", "sunVis", C.sun]]) {
      const p = r[body], x = X(p.az), y = Y(Math.min(p.el, 90));
      const rad = Math.max(4, p.radius * pxPerDeg);
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = r[vis].fraction > 0.5 ? 1 : 0.35; ctx.fill();
      ctx.restore();
      if (r[vis].fraction <= 0.5) {
        ctx.strokeStyle = color; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, rad + 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
    const stretch = pxPerDeg / (pw / 360);
    if (stretch > 1.5) { ctx.textAlign = "right"; ctx.fillStyle = C.dust; ctx.fillText(`vertical ×${stretch.toFixed(0)}`, padL + pw - 4, 18); }
  }

  function renderStrip(key) {
    const sc = S[key], cv = $(`.strip[data-key="${key}"] canvas`);
    const { ctx, w, h } = setupCanvas(cv);
    const rows = sc.tl.rows, n = rows.length, cw = w / n;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      ctx.fillStyle = r.sunUp && r.earthUp ? C.both : r.sunUp ? C.sun : r.earthUp ? C.earth : C.dark;
      ctx.fillRect(i * cw, 0, cw + 0.6, h - 14);
    }
    ctx.fillStyle = C.dust; ctx.font = "10px Barlow, sans-serif";
    for (let d = 0; d <= 30; d += 5) {
      ctx.textAlign = d === 0 ? "left" : d === 30 ? "right" : "center";
      ctx.fillText(`day ${d}`, d * 24 * cw, h - 2);
    }
    ctx.fillStyle = "#fff"; ctx.fillRect(met * cw - 1, 0, 2, h - 14);
  }

  // ---------- render: year view ----------
  function yearBins(sc) {
    const s = sc.site;
    const key = `year|${s.id}|${s.lat}|${s.lon}|${sc.landing.getTime()}`;
    return memo(key, () => {
      const tl = E.timeline(s, sc.landing, 24 * 365, 180);
      const bins = [];
      const monthH = 24 * 365 / 12;
      for (let m = 0; m < 12; m++) bins.push({ sun: 0, earth: 0, n: 0, start: new Date(sc.landing.getTime() + m * monthH * 3600e3) });
      tl.rows.forEach((r, k) => {
        const b = bins[Math.min(11, Math.floor((k * 3) / monthH))];
        b.n++; if (r.sunUp) b.sun++; if (r.earthUp) b.earth++;
      });
      return bins.map((b) => ({ sun: 100 * b.sun / b.n, earth: 100 * b.earth / b.n, start: b.start }));
    });
  }

  function renderYear(key) {
    const sc = S[key], cv = $(`.yearplot[data-key="${key}"] canvas`);
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const bins = yearBins(sc);
    const padB = 18, padL = 30, ph = h - padB - 4, cw = (w - padL) / 12;
    ctx.font = "10px Barlow, sans-serif"; ctx.fillStyle = C.dust; ctx.strokeStyle = "rgba(139,147,163,.18)";
    for (const v of [0, 50, 100]) {
      const y = 4 + ph * (1 - v / 100);
      ctx.beginPath(); ctx.moveTo(padL, y + .5); ctx.lineTo(w, y + .5); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(`${v}%`, padL - 4, y + 3);
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    bins.forEach((b, m) => {
      const x0 = padL + m * cw, bw = Math.max(3, cw * 0.32);
      ctx.fillStyle = C.sun; ctx.fillRect(x0 + cw * 0.15, 4 + ph * (1 - b.sun / 100), bw, ph * b.sun / 100);
      ctx.fillStyle = C.earth; ctx.fillRect(x0 + cw * 0.15 + bw + 2, 4 + ph * (1 - b.earth / 100), bw, ph * b.earth / 100);
      ctx.fillStyle = C.dust; ctx.textAlign = "center";
      const mid = new Date(b.start.getTime() + 15.2 * 86400e3);
      ctx.fillText(months[mid.getUTCMonth()] + (m === 0 || mid.getUTCMonth() === 0 ? ` ${String(mid.getUTCFullYear()).slice(2)}` : ""),
        x0 + cw / 2, h - 4);
    });
  }

  // ---------- render: map ----------
  function mapGeom(cv) {
    const { ctx, w, h } = setupCanvas(cv);
    const size = Math.min(w, h), ox = (w - size) / 2, oy = (h - size) / 2, k = size / TERRAIN.n;
    const toScreen = (lat, lon) => { const p = TERRAIN.project(lat, lon); return [ox + p.sample * k, oy + p.line * k]; };
    return { ctx, w, h, size, ox, oy, k, toScreen };
  }

  function renderMap() {
    const cv = $(".map");
    if (!TERRAIN) { const { ctx, w, h } = setupCanvas(cv); ctx.fillStyle = C.dark; ctx.fillRect(0, 0, w, h); return; }
    const G = mapGeom(cv), ctx = G.ctx;
    ctx.fillStyle = C.night; ctx.fillRect(0, 0, G.w, G.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(SHADE, G.ox, G.oy, G.size, G.size);
    // latitude rings
    ctx.strokeStyle = "rgba(201,204,209,.25)"; ctx.lineWidth = 1; ctx.font = "11px Barlow, sans-serif"; ctx.fillStyle = C.regolith;
    const [cx, cy] = G.toScreen(-90, 0);
    for (const lat of [-88, -86, -84, -82]) {
      const [x] = G.toScreen(lat, 90);
      ctx.beginPath(); ctx.arc(cx, cy, x - cx, 0, Math.PI * 2); ctx.stroke();
      ctx.textAlign = "left"; ctx.fillText(`${-lat}°S`, x + 3, cy - 3);
    }
    // meridian labels toward the edge
    ctx.textAlign = "center";
    for (const [lon, lab] of [[0, "0° (toward Earth)"], [90, "90°E"], [180, "180°"], [-90, "90°W"]]) {
      const [x, y] = G.toScreen(-81.1, lon); ctx.fillText(lab, x, y + 4);
    }
    // catalogue sites
    for (const s of DATA.sites) {
      if (!s.terrain) continue;
      const [x, y] = G.toScreen(s.lat, s.lon);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(232,237,242,.85)"; ctx.fill();
    }
    // scenarios with Sun/Earth arrows
    for (const key of ["A", "B"]) {
      const sc = S[key], s = sc.site;
      if (!TERRAIN.covers(s.lat, s.lon)) continue;
      const [x, y] = G.toScreen(s.lat, s.lon);
      const r = sc.tl.rows[Math.min(met, sc.tl.rows.length - 1)];
      const lon = s.lon * Math.PI / 180;
      for (const [body, upKey, color] of [["earth", "earthUp", C.earth], ["sun", "sunUp", C.sun]]) {
        const az = r[body].az * Math.PI / 180;
        const dx = Math.cos(az) * Math.sin(lon) + Math.sin(az) * Math.cos(lon);
        const dy = Math.cos(az) * Math.cos(lon) - Math.sin(az) * Math.sin(lon);
        const L = 46, ex = x + dx * L, ey = y - dy * L;
        ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.globalAlpha = r[upKey] ? 1 : 0.45;
        ctx.setLineDash(r[upKey] ? [] : [4, 3]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
        const a = Math.atan2(ey - y, ex - x);
        ctx.beginPath(); ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 8 * Math.cos(a - 0.4), ey - 8 * Math.sin(a - 0.4));
        ctx.lineTo(ex - 8 * Math.cos(a + 0.4), ey - 8 * Math.sin(a + 0.4)); ctx.closePath();
        ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = key === "A" ? C.regolith : C.dark; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = C.regolith; ctx.stroke();
      ctx.fillStyle = key === "A" ? C.dark : C.regolith; ctx.font = "600 11px Barlow, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(key, x, y + 4);
    }
  }

  function mapClick(ev) {
    if (!TERRAIN) return;
    const cv = ev.currentTarget, rect = cv.getBoundingClientRect();
    const G = mapGeom(cv);
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const sample = (sx - G.ox) / G.k, line = (sy - G.oy) / G.k;
    const ll = TERRAIN.unproject(line, sample);
    const status = $(".map-status");
    if (!TERRAIN.covers(ll.lat, ll.lon)) { status.textContent = "That point is outside the terrain map. Click within the shaded area."; return; }
    const key = $(".place input:checked").value;
    status.textContent = `Computing the skyline for plan ${key}…`;
    later(() => {
      const t0 = performance.now();
      const hz = TERRAIN.horizon(ll.lat, ll.lon, DATA.az_step, DATA.obs_height_m);
      Object.assign(S[key], { siteId: "custom", lat: ll.lat, lon: ll.lon, customHz: hz, off: { i: 0, j: 0 } });
      update(key);
      status.textContent = `Plan ${key} placed at ${ll.lat.toFixed(3)}°, ${ll.lon.toFixed(3)}°E (skyline in ${Math.round(performance.now() - t0)} ms).`;
    });
  }

  // ---------- CSV ----------
  function downloadCsv(key) {
    const sc = S[key], s = sc.site;
    const head = ["time_utc", "hours_after_landing", "sun_az_deg", "sun_el_deg", "sun_skyline_deg", "sun_disc_visible",
                  "earth_az_deg", "earth_el_deg", "earth_skyline_deg", "earth_disc_visible", "power", "direct_to_earth"];
    const lines = [`# ${s.name} lat=${s.lat} lon=${s.lon} landing=${sc.landing.toISOString()}`, head.join(",")];
    sc.tl.rows.forEach((r, k) => lines.push([r.t.toISOString(), k, r.sun.az.toFixed(3), r.sun.el.toFixed(3), r.sunVis.horizon.toFixed(3),
      r.sunVis.fraction.toFixed(3), r.earth.az.toFixed(3), r.earth.el.toFixed(3), r.earthVis.horizon.toFixed(3), r.earthVis.fraction.toFixed(3),
      r.sunUp ? 1 : 0, r.earthUp ? 1 : 0].join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${s.id}_${isoDate(sc.landing)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- orchestration ----------
  function renderAll() {
    $("#met-out").textContent = `day ${Math.floor(met / 24)}, ${met % 24} h`;
    $("#met").value = met;
    for (const k of ["A", "B"]) { renderCard(k); renderPano(k); renderStrip(k); }
    renderMap();
  }
  function renderSlow() {
    for (const k of ["A", "B"]) { renderNudge(k); renderYear(k); }
  }

  function fillSiteSelect(sel) {
    const groups = {};
    for (const s of DATA.sites) (groups[s.group] = groups[s.group] || []).push(s);
    for (const [g, list] of Object.entries(groups)) {
      const og = document.createElement("optgroup"); og.label = g;
      for (const s of list) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.name; og.appendChild(o); }
      sel.appendChild(og);
    }
    const o = document.createElement("option"); o.value = "custom"; o.textContent = "Custom point…"; sel.appendChild(o);
  }

  function syncInputs(key) {
    const sc = S[key], el = sc.el;
    $(".site", el).value = sc.siteId;
    $(".custom", el).hidden = sc.siteId !== "custom";
    $(".lat", el).value = +sc.lat.toFixed(4); $(".lon", el).value = +sc.lon.toFixed(4);
    $(".date", el).value = isoDate(sc.landing);
    $(".hour", el).value = isoHour(sc.landing);
  }

  function update(key) {
    recompute(key); if (key === "A") recompute("B");
    syncInputs(key); renderAll(); writeHash();
    later(renderSlow);
  }

  function setCustomFromInputs(key) {
    const sc = S[key];
    sc.customHz = TERRAIN && TERRAIN.covers(sc.lat, sc.lon) ? TERRAIN.horizon(sc.lat, sc.lon, DATA.az_step, DATA.obs_height_m) : null;
  }

  function bindScenario(key) {
    const el = document.querySelector(`.scenario[data-key="${key}"]`), sc = S[key];
    el.appendChild($("#scenario-body").content.cloneNode(true));
    sc.el = el;
    $$(".metric input", el).forEach((r) => (r.name = `metric-${key}`));
    fillSiteSelect($(".site", el));
    $(".site", el).addEventListener("change", (e) => {
      sc.siteId = e.target.value; sc.off = { i: 0, j: 0 };
      if (sc.siteId !== "custom") { const s = siteById(sc.siteId); sc.lat = s.lat; sc.lon = s.lon; sc.customHz = null; if (s.grid) loadGrid(s.id); }
      else setCustomFromInputs(key);
      update(key);
    });
    for (const f of ["lat", "lon"]) $(`.${f}`, el).addEventListener("change", (e) => {
      const v = parseFloat(e.target.value); if (isNaN(v)) return;
      sc[f] = v; setCustomFromInputs(key); update(key);
    });
    const setWhen = () => {
      const d = $(".date", el).value, t = $(".hour", el).value || "00:00";
      if (d) { sc.landing = new Date(`${d}T${t.slice(0, 2)}:00:00Z`); update(key); }
    };
    $(".date", el).addEventListener("change", setWhen);
    $(".hour", el).addEventListener("change", setWhen);
    $$(".shift button", el).forEach((b) => b.addEventListener("click", () => {
      sc.landing = new Date(sc.landing.getTime() + parseFloat(b.dataset.shift) * 86400000);
      sc.landing.setUTCMinutes(0, 0, 0);
      update(key);
    }));
    $$(".metric input", el).forEach((r) => r.addEventListener("change", () => renderNudge(key)));
    $(".csv", el).addEventListener("click", () => downloadCsv(key));
    const copy = $(".copy", el);
    if (copy) copy.addEventListener("click", () => {
      Object.assign(sc, { siteId: S.A.siteId, lat: S.A.lat, lon: S.A.lon, landing: new Date(S.A.landing),
                          off: { ...S.A.off }, customHz: S.A.customHz });
      update(key);
    });

    const cv = $(`.strip[data-key="${key}"] canvas`);
    const scrub = (ev) => {
      const rect = cv.getBoundingClientRect();
      met = Math.max(0, Math.min(HOURS, Math.round(((ev.clientX - rect.left) / rect.width) * HOURS)));
      renderAll();
    };
    cv.addEventListener("pointerdown", (ev) => { cv.setPointerCapture(ev.pointerId); scrub(ev); });
    cv.addEventListener("pointermove", (ev) => { if (ev.buttons) scrub(ev); });
  }

  function writeHash() {
    const enc = (sc) => [sc.siteId, sc.lat.toFixed(4), sc.lon.toFixed(4), isoDate(sc.landing), sc.landing.getUTCHours(), sc.off.i, sc.off.j].join(",");
    history.replaceState(null, "", `#a=${enc(S.A)}&b=${enc(S.B)}`);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const [k, key] of [["a", "A"], ["b", "B"]]) {
      const v = p.get(k); if (!v) continue;
      const [id, lat, lon, d, hr, oi, oj] = v.split(",");
      if (id !== "custom" && !siteById(id)) continue;
      const landing = new Date(`${d}T00:00:00Z`); landing.setUTCHours(+hr || 0);
      Object.assign(S[key], { siteId: id, lat: +lat, lon: +lon, landing, off: { i: +oi || 0, j: +oj || 0 } });
    }
  }

  async function init() {
    DATA = await (await fetch("data/sites.json")).json();
    const a = siteById("connecting-ridge") || DATA.sites[0], b = siteById("malapert-massif") || DATA.sites[1];
    const start = new Date(Date.UTC(2026, 11, 1));
    S.A = { siteId: a.id, lat: a.lat, lon: a.lon, landing: new Date(start), off: { i: 0, j: 0 }, customHz: null };
    S.B = { siteId: b.id, lat: b.lat, lon: b.lon, landing: new Date(start), off: { i: 0, j: 0 }, customHz: null };
    readHash();
    bindScenario("A"); bindScenario("B");
    await Promise.all(["A", "B"].map((k) => S[k].siteId !== "custom" && siteById(S[k].siteId).grid ? loadGrid(S[k].siteId) : null));
    recompute("A"); recompute("B"); syncInputs("A"); syncInputs("B");
    renderAll(); writeHash(); later(renderSlow);

    $("#met").addEventListener("input", (e) => { met = +e.target.value; renderAll(); });
    $("#play").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (timer) { clearInterval(timer); timer = null; btn.setAttribute("aria-pressed", "false"); btn.textContent = "Play"; return; }
      btn.setAttribute("aria-pressed", "true"); btn.textContent = "Pause";
      timer = setInterval(() => { met = (met + +$("#speed").value) % (HOURS + 1); renderAll(); }, 140);
    });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { renderAll(); renderSlow(); }, 120); });
    $(".map").addEventListener("click", mapClick);

    // terrain for the map and custom points (3 MB, loaded after first paint)
    $(".map-status").textContent = "Loading terrain map…";
    TERRAIN = await window.LunarTerrain.load("data/dem_south_480m");
    SHADE = document.createElement("canvas");
    SHADE.width = SHADE.height = TERRAIN.n;
    const img = new ImageData(TERRAIN.shade([0.92, 0.96, 1.08]), TERRAIN.n, TERRAIN.n);
    SHADE.getContext("2d").putImageData(img, 0, 0);
    $(".map-status").textContent = "";
    for (const k of ["A", "B"]) if (S[k].siteId === "custom") { setCustomFromInputs(k); recompute(k); }
    renderAll(); later(renderSlow);
  }

  init().catch((err) => {
    console.error(err);
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<p class="note warn">Could not load site data (${err.message}). Serve the web folder over HTTP, for example: python3 -m http.server</p>`);
  });
})();
