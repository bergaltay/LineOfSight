/* Lunar Landing Site Navigator — UI */
(function () {
  "use strict";
  const E = window.LunarEphem;
  const HOURS = 720;              // 30-day window after landing
  const STEP_MIN = 60;
  const LUNAR_MONTH_D = 29.530589;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const C = {};
  ["--sun", "--earth", "--both", "--dark", "--rim", "--dust", "--regolith", "--terrain-top", "--terrain-bottom", "--night"]
    .forEach((k) => (C[k.slice(2)] = css(k)));

  let DATA = null;
  let met = 0;                    // hours after landing (shared by A and B)
  let timer = null;
  const S = {};                   // scenario state keyed by "A" / "B"

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const fmtPct = (v) => `${Math.round(v)}%`;
  const fmtH = (h) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${Math.round(h)} h`);
  function fmtCountdown(h) {
    const d = Math.floor(h / 24), hh = Math.round(h - d * 24);
    return d > 0 ? `${d} d ${hh} h` : `${hh} h`;
  }
  const isoDate = (d) => d.toISOString().slice(0, 10);
  const utc = (d) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const dirName = (az) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(az / 45) % 8];

  function siteById(id) { return DATA.sites.find((s) => s.id === id); }

  function siteForScenario(sc) {
    if (sc.siteId !== "custom") {
      const s = siteById(sc.siteId);
      return { ...s, azStep: DATA.az_step };
    }
    const dip = -Math.acos(E.R_MOON / (E.R_MOON + DATA.obs_height_m / 1000)) * 180 / Math.PI;
    return { id: "custom", name: `Custom (${sc.lat.toFixed(2)}°, ${sc.lon.toFixed(2)}°)`, lat: sc.lat, lon: sc.lon,
             terrain: false, height_km: 0, azStep: DATA.az_step, horizon: new Array(360 / DATA.az_step).fill(dip) };
  }

  // ---------- compute ----------
  function recompute(key) {
    const sc = S[key];
    sc.site = siteForScenario(sc);
    sc.tl = E.timeline(sc.site, sc.landing, HOURS, STEP_MIN);
  }

  // ---------- render: scenario cards ----------
  function renderCard(key) {
    const sc = S[key], el = sc.el, site = sc.site;
    const note = $(".note", el);
    if (!site.terrain) {
      note.textContent = site.id === "custom"
        ? "Custom point: terrain is not modelled here, so the horizon is a smooth sphere."
        : "Outside the polar terrain maps: horizon modelled as a smooth sphere. " + site.note;
      note.classList.add("warn");
    } else {
      note.textContent = `${site.note} Landing pad ${site.pad_offset_km.toFixed(1)} km from NASA's region centre, ` +
        `on ${site.pad_slope_deg.toFixed(1)}° slope, ${site.height_km >= 0 ? "+" : ""}${site.height_km.toFixed(2)} km elevation.`;
      note.classList.remove("warn");
    }

    const i = Math.min(met, sc.tl.rows.length - 1), r = sc.tl.rows[i];
    for (const [body, upKey, vis, label] of [["sun", "sunUp", "sunVis", "Sun"], ["earth", "earthUp", "earthVis", "Earth"]]) {
      const box = $(`.body.${body}`, el), up = r[upKey];
      box.classList.toggle("off", !up);
      const nc = E.nextChange(sc.tl, i, upKey);
      $(".state", box).textContent = body === "sun"
        ? (up ? "Sunlit: solar power" : "In shadow: on battery")
        : (up ? "Earth in view: direct radio" : "Earth hidden: no direct radio");
      $(".count", box).textContent = nc
        ? `${body === "sun" ? (up ? "Sunset" : "Sunrise") : (up ? "Earthset" : "Earthrise")} in ${fmtCountdown(nc.hours)}`
        : `${up ? "Stays up" : "Stays down"} for the rest of the 30 days`;
      const p = r[body];
      $(".pos", box).textContent =
        `${label} ${p.el.toFixed(2)}° high, ${p.az.toFixed(1)}° (${dirName(p.az)}); skyline ${r[vis].horizon.toFixed(2)}°, ${Math.round(r[vis].fraction * 100)}% of disc visible`;
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

  // ---------- render: panorama ----------
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
    $(".cap", fig).textContent = `${site.name}, landing ${isoDate(sc.landing)}`;

    // vertical range: horizon and the parts of the tracks near it
    let lo = Math.min(...prof), hi = Math.max(...prof);
    for (const r of rows) { hi = Math.max(hi, Math.min(r.sun.el, 90), Math.min(r.earth.el, 90)); }
    lo = Math.max(-10, Math.floor(lo - 1)); hi = Math.min(90, Math.ceil(hi + 1.5));
    if (hi - lo < 6) hi = lo + 6;
    const padL = 34, padB = 20, pw = w - padL - 6, ph = h - padB - 6;
    const X = (az) => padL + (az / 360) * pw;
    const Y = (el) => 6 + (1 - (el - lo) / (hi - lo)) * ph;

    // sky
    const g = ctx.createLinearGradient(0, 6, 0, 6 + ph);
    g.addColorStop(0, "#0c1018"); g.addColorStop(1, "#1d2533");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // grid
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

    // everything below is clipped to the plot area
    ctx.save(); ctx.beginPath(); ctx.rect(padL, 6, pw, ph); ctx.clip();
    // tracks (draw first so terrain occludes hidden parts)
    const track = (body, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.85;
      ctx.beginPath(); let prev = null;
      for (const r of rows) {
        const p = r[body], x = X(p.az), y = Y(Math.min(p.el, 90));
        if (prev && Math.abs(p.az - prev) > 180) ctx.moveTo(x, y); else if (prev === null) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prev = p.az;
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    };
    track("earth", C.earth);
    track("sun", C.sun);

    // terrain
    const tg = ctx.createLinearGradient(0, Y(hi), 0, 6 + ph);
    tg.addColorStop(0, C["terrain-top"]); tg.addColorStop(1, C["terrain-bottom"]);
    ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(X(0), 6 + ph);
    for (let k = 0; k <= prof.length; k++) ctx.lineTo(X(k * step), Y(prof[k % prof.length]));
    ctx.lineTo(X(360), 6 + ph); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#aab2c0"; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k <= prof.length; k++) { const x = X(k * step), y = Y(prof[k % prof.length]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();

    // bodies at mission time (true angular size, vertical stretch applied)
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
    const stretch = (pxPerDeg / (pw / 360));
    if (stretch > 1.5) {
      ctx.textAlign = "right"; ctx.fillStyle = C.dust;
      ctx.fillText(`vertical ×${stretch.toFixed(0)}`, padL + pw - 4, 18);
    }
  }

  // ---------- render: timeline strip ----------
  function renderStrip(key) {
    const sc = S[key], cv = $(`.strip[data-key="${key}"] canvas`);
    const { ctx, w, h } = setupCanvas(cv);
    const rows = sc.tl.rows, n = rows.length, cw = w / n;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      ctx.fillStyle = r.sunUp && r.earthUp ? C.both : r.sunUp ? C.sun : r.earthUp ? C.earth : C.dark;
      ctx.fillRect(i * cw, 0, cw + 0.6, h - 14);
    }
    // day ticks
    ctx.fillStyle = C.dust; ctx.font = "10px Barlow, sans-serif";
    for (let d = 0; d <= 30; d += 5) {
      ctx.textAlign = d === 0 ? "left" : d === 30 ? "right" : "center";
      ctx.fillText(`day ${d}`, d * 24 * cw, h - 2);
    }
    // cursor
    const x = met * cw;
    ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, 0, 2, h - 14);
  }

  function renderAll() {
    $("#met-out").textContent = `day ${Math.floor(met / 24)}, ${met % 24} h`;
    $("#met").value = met;
    for (const k of ["A", "B"]) { renderCard(k); renderPano(k); renderStrip(k); }
  }

  // ---------- wiring ----------
  function fillSiteSelect(sel) {
    const groups = {};
    for (const s of DATA.sites) (groups[s.group] = groups[s.group] || []).push(s);
    for (const [g, list] of Object.entries(groups)) {
      const og = document.createElement("optgroup"); og.label = g;
      for (const s of list) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.name; og.appendChild(o); }
      sel.appendChild(og);
    }
    const o = document.createElement("option"); o.value = "custom"; o.textContent = "Custom coordinates…"; sel.appendChild(o);
  }

  function syncInputs(key) {
    const sc = S[key], el = sc.el;
    $(".site", el).value = sc.siteId;
    $(".custom", el).hidden = sc.siteId !== "custom";
    $(".lat", el).value = sc.lat; $(".lon", el).value = sc.lon;
    $(".date", el).value = isoDate(sc.landing);
  }

  function update(key) { recompute(key); if (key === "A") recompute("B"); syncInputs(key); renderAll(); writeHash(); }

  function bindScenario(key) {
    const el = document.querySelector(`.scenario[data-key="${key}"]`), sc = S[key];
    sc.el = el;
    fillSiteSelect($(".site", el));
    $(".site", el).addEventListener("change", (e) => {
      sc.siteId = e.target.value;
      if (sc.siteId !== "custom") { const s = siteById(sc.siteId); sc.lat = s.lat; sc.lon = s.lon; }
      update(key);
    });
    for (const f of ["lat", "lon"]) $(`.${f}`, el).addEventListener("change", (e) => {
      const v = parseFloat(e.target.value); if (!isNaN(v)) { sc[f] = v; update(key); }
    });
    $(".date", el).addEventListener("change", (e) => {
      if (e.target.value) { sc.landing = new Date(e.target.value + "T00:00:00Z"); update(key); }
    });
    el.querySelectorAll(".shift button").forEach((b) => b.addEventListener("click", () => {
      sc.landing = new Date(sc.landing.getTime() + parseFloat(b.dataset.shift) * 86400000);
      sc.landing.setUTCMinutes(0, 0, 0);
      update(key);
    }));
    const copy = $(".copy", el);
    if (copy) copy.addEventListener("click", () => {
      Object.assign(sc, { siteId: S.A.siteId, lat: S.A.lat, lon: S.A.lon, landing: new Date(S.A.landing) });
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
    const enc = (sc) => [sc.siteId, sc.lat.toFixed(4), sc.lon.toFixed(4), isoDate(sc.landing)].join(",");
    history.replaceState(null, "", `#a=${enc(S.A)}&b=${enc(S.B)}`);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const [k, key] of [["a", "A"], ["b", "B"]]) {
      const v = p.get(k); if (!v) continue;
      const [id, lat, lon, d] = v.split(",");
      if (id === "custom" || siteById(id)) Object.assign(S[key], { siteId: id, lat: +lat, lon: +lon, landing: new Date(d + "T00:00:00Z") });
    }
  }

  async function init() {
    DATA = await (await fetch("data/sites.json")).json();
    const a = siteById("connecting-ridge") || DATA.sites[0], b = siteById("malapert-massif") || DATA.sites[1];
    const start = new Date(Date.UTC(2026, 11, 1));
    S.A = { siteId: a.id, lat: a.lat, lon: a.lon, landing: new Date(start) };
    S.B = { siteId: b.id, lat: b.lat, lon: b.lon, landing: new Date(start) };
    readHash();
    bindScenario("A"); bindScenario("B");
    recompute("A"); recompute("B"); syncInputs("A"); syncInputs("B");
    renderAll(); writeHash();

    $("#met").addEventListener("input", (e) => { met = +e.target.value; renderAll(); });
    $("#play").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (timer) { clearInterval(timer); timer = null; btn.setAttribute("aria-pressed", "false"); btn.textContent = "Play"; return; }
      btn.setAttribute("aria-pressed", "true"); btn.textContent = "Pause";
      timer = setInterval(() => { met = (met + +$("#speed").value) % (HOURS + 1); renderAll(); }, 140);
    });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderAll, 100); });
  }

  init().catch((err) => {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<p class="note warn">Could not load site data (${err.message}). Serve the web folder over HTTP, for example: python3 -m http.server</p>`);
  });
})();
