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
  let MAPGEO = null;               // map projection only (from dem_south_480m.json), ready before the 3 MB terrain grid
  let active = "A";                // plan edited in step 1 and placed by map clicks
  const MAP = { markers: [], menu: null, pinned: false, closeT: 0, hover: null };
  let SAFETY = null;               // NASA LOLA slope / PSR metrics per pad (data/safety.json)
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
  const safetyFor = (id) => (SAFETY && SAFETY.sites[id]) || null;

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
      const sg = safetyFor(sc.siteId), k = (gridHalf(g) - sc.off.j) * g.n + (sc.off.i + gridHalf(g));
      return { ...base, lat: p.lat, lon: p.lon, height_km: p.height_km,
               slope_deg: sg && sg.grid ? sg.grid[k].slope80 : p.slope_deg,
               horizon: p.h100.map((v) => v / 100), azStep: g.az_step, nudged: true };
    }
    const sf = safetyFor(sc.siteId);
    return { ...base, slope_deg: sf ? sf.slope80.pad : base.pad_slope_deg, azStep: DATA.az_step };
  }

  const gridHalf = (g) => (g.n - 1) / 2;

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
      const box = $(`.body.${body}`, sc.now), up = r[upKey];
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
    renderSafety(key);
  }

  const STATS = [
    ["sunPct", "Time in sunlight", fmtPct, 1],
    ["earthPct", "Time Earth in view", fmtPct, 1],
    ["bothPct", "Power and Earth link", fmtPct, 1],
    ["longestDarkH", "Longest darkness", fmtH, -1],
    ["longestNoCommsH", "Longest radio gap", fmtH, -1],
    ["meanSunElWhenUp", "Average Sun height", (v) => (v == null ? "–" : `${v.toFixed(1)}°`), 1],
  ];

  // ---------- render: comparison (step 2) ----------
  const unitOf = (k) => (k.endsWith("H") ? "h" : k === "meanSunElWhenUp" || k === "slope" ? "°" : " pts");
  const minDiff = (k) => (unitOf(k) === "°" ? 0.05 : 0.5);
  const fmtDelta = (k, d) => {
    const u = unitOf(k), a = Math.abs(d);
    const v = u === "°" ? a.toFixed(1) : u === "h" && a >= 48 ? `${(a / 24).toFixed(1)} d` : `${Math.round(a)}${u === "h" ? " h" : ""}`;
    return `${d > 0 ? "+" : "−"}${v}${u === " pts" ? " pts" : u === "°" ? "°" : ""}`;
  };
  const padSlope = (sc) => (sc.site.terrain && sc.site.slope_deg != null && sc.siteId !== "custom" ? sc.site.slope_deg : null);

  function compareRows() {
    const a = S.A.tl.summary, b = S.B.tl.summary;
    const rows = STATS.map(([k, label, fmt, goodDir]) => ({ k, label, fmt, goodDir, a: a[k], b: b[k] }));
    rows.push({ k: "slope", label: "Pad slope (80 m map)", fmt: (v) => (v == null ? "–" : `${v.toFixed(1)}°`), goodDir: -1,
                a: padSlope(S.A), b: padSlope(S.B) });
    for (const r of rows) {
      r.d = r.a != null && r.b != null ? r.b - r.a : null;
      r.win = r.d == null || Math.abs(r.d) < minDiff(r.k) ? null : r.d * r.goodDir > 0 ? "B" : "A";
    }
    return rows;
  }

  /** One or two plain sentences from the numbers: the strongest point for each side. */
  function verdict(rows) {
    const by = Object.fromEntries(rows.map((r) => [r.k, r]));
    // subj: "plan B" / "it"; poss: "plan B's" / "its"
    const phrase = (r, subj, poss) => {
      const n = r.k.endsWith("H") ? fmtH(Math.abs(r.d)) : `${Math.round(Math.abs(r.d))} pts`;
      return {
        sunPct: `${subj} is in sunlight ${n} more of the time`,
        earthPct: `${subj} has Earth in view ${n} more of the time`,
        bothPct: `${subj} can charge and talk to Earth ${n} more of the time`,
        longestDarkH: `${poss} longest darkness is ${n} shorter`,
        longestNoCommsH: `${poss} longest radio gap is ${n} shorter`,
      }[r.k];
    };
    const plan = (c) => phrase(c.r, `plan ${c.w}`, `plan ${c.w}'s`);
    // significance: 1 pt of time share ~ 2.4 h of the longest gap (10 pts ~ 1 day)
    const cand = ["sunPct", "earthPct", "longestDarkH", "longestNoCommsH", "bothPct"].map((k) => by[k])
      .filter((r) => r.d != null)
      .map((r) => ({ r, w: r.d * r.goodDir > 0 ? "B" : "A", s: Math.abs(r.d) / (r.k.endsWith("H") ? 2.4 : 1) }))
      .filter((c) => c.s >= 2)
      .sort((x, y) => y.s - x.s);
    if (!cand.length) return "Plans A and B are practically equal on sunlight and Earth contact over these 30 days.";
    const top = cand[0], other = cand.find((c) => c.w !== top.w);
    const cap = (t) => t[0].toUpperCase() + t.slice(1);
    if (!other) {
      const second = cand.find((c) => c !== top);
      return second
        ? `Plan ${top.w} is ahead: ${phrase(top.r, "it", "its")}, and ${phrase(second.r, "it", "its")}.`
        : `${cap(plan(top))}; otherwise the plans are close.`;
    }
    return `${cap(plan(top))}, but ${plan(other)}.`;
  }

  function renderCompare() {
    const rows = compareRows();
    $(".verdict").textContent = verdict(rows);
    for (const k of ["A", "B"]) $(`.cmp-name[data-key="${k}"]`).textContent = S[k].site.name;
    const tb = $(".cmp tbody");
    tb.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      const cell = (v, side) => `<td class="${r.win === side ? "win" : ""}">${r.fmt(v)}${r.win === side ? ' <span class="star" aria-label="better">★</span>' : ""}</td>`;
      const dCls = r.win ? (r.win === "B" ? "up" : "down") : "";
      const dTxt = r.d == null ? "–" : r.win ? fmtDelta(r.k, r.d) : "≈ same";
      tr.innerHTML = `<th scope="row">${r.label}</th>${cell(r.a, "A")}${cell(r.b, "B")}<td class="delta ${dCls}">${dTxt}</td>`;
      tb.appendChild(tr);
    }
  }

  // ---------- render: landing safety (NASA LOLA slope + permanent shadow) ----------
  const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
  const slopeCls = (v) => (v > 10 ? "bad" : v > 8 ? "warn" : "");

  function renderSafety(key) {
    const sc = S[key], box = $(".safety", sc.el), dl = $(".safe-stats", box), note = $(".safe-note", box);
    const rec = sc.siteId === "custom" ? null : safetyFor(sc.siteId);
    dl.innerHTML = "";
    if (!rec) {
      note.textContent = sc.siteId === "custom"
        ? "Slope and permanent-shadow maps are evaluated for the listed polar sites only, not for custom points."
        : "No NASA polar slope or shadow map here: those maps cover 80–90° S only.";
      return;
    }
    const add = (label, html, cls) => {
      const d = document.createElement("div");
      d.innerHTML = `<dt>${label}</dt><dd class="${cls || ""}">${html}</dd>`;
      dl.appendChild(d);
    };
    const pm = (v, e) => `${v.toFixed(1)}°<small> ±${Math.max(e, 0.1).toFixed(1)}°</small>`;
    if (sc.site.nudged) {
      const g = GRIDS[sc.siteId], c = rec.grid[(gridHalf(g) - sc.off.j) * g.n + (sc.off.i + gridHalf(g))];
      add("Slope here (80 m map)", pm(c.slope80, c.slope80_err), slopeCls(c.slope80));
      add("Permanent shadow", c.psr ? "Inside a PSR" : "Not in a PSR", c.psr ? "bad" : "");
      note.textContent = "Moved pad: point values only. Area statistics are shown for the original pad. " +
        "Neither map resolves rocks or holes under ~0.5 m.";
      return;
    }
    const s5 = rec.slope5, s80 = rec.slope80, p = rec.psr;
    if (s5) add("Slope at pad (5 m map)", pm(s5.pad, s5.pad_err), slopeCls(s5.pad));
    else add("Slope at pad (80 m map)", pm(s80.pad, s80.pad_err), slopeCls(s80.pad));
    if (s5) add(`95% of ${s5.radius_m} m circle under`, `${s5.p95.toFixed(1)}°`, slopeCls(s5.p95));
    add(`Under 10° within ${s80.radius_m} m`,
      `${Math.round(s80.lt10 * 100)}%<small> ${Math.round(s80.lt10_1sigma * 100)}% with +1σ</small>`,
      s80.lt10 < 0.5 ? "bad" : s80.lt10 < 0.8 ? "warn" : "");
    add(`95% of ${s80.radius_m} m circle under`, `${s80.p95.toFixed(1)}°`, slopeCls(s80.p95));
    add("Nearest permanent shadow",
      p.pad ? "Pad is inside" : p.nearest_km == null ? `&gt; ${p.search_km} km` : fmtKm(p.nearest_km), p.pad ? "bad" : "");
    note.textContent = `NASA LOLA slope maps (80 m/px everywhere${s5 ? ", 5 m/px at this site" : ""}); ± is the map's 1σ uncertainty. ` +
      "Neither resolution shows rocks or holes under ~0.5 m, so this screens a site, it does not clear it.";
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
    const sc = S[key], box = $(".nudge", sc.refine), base = sc.siteId !== "custom" && siteById(sc.siteId);
    $(".rf-name", sc.refine).textContent = sc.site.name;
    $(".nudge-none", sc.refine).hidden = !!(base && base.grid);
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
    const sg = (safetyFor(sc.siteId) || {}).grid;
    g.points.forEach((p, k) => {
      const i = p.de / g.spacing_km, j = p.dn / g.spacing_km, v = sums[k][metric];
      const slope = sg ? sg[k].slope80 : p.slope_deg, psr = !!(sg && sg[k].psr);
      const steep = slope > 10 || psr;
      if (!steep && (!best || v > best.v)) best = { i, j, v };
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cell" + (i === sc.off.i && j === sc.off.j ? " on" : "") + (steep ? " steep" : "") + (!i && !j ? " pad" : "");
      b.style.setProperty("--fill", color);
      b.style.setProperty("--a", (0.08 + 0.92 * v / 100).toFixed(2));
      b.textContent = Math.round(v);
      b.title = `${offName(i, j)}: ${Math.round(v)}%, slope ${slope.toFixed(1)}°` +
        `${psr ? " (permanently shadowed, no landing)" : slope > 10 ? " (too steep to land)" : ""}`;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => { sc.off = { i, j }; update(key); });
      gridEl.appendChild(b);
    });
    const cur = sums[(half - sc.off.j) * g.n + (sc.off.i + half)][metric];
    const label = metric === "sunPct" ? "sunlight" : metric === "earthPct" ? "Earth visibility" : "power and Earth link";
    const kc = (half - sc.off.j) * g.n + (sc.off.i + half);
    const ptSlope = sg ? sg[kc].slope80 : gridPoint(g, sc.off.i, sc.off.j).slope_deg, ptPsr = !!(sg && sg[kc].psr);
    let msg = `Each square is a pad 1 km apart, coloured by ${label} over these 30 days. Here: ${Math.round(cur)}%` +
      `${ptPsr ? ", but it lies in permanent shadow" : ptSlope > 10 ? `, but the ground slopes ${ptSlope.toFixed(0)}°, too steep to land` : ""}.`;
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

  const YEAR_PAD_L = 30, MONTH_H = 24 * 365 / 12;
  function yearIndexAt(cv, clientX) {
    const rect = cv.getBoundingClientRect(), cw = (rect.width - YEAR_PAD_L) / 12;
    const m = Math.floor((clientX - rect.left - YEAR_PAD_L) / cw);
    return m >= 0 && m < 12 ? m : -1;
  }

  function renderYear(key) {
    const sc = S[key], cv = $(".yearplot canvas", sc.el);
    if (!cv.clientWidth) return;                     // panel of the other plan: hidden
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const bins = yearBins(sc);
    const padB = 18, padL = YEAR_PAD_L, ph = h - padB - 4, cw = (w - padL) / 12;
    if (sc.yearHover > 0) {
      ctx.fillStyle = "rgba(232,237,242,.08)";
      ctx.fillRect(padL + sc.yearHover * cw, 0, cw, h - padB + 2);
    }
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

  // ---------- render: map (step 1) ----------
  const CLUSTER_PX = 24, CLUSTER_KM = 45;   // grouping thresholds (see clusterSites)

  function mapGeom(cv) {
    const { ctx, w, h } = setupCanvas(cv);
    const size = Math.min(w, h), ox = (w - size) / 2, oy = (h - size) / 2, k = size / MAPGEO.n;
    const toScreen = (lat, lon) => { const p = MAPGEO.project(lat, lon); return [ox + p.sample * k, oy + p.line * k]; };
    return { ctx, w, h, size, ox, oy, k, toScreen };
  }

  const onMap = (s) => !!(s.terrain && MAPGEO && MAPGEO.covers(s.lat, s.lon));

  /**
   * Group the curated sites on the map: sites closer than CLUSTER_KM on the ground, or CLUSTER_PX on screen,
   * are linked, and linked chains share one numbered marker (single linkage). At full desktop size this gives
   * the four sites around the pole and the Nobile / Leibnitz / IM-2 trio; on small screens more sites merge.
   */
  function clusterSites(G) {
    const pts = DATA.sites.filter(onMap).map((s) => { const [x, y] = G.toScreen(s.lat, s.lon); return { s, x, y }; });
    const lim = Math.max(CLUSTER_PX, CLUSTER_KM * G.k / MAPGEO.scale);
    const root = pts.map((_, i) => i);
    const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < lim) root[find(i)] = find(j);
    const groups = new Map();
    pts.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
    return [...groups.values()].map((g) => ({
      x: g.reduce((a, p) => a + p.x, 0) / g.length, y: g.reduce((a, p) => a + p.y, 0) / g.length, sites: g.map((p) => p.s),
    }));
  }

  /** Where plan `key` is drawn on the map: its site's marker (offset beside a group) or its true position. */
  function planAnchor(key, G) {
    const sc = S[key];
    const m = sc.siteId !== "custom" && MAP.markers.find((q) => q.sites.some((s) => s.id === sc.siteId));
    if (m) {
      const other = key === "A" ? "B" : "A";
      const shared = S[other].siteId === sc.siteId || (m.sites.length > 1 && m.sites.some((s) => s.id === S[other].siteId));
      if (m.sites.length > 1 || shared) return { x: m.x + (key === "A" ? -15 : 15), y: m.y - 15, m };
      return { x: m.x, y: m.y, m };
    }
    if (!MAPGEO.covers(sc.site.lat, sc.site.lon)) return null;
    const [x, y] = G.toScreen(sc.site.lat, sc.site.lon);
    return { x, y, m: null };
  }

  function renderMap() {
    const cv = $(".map");
    if (!MAPGEO || !SHADE) {
      const { ctx, w, h } = setupCanvas(cv);
      ctx.fillStyle = C.dark; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = C.dust; ctx.font = "14px Barlow, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Loading the south pole map…", w / 2, h / 2);
      return;
    }
    const G = mapGeom(cv), ctx = G.ctx;
    MAP.G = G;
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

    // curated sites: single dots and numbered groups
    MAP.markers = clusterSites(G);
    for (const m of MAP.markers) {
      const hot = MAP.hover === m || (MAP.menu && MAP.menu.m === m);
      ctx.lineWidth = 1.5;
      if (m.sites.length === 1) {
        ctx.beginPath(); ctx.arc(m.x, m.y, hot ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(232,237,242,.92)"; ctx.fill();
        ctx.strokeStyle = C.dark; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(m.x, m.y, hot ? 13 : 11.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(16,21,30,.88)"; ctx.fill();
        ctx.strokeStyle = hot ? C.sun : "rgba(232,237,242,.92)"; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "600 12px Barlow, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(String(m.sites.length), m.x, m.y + 4);
      }
    }

    // plans with Sun/Earth arrows (inactive plan first, so the active one is on top)
    for (const key of active === "A" ? ["B", "A"] : ["A", "B"]) {
      const sc = S[key], s = sc.site, an = planAnchor(key, G);
      if (!an) continue;
      const { x, y } = an;
      if (an.m && an.m.sites.length > 1) {              // tie the badge to its group
        ctx.strokeStyle = "rgba(232,237,242,.6)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(an.m.x, an.m.y); ctx.stroke();
      }
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
      if (key === active) { ctx.beginPath(); ctx.arc(x, y, 12.5, 0, Math.PI * 2); ctx.strokeStyle = C.sun; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = key === "A" ? C.regolith : C.dark; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = C.regolith; ctx.stroke();
      ctx.fillStyle = key === "A" ? C.dark : C.regolith; ctx.font = "600 11px Barlow, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(key, x, y + 4);
    }
    if (MAP.menu) placeMenu();
  }

  // ---------- map interaction ----------
  function mapPoint(ev) {
    const rect = $(".map").getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }
  function hitMarker(p) {
    let best = null, bd = Infinity;
    for (const m of MAP.markers) {
      const d = Math.hypot(m.x - p.x, m.y - p.y), r = m.sites.length > 1 ? 15 : 10;
      if (d <= r && d < bd) { best = m; bd = d; }
    }
    return best;
  }
  const plansAt = (id) => ["A", "B"].filter((k) => S[k].siteId === id);

  function showTip(m) {
    const tip = $(".map-tip"), s = m.sites[0], on = plansAt(s.id);
    tip.innerHTML = `<b>${s.name}</b><small>${s.group}${on.length ? ` · plan ${on.join(" and ")}` : ""}</small>` +
      `<small class="tip-act">Click to use for plan ${active}</small>`;
    tip.hidden = false;
    tip.style.left = `${m.x + 12}px`; tip.style.top = `${m.y + 12}px`;
    const wrap = $(".map-wrap").clientWidth;
    if (m.x + 12 + tip.offsetWidth > wrap) tip.style.left = `${m.x - 12 - tip.offsetWidth}px`;
  }
  const hideTip = () => { $(".map-tip").hidden = true; };

  function placeMenu() {
    const el = $(".map-menu"), m = MAP.menu.m, wrap = $(".map-wrap");
    let left = m.x + 18, top = m.y - 14;
    if (left + el.offsetWidth > wrap.clientWidth) left = m.x - 18 - el.offsetWidth;
    top = Math.max(4, Math.min(top, wrap.clientHeight - el.offsetHeight - 4));
    el.style.left = `${Math.max(4, left)}px`; el.style.top = `${top}px`;
  }

  function openMenu(m, pin) {
    clearTimeout(MAP.closeT);
    const el = $(".map-menu");
    if (!MAP.menu || MAP.menu.m !== m) {
      el.innerHTML = `<p class="mm-h">${m.sites.length} sites here <small>${pin ? "" : "click to keep open"}</small></p>` +
        m.sites.map((s) => {
          const on = plansAt(s.id).map((k) => `<span class="tag" data-key="${k}">${k}</span>`).join("");
          return `<button type="button" role="menuitem" data-id="${s.id}"><span>${s.name}<small>${s.group}</small></span>${on}</button>`;
        }).join("");
      el.setAttribute("role", "menu"); el.setAttribute("aria-label", `${m.sites.length} landing sites`);
      $$("button", el).forEach((b) => b.addEventListener("click", () => {
        closeMenu(); setSite(active, b.dataset.id);
        $(".map-status").textContent = `Plan ${active}: ${siteById(b.dataset.id).name}.`;
      }));
    }
    MAP.menu = { m };
    MAP.pinned = MAP.pinned || !!pin;
    el.classList.toggle("pinned", MAP.pinned);
    const hint = $(".mm-h small", el); if (hint) hint.textContent = MAP.pinned ? `choose one for plan ${active}` : "click to keep open";
    el.hidden = false; placeMenu();
    if (pin) { const first = $("button", el); if (first) first.focus({ preventScroll: true }); }
    renderMap();
  }
  function closeMenu() {
    clearTimeout(MAP.closeT);
    if (!MAP.menu) return;
    MAP.menu = null; MAP.pinned = false;
    $(".map-menu").hidden = true; $(".map-menu").innerHTML = "";
    renderMap();
  }
  const scheduleClose = () => { clearTimeout(MAP.closeT); if (!MAP.pinned) MAP.closeT = setTimeout(closeMenu, 280); };

  function mapMove(ev) {
    if (!MAP.G) return;
    const m = hitMarker(mapPoint(ev));
    const cv = $(".map");
    cv.style.cursor = m ? "pointer" : "crosshair";
    if (MAP.hover !== m) { MAP.hover = m; renderMap(); }
    if (m && m.sites.length === 1) { showTip(m); scheduleClose(); }
    else if (m) { hideTip(); if (!MAP.pinned) openMenu(m, false); }
    else { hideTip(); scheduleClose(); }
  }
  function mapLeave() {
    hideTip(); scheduleClose();
    if (MAP.hover) { MAP.hover = null; renderMap(); }
  }

  function setSite(key, id) {
    const sc = S[key];
    sc.siteId = id; sc.off = { i: 0, j: 0 };
    if (id !== "custom") { const s = siteById(id); sc.lat = s.lat; sc.lon = s.lon; sc.customHz = null; if (s.grid) loadGrid(s.id); }
    else setCustomFromInputs(key);
    update(key);
  }

  function mapClick(ev) {
    if (!MAP.G) return;
    const p = mapPoint(ev), m = hitMarker(p), status = $(".map-status");
    if (m && m.sites.length > 1) { hideTip(); openMenu(m, true); return; }
    if (MAP.pinned) { closeMenu(); return; }        // first click outside an open group menu just closes it
    if (m) { hideTip(); setSite(active, m.sites[0].id); status.textContent = `Plan ${active}: ${m.sites[0].name}.`; return; }
    const G = MAP.G, ll = MAPGEO.unproject((p.y - G.oy) / G.k, (p.x - G.ox) / G.k);
    if (!MAPGEO.covers(ll.lat, ll.lon)) { status.textContent = "That point is outside the terrain map. Click within the shaded area."; return; }
    if (!TERRAIN) { status.textContent = "The terrain is still loading; custom points work in a moment. Sites can be picked already."; return; }
    const key = active;
    status.textContent = `Computing the skyline for plan ${key}…`;
    later(() => {
      const t0 = performance.now();
      const hz = TERRAIN.horizon(ll.lat, ll.lon, DATA.az_step, DATA.obs_height_m);
      Object.assign(S[key], { siteId: "custom", lat: ll.lat, lon: ll.lon, customHz: hz, off: { i: 0, j: 0 } });
      update(key);
      status.textContent = `Plan ${key} placed at ${ll.lat.toFixed(3)}°, ${ll.lon.toFixed(3)}°E (skyline in ${Math.round(performance.now() - t0)} ms).`;
    });
  }

  function renderOffMap() {
    const list = $(".offmap-list");
    list.innerHTML = "";
    for (const s of DATA.sites) {
      if (onMap(s)) continue;
      const b = document.createElement("button");
      b.type = "button"; b.dataset.id = s.id;
      b.innerHTML = `${s.name}${plansAt(s.id).map((k) => ` <span class="tag" data-key="${k}">${k}</span>`).join("")}`;
      b.title = `${s.group}. Click to use for plan ${active}.`;
      b.addEventListener("click", () => { setSite(active, s.id); $(".map-status").textContent = `Plan ${active}: ${s.name}.`; });
      list.appendChild(b);
    }
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
  function renderPlansSummary() {
    for (const k of ["A", "B"]) {
      const sc = S[k];
      $(`.plans-sum [data-key="${k}"] .ps-text`).innerHTML =
        `<b>${sc.site.name}</b><small>${isoDate(sc.landing)} ${isoHour(sc.landing)} UTC</small>`;
    }
  }

  function renderAll() {
    $("#met-out").textContent = `day ${Math.floor(met / 24)}, ${met % 24} h`;
    $("#met").value = met;
    for (const k of ["A", "B"]) { renderCard(k); renderPano(k); renderStrip(k); }
    renderCompare(); renderPlansSummary(); renderMap();
  }
  /** Only what depends on the mission time: cheap enough for the animation. */
  function renderTime() {
    $("#met-out").textContent = `day ${Math.floor(met / 24)}, ${met % 24} h`;
    $("#met").value = met;
    for (const k of ["A", "B"]) { renderCard(k); renderPano(k); renderStrip(k); }
    renderMap();
  }
  function renderSlow() {
    for (const k of ["A", "B"]) renderNudge(k);
    renderYear(active); renderOffMap();
  }

  function setActive(key) {
    if (key === active) return;
    active = key;
    for (const k of ["A", "B"]) {
      $(`.tabs [data-key="${k}"]`).setAttribute("aria-selected", String(k === key));
      $(`.tabs [data-key="${k}"]`).tabIndex = k === key ? 0 : -1;
      S[k].el.hidden = k !== key;
      $(`.plans-sum [data-key="${k}"]`).classList.toggle("on", k === key);
    }
    closeMenu(); renderMap(); renderOffMap(); renderYear(key);
    $(".map-status").textContent = `Editing plan ${key}: pick a site on the map or in the list, or click any point on the terrain.`;
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
    sc.now = $(`.now[data-key="${key}"]`);
    sc.now.appendChild($("#now-body").content.cloneNode(true));
    sc.refine = $(`.refine-col[data-key="${key}"]`);
    sc.refine.appendChild($("#nudge-body").content.cloneNode(true));
    $$(".metric input", sc.refine).forEach((r) => (r.name = `metric-${key}`));
    fillSiteSelect($(".site", el));
    $(".site", el).addEventListener("change", (e) => setSite(key, e.target.value));
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
    $$(".metric input", sc.refine).forEach((r) => r.addEventListener("change", () => renderNudge(key)));
    $(".csv", sc.refine).addEventListener("click", () => downloadCsv(key));
    const copy = $(".copy", el);
    if (copy) copy.addEventListener("click", () => {
      Object.assign(sc, { siteId: S.A.siteId, lat: S.A.lat, lon: S.A.lon, landing: new Date(S.A.landing),
                          off: { ...S.A.off }, customHz: S.A.customHz });
      update(key);
    });

    // year chart: click a month to land at the start of that period
    const ycv = $(".yearplot canvas", el);
    ycv.addEventListener("mousemove", (ev) => {
      const m = yearIndexAt(ycv, ev.clientX);
      ycv.style.cursor = m > 0 ? "pointer" : "default";
      if (m !== sc.yearHover) { sc.yearHover = m; renderYear(key); }
    });
    ycv.addEventListener("mouseleave", () => { sc.yearHover = -1; renderYear(key); });
    ycv.addEventListener("click", (ev) => {
      const m = yearIndexAt(ycv, ev.clientX);
      if (m <= 0) return;
      // whole days, so the landing hour stays as set
      const t = new Date(sc.landing.getTime() + Math.round(m * MONTH_H / 24) * 86400e3);
      sc.landing = t; sc.yearHover = -1;
      update(key);
      $(".year-note", el).textContent = `Landing moved to ${isoDate(t)} ${isoHour(t)} UTC. The chart now starts from this date.`;
    });

    const cv = $(`.strip[data-key="${key}"] canvas`);
    const scrub = (ev) => {
      const rect = cv.getBoundingClientRect();
      met = Math.max(0, Math.min(HOURS, Math.round(((ev.clientX - rect.left) / rect.width) * HOURS)));
      renderTime();
    };
    cv.addEventListener("pointerdown", (ev) => { cv.setPointerCapture(ev.pointerId); scrub(ev); });
    cv.addEventListener("pointermove", (ev) => { if (ev.buttons) scrub(ev); });
  }

  function bindPage() {
    // plan tabs (arrow keys move between them) and the two-line summary
    $$(".tabs [role=tab]").forEach((t) => {
      t.addEventListener("click", () => setActive(t.dataset.key));
      t.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
        const k = t.dataset.key === "A" ? "B" : "A";
        setActive(k); $(`.tabs [data-key="${k}"]`).focus();
      });
    });
    $(".tabs [data-key=B]").tabIndex = -1;
    $(".plans-sum [data-key=A]").classList.add("on");
    $$(".plans-sum button").forEach((b) => b.addEventListener("click", () => setActive(b.dataset.key)));

    // map
    const map = $(".map");
    map.addEventListener("click", mapClick);
    map.addEventListener("mousemove", mapMove);
    map.addEventListener("mouseleave", mapLeave);
    const menu = $(".map-menu");
    menu.addEventListener("mouseenter", () => clearTimeout(MAP.closeT));
    menu.addEventListener("mouseleave", scheduleClose);
    document.addEventListener("click", (ev) => {
      if (MAP.pinned && !menu.contains(ev.target) && ev.target !== map) closeMenu();
    });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && MAP.menu) closeMenu(); });

    // mission time
    $("#met").addEventListener("input", (e) => { met = +e.target.value; renderTime(); });
    $("#play").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (timer) { clearInterval(timer); timer = null; btn.setAttribute("aria-pressed", "false"); btn.textContent = "Play"; return; }
      btn.setAttribute("aria-pressed", "true"); btn.textContent = "Pause";
      timer = setInterval(() => { met = (met + +$("#speed").value) % (HOURS + 1); renderTime(); }, 140);
    });

    // share
    $(".copy-link").addEventListener("click", async () => {
      writeHash();
      const st = $(".share-status");
      try { await navigator.clipboard.writeText(location.href); st.textContent = "Link copied. It reopens both plans exactly as set."; }
      catch (e) { st.textContent = `Copy this link: ${location.href}`; }
    });

    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { closeMenu(); renderAll(); renderSlow(); }, 120); });
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

  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }

  async function init() {
    const metaP = fetch("data/dem_south_480m.json").then((r) => r.json());
    const shadeP = loadImage("data/shade_south_480m.webp").catch(() => null);
    DATA = await (await fetch("data/sites.json")).json();
    SAFETY = await fetch("data/safety.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const a = siteById("connecting-ridge") || DATA.sites[0], b = siteById("malapert-massif") || DATA.sites[1];
    const start = new Date(Date.UTC(2026, 11, 1));
    S.A = { siteId: a.id, lat: a.lat, lon: a.lon, landing: new Date(start), off: { i: 0, j: 0 }, customHz: null, yearHover: -1 };
    S.B = { siteId: b.id, lat: b.lat, lon: b.lon, landing: new Date(start), off: { i: 0, j: 0 }, customHz: null, yearHover: -1 };
    readHash();
    bindScenario("A"); bindScenario("B");
    bindPage();
    await Promise.all(["A", "B"].map((k) => S[k].siteId !== "custom" && siteById(S[k].siteId).grid ? loadGrid(S[k].siteId) : null));
    recompute("A"); recompute("B"); syncInputs("A"); syncInputs("B");
    // map: projection + pre-rendered relief first, so sites can be picked right away
    MAPGEO = new window.LunarTerrain(await metaP, new ArrayBuffer(0));
    SHADE = await shadeP;
    renderAll(); writeHash(); later(renderSlow);

    // full terrain grid (3 MB): custom points, and the relief if the image was missing
    $(".map-status").textContent = SHADE ? "Pick a site on the map, or click any point on the terrain."
      : "Loading terrain map…";
    TERRAIN = await window.LunarTerrain.load("data/dem_south_480m");
    if (!SHADE) {
      SHADE = document.createElement("canvas");
      SHADE.width = SHADE.height = TERRAIN.n;
      const img = new ImageData(TERRAIN.shade([0.92, 0.96, 1.08]), TERRAIN.n, TERRAIN.n);
      SHADE.getContext("2d").putImageData(img, 0, 0);
      $(".map-status").textContent = "Pick a site on the map, or click any point on the terrain.";
    }
    let changed = false;
    for (const k of ["A", "B"]) if (S[k].siteId === "custom") { setCustomFromInputs(k); recompute(k); changed = true; }
    if (changed) { renderAll(); later(renderSlow); } else renderMap();
  }

  init().catch((err) => {
    console.error(err);
    const why = location.protocol === "file:"
      ? "Browsers do not let a page opened from disk load its data files."
      : `Could not load the site data (${err.message}).`;
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<p class="note warn">${why} Start the app with <code>./start.sh</code> (macOS, Linux) or <code>start.bat</code> (Windows) ` +
      `in the project folder, or run <code>python3 -m http.server 8000</code> there and open http://localhost:8000/web/</p>`);
  });
})();
