# Interface guide

What every value, control and chart in the Lunar Landing Site Navigator shows, and how it is
computed. All times are UTC. All angles are in degrees.

- [Key terms](#key-terms)
- [Header: mission time](#header-mission-time)
- [Plan cards (A and B)](#plan-cards-a-and-b)
- [What the lander sees (horizon panorama)](#what-the-lander-sees-horizon-panorama)
- [First 30 days after landing (timeline)](#first-30-days-after-landing-timeline)
- [Across the year](#across-the-year)
- [Pick any point near the pole (map)](#pick-any-point-near-the-pole-map)
- [Sites](#sites)
- [Shareable links](#shareable-links)
- [Assumptions and limits](#assumptions-and-limits)

---

## Key terms

| Term | Meaning |
|---|---|
| **Elevation** | Angle of the Sun's or Earth's centre above the site's local horizontal plane (a smooth sphere with no terrain). Negative means below that plane. |
| **Azimuth** | Compass direction, measured from north (0°) through east (90°), south (180°) and west (270°). |
| **Skyline** | Elevation of the terrain horizon in a given azimuth, seen from 2 m above the ground. At the pole it is often negative: you can see *down* to distant terrain because the Moon curves away. |
| **Above skyline (clearance)** | Elevation minus skyline in the body's direction. Positive means the body clears the terrain. |
| **Disc visible** | Share of the Sun's or Earth's disc above the skyline (0–100%). The Sun's disc is about 0.53° wide; Earth's about 1.8–2.0°. |
| **Up / sunlit / in view** | More than half of the disc is above the skyline (that is, the centre is above it). |
| **Power** | The Sun is up. Used as a proxy for solar power; panel orientation and efficiency are not modelled. |
| **Direct radio / Earth link** | Earth is up, so there is a direct line of sight for direct-to-Earth communication without a relay. Antenna pointing and link budget are not modelled. |
| **Mission time** | Hours after the plan's landing time. Plans A and B share the same mission time, so you compare the same phase of each mission even when they land on different dates. |

---

## Header: mission time

| Control | What it does |
|---|---|
| **Time after landing** slider | Sets mission time from 0 to 720 h (30 days) in 1-hour steps. The label shows day and hour. Every card, panorama disc, timeline cursor and map arrow follows it. |
| **Play / Pause** | Animates mission time; wraps back to 0 after 30 days. |
| **Speed** | How far each animation step moves: 1 h, 6 h or 1 day per tick (a tick is 0.14 s). |

---

## Plan cards (A and B)

Plan A is the primary plan; Plan B is the backup. Every value in B's statistics is also compared
with A.

### Inputs

| Control | What it does |
|---|---|
| **Landing site** | Choose one of 17 curated sites (grouped: Artemis / LOLA study sites, Artemis III candidates, CLPS landings, other lunar programmes, Apollo) or **Custom point…**. See [Sites](#sites). |
| **Lat / Lon (E)** | Shown only for a custom point. Latitude −90…90, east longitude −180…360. Inside the polar terrain map the skyline is computed from terrain; outside it, a smooth sphere is used. |
| **Landing date** and **UTC** hour | Start of the 30-day window. Changing them recomputes everything for that plan. |
| **−1 lunar month / −1 day / +1 day / +1 lunar month** | Shift the landing by ±1 day or ±29.53 days (one synodic month: the same lighting phase, but Earth's libration and the season have moved on). |
| **Copy plan A** (B only) | Copies A's site, pad position, date and hour into B, as a starting point for a backup plan. |

### Site note

The line under the inputs describes the site and where the lander actually stands:

- **Landing pad X km from NASA's region centre** — for study regions, the pad is moved to the
  highest gentle ground nearby (see [Assumptions](#assumptions-and-limits)).
- **Actual touchdown point** — for past landings the published coordinates are used as they are.
- **Pad moved N km …** — you picked another square in *Move the pad*.
- Slope and elevation (height above the 1737.4 km reference sphere) of that point.
- Shown in gold when terrain is not modelled (smooth sphere) or when the skyline comes from the
  coarser in-browser terrain.

### Sun and Earth boxes (at the current mission time)

| Item | Meaning |
|---|---|
| Coloured dot | Filled: the body is up. Empty ring: it is hidden. |
| **State** | Sun: *Sunlit: solar power* or *In shadow: on battery*. Earth: *Earth in view: direct radio*, *Earth hidden: no direct radio*, or *Earth never rises: relay needed* (Earth's elevation stays below −2° for all 30 days, as on the far side). |
| **Countdown** | Time until the next change of state within the 30-day window: *Sunset / Sunrise in …*, *Earthset / Earthrise in …*. If nothing changes before day 30: *Stays up / Stays down for the rest of the 30 days*. |
| **Sun elevation / Earth elevation** | Elevation of the body's centre. The Sun's value is highlighted because it drives solar power: at the pole it rarely exceeds about 2°. |
| **Above skyline** | Clearance above the terrain in that direction. Values within about the disc radius mean the body is grazing the skyline. |
| Small line | Azimuth with compass direction, skyline elevation in that direction, and % of the disc visible. |

### Statistics (over the 30 days after landing, hourly samples)

| Statistic | Definition |
|---|---|
| **Time in sunlight** | % of hours with the Sun up. |
| **Time Earth in view** | % of hours with Earth up. |
| **Power and Earth link** | % of hours with both up: the lander can charge *and* talk to Earth directly. |
| **Longest darkness** | Longest continuous stretch with the Sun hidden (battery-only operation). Shown in hours, or days when 48 h or longer. |
| **Longest radio gap** | Longest continuous stretch with Earth hidden. |
| **Average Sun height** | Mean Sun elevation over the hours when it is up. |

**Differences in Plan B** (small coloured numbers): B minus A. Percentages are shown in
percentage points (*pts*), durations in hours (*h*), Sun height in degrees. Green means better for
the mission (more sunlight / Earth time, shorter gaps), red means worse. Differences smaller than
0.5 pts / 0.5 h / 0.05° are hidden.

### Move the pad (polar sites only)

A 5 x 5 grid of alternative pads, 1 km apart, centred on the site's pad. North is up, east is right.

| Element | Meaning |
|---|---|
| **Sunlight / Earth / Both** | Which 30-day statistic colours the grid (same definitions as above, sampled every 2 h). |
| Number in a square | That statistic in % for a pad at that position. Stronger colour means a higher value. |
| Dashed inner border | The original pad. |
| White outline | The pad currently used by the plan. Click any square to move the plan there; the whole page updates. |
| Hatched square | Local slope over 10°: too steep for a crewed lander (Artemis requires < 10°). |
| Text | The value at the current pad, a slope warning if needed, and the best landable square nearby. |

### Download 30-day table (CSV)

Hourly table for the plan as currently set. A first comment line records site, coordinates and
landing time. Columns:

| Column | Meaning |
|---|---|
| `time_utc` | Sample time |
| `hours_after_landing` | 0…720 |
| `sun_az_deg`, `sun_el_deg` | Sun azimuth and elevation |
| `sun_skyline_deg` | Terrain skyline in the Sun's direction |
| `sun_disc_visible` | Share of the solar disc above the skyline (0–1) |
| `earth_az_deg`, `earth_el_deg`, `earth_skyline_deg`, `earth_disc_visible` | Same for Earth |
| `power`, `direct_to_earth` | 1 if the Sun / Earth is up, else 0 |

---

## What the lander sees (horizon panorama)

One panorama per plan: the full 360° view from 2 m above the pad.

| Element | Meaning |
|---|---|
| Horizontal axis | Azimuth: N, E, S, W, N. |
| Vertical axis | Elevation in degrees. The scale adapts to each site. |
| **vertical ×N** | How much the vertical scale is stretched relative to the horizontal, so the few degrees that matter at the pole are visible. Mountains look steeper than they are. |
| Grey silhouette | Terrain skyline from LOLA laser altimetry (or a flat line for smooth-sphere sites). |
| Gold line | Path of the Sun over the 30 days after landing (hourly). Where it passes behind the silhouette, the Sun is hidden. |
| Blue line | Path of Earth over the same 30 days. At the pole it traces a small loop as Earth bobs with libration. |
| Discs | Sun and Earth at the current mission time, at their true angular size (stretched with the vertical scale, minimum 4 px). Faded with a dashed ring when hidden. |

---

## First 30 days after landing (timeline)

One strip per plan, one column per hour.

| Colour | Meaning |
|---|---|
| White | Power and Earth link |
| Gold | Power only (Sun up, Earth hidden) |
| Blue | Earth link only (Earth up, Sun hidden) |
| Dark | Neither: on battery with no direct radio |

The white vertical line is the current mission time. Click or drag a strip to move it.

---

## Across the year

One chart per plan, 12 periods of 365/12 days starting at the landing time (labelled by the
calendar month in the middle of each period).

| Bar | Meaning |
|---|---|
| Gold | % of the period with the Sun up (3-hour samples) |
| Blue | % of the period with Earth up |

At the pole, the Moon's 1.5° tilt creates seasons: the same site can be lit almost all month in
one part of the year and dark for long stretches in another.

---

## Pick any point near the pole (map)

| Element | Meaning |
|---|---|
| Shaded relief | LOLA terrain within 300 km of the south pole (480 m resolution), lit from the upper left, polar stereographic projection centred on the pole. |
| Rings | Latitude 88°S, 86°S, 84°S, 82°S. |
| Edge labels | Longitude. 0° points toward the Earth-facing side. |
| White dots | Curated polar sites. |
| **A** / **B** markers | Current position of each plan (only when it lies on the map). |
| Gold / blue arrows | Direction of the Sun / Earth from that plan at the current mission time. Dashed and faded when the body is hidden by terrain. |
| **Place plan A / Place plan B** | Which plan a click on the map moves. |
| Click on the map | Sets that plan to a custom point there. Its skyline is computed in the browser from the 480 m terrain (about 0.1–0.2 s). |
| Status line | Confirms the new position, or explains that the click was outside the terrain map. |

---

## Sites

Coordinates are those used by the app (planetocentric latitude, east longitude).

| Site | Group | Lat, Lon | Terrain | Pad | Move the pad |
|---|---|---|---|---|---|
| Connecting Ridge | Artemis / LOLA study site | −89.4380, −137.2830 | 80 m LOLA | moved 0.79 km, slope 1.1° | yes |
| Shackleton Rim | Artemis / LOLA study site | −89.7797, −156.3510 | 80 m LOLA | moved 1.90 km, slope 1.8° | yes |
| Peak near Shackleton | Artemis / LOLA study site | −88.8077, 123.8131 | 80 m LOLA | moved 0.08 km, slope 1.3° | yes |
| de Gerlache Rim | Artemis III candidate | −88.6648, −68.3773 | 80 m LOLA | moved 0.64 km, slope 2.3° | yes |
| de Gerlache-Kocher Massif | Artemis / LOLA study site | −85.7822, −116.4930 | 80 m LOLA | moved 1.48 km, slope 4.7° | yes |
| Malapert Massif | Artemis III candidate | −85.9901, 0.4333 | 80 m LOLA | moved 1.45 km, slope 5.6° | yes |
| Nobile Rim 1 | Artemis III candidate | −85.4819, 37.6022 | 80 m LOLA | moved 1.49 km, slope 1.9° | yes |
| Leibnitz Beta Plateau | Artemis / LOLA study site | −85.4042, 31.7249 | 80 m LOLA | moved 0.72 km, slope 1.1° | yes |
| IM-2 Athena (Mons Mouton) | CLPS landing | −84.7906, 29.1957 | 80 m LOLA | touchdown point, slope 2.9° | yes |
| IM-1 Odysseus (Malapert A) | CLPS landing | −80.1300, 1.4400 | 80 m LOLA | touchdown point, slope 10.9° | yes |
| Blue Ghost 1 (Mare Crisium) | CLPS landing | 18.5620, 61.8100 | smooth sphere | touchdown point | no |
| Chandrayaan-3 (Shiv Shakti) | Other lunar programmes | −69.3730, 32.3190 | smooth sphere | touchdown point | no |
| SLIM (Shioli crater) | Other lunar programmes | −13.3160, 25.2510 | smooth sphere | touchdown point | no |
| Chang'e 4 (Von Kármán, far side) | Other lunar programmes | −45.4561, 177.5885 | smooth sphere | touchdown point | no |
| Chang'e 6 (Apollo basin, far side) | Other lunar programmes | −41.6385, −153.9852 | smooth sphere | touchdown point | no |
| Apollo 11 (Tranquility Base) | Apollo | 0.6741, 23.4730 | smooth sphere | touchdown point | no |
| Apollo 14 (Fra Mauro) | Apollo | −3.6459, −17.4719 | smooth sphere | touchdown point | no |

Study-region centres come from NASA's LOLA study sites (Lunar Surface Data Book, 2025); landing
coordinates from NASA NSSDC, LROC, JAXA, ISRO and mission releases.

---

## Shareable links

The page address stores both plans, so a copied link reopens the same comparison:

```
#a=<site>,<lat>,<lon>,<date>,<hour>,<padEast>,<padNorth>&b=...
```

`<site>` is a site id (for example `malapert-massif`) or `custom`; `<padEast>` and `<padNorth>`
are the *Move the pad* offsets in km (−2…2).

---

## Assumptions and limits

- **Ephemeris.** Sun and Earth positions come from astronomy-engine (VSOP87 and ELP series, IAU
  lunar orientation including physical libration), computed in the browser. Checked against
  NASA/JPL Horizons at three sites over a year: largest difference 0.003°.
- **Terrain.** LOLA polar DEMs `LDEM_80S_80M` (within 80°S) and `LDEM_75S_240M` (within 75°S).
  The skyline is the highest terrain seen along each azimuth out to 450 km, every 0.5°. The
  Moon's curvature is included, and there is no atmospheric refraction because the Moon has no
  atmosphere.
- **Observer.** 2 m above the ground, roughly the height of a lander's solar panels or antenna.
- **Pads for study regions.** NASA publishes region centres, not pads, and some centres sit on
  crater walls. The app uses the highest point within 1.5 km (3 km if needed) whose slope is
  under 8°.
- **Custom points on the map.** The skyline is computed from 480 m terrain. At the curated sites
  it is within 0.6° rms of the 80 m model, so values close to the skyline should be treated as
  uncertain.
- **Sites outside the polar maps** (latitudes north of about 76°S) use a smooth-sphere horizon:
  local hills and crater walls are ignored.
- **Not modelled.** Solar panel orientation and efficiency, temperatures, antenna pointing and
  link budget, relay satellites, and Earth's own day–night side. "Visible" means a clear
  geometric line of sight, not a guarantee of power or of a radio link.
- **Time sampling.** Cards and the timeline use hourly samples; *Move the pad* uses 2-hour
  samples; *Across the year* uses 3-hour samples. Countdowns are accurate to about an hour.
