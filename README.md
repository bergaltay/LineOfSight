# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026, challenge *Lunar Landing Site Navigator*. Team from Ankara.

Compare two lunar landing plans (site + date) at a glance: when the Sun is above the real
terrain horizon (solar power) and when Earth is (direct-to-Earth radio).

## Quick start (no install, no build)

Everything the app needs is already in this repository (`web/data/`, about 4.5 MB), so it runs
offline from a fresh clone. You need a web browser and Python 3.

| System | Run |
|---|---|
| macOS / Linux | `./start.sh` |
| Windows | double-click `start.bat` |
| Any | `python3 -m http.server 8000` in this folder, then open <http://localhost:8000/web/> |

The script starts a local web server and opens <http://localhost:8000/web/>. Opening
`web/index.html` straight from disk does not work: browsers do not let a `file://` page load its
data files. Any other static web server works as well. Tested in Chrome.

**Try this:** the page opens with plan A at Connecting Ridge and plan B at Malapert Massif.
Read the verdict in step 2 (Connecting Ridge has sunlight nearly all month, Malapert keeps Earth
in view far longer), then click the numbered circle near the pole on the map, switch plan B to
Shackleton Rim, and press **Play** in step 3.

**Features**

The page follows the decision: **1** pick a site and date for each plan, **2** see which plan is
better, **3** look at any moment from the lander, **4** refine the pad and share.

- **South pole map first:** shaded LOLA relief with the curated sites; nearby sites share a
  numbered marker that opens a list. Click a site, or any point on the terrain (skyline computed
  in the browser), for plan A or B. Sites beyond the map are one click away below it.
- 17 curated sites: Artemis III / LOLA study regions, CLPS landings (IM-1, IM-2, Blue Ghost 1),
  Chandrayaan-3, SLIM, Chang'e 4 and 6 (far side), Apollo 11 and 14, plus custom coordinates
- Landing date and hour, with one-click shifts of ±1 day and ±1 lunar month; **across the year**
  chart of monthly sunlight and Earth visibility (polar seasons), click a month to land then
- **Landing safety:** NASA LOLA slope (80 m, and 5 m at six sites, with 1σ) and permanent-shadow
  checks for each polar pad
- **Comparison table** of plan A and B over 30 days, better plan marked, with a one-sentence
  summary; 30-day hour-by-hour timeline (power and link / power only / link only / neither)
- 360° horizon panorama with the Sun's and Earth's 30-day paths over real LOLA terrain, animated;
  countdown to the next sunset / sunrise and Earthset / Earthrise, elevation and clearance
- **Move the pad:** 5 x 5 grid of pads 1 km apart around each polar site, coloured by sunlight,
  Earth visibility or both, with steep or permanently shadowed pads flagged
- CSV export of the 30-day table; shareable links (state in the URL)

Every value and control is explained in the [interface guide](docs/UI_GUIDE.md).

## How it works

| Piece | What it does | Data |
|---|---|---|
| `pipeline/ephem.py` | Topocentric Sun/Earth azimuth & elevation from any lunar surface point | astronomy-engine (VSOP87, ELP, IAU lunar orientation with libration) |
| `pipeline/validate_horizons.py` | Compares the above with NASA/JPL Horizons | Horizons API samples, 3 sites x 1 year |
| `pipeline/horizon.py` | 360 deg terrain skyline per site (0.5 deg steps, out to 450 km, lunar curvature included, no refraction) | LOLA `LDEM_80S_80M` + `LDEM_75S_240M` |
| `pipeline/build_data.py` | Writes `web/data/sites.json` (sites + horizons) and `web/data/grid/*.json` (5 x 5 pad grids) | `pipeline/sites.py` |
| `pipeline/build_dem.py` | Writes `web/data/dem_south_480m.bin`, a 480 m terrain grid (300 km around the pole) for the map and custom points | LOLA `LDEM_75S_240M` |
| `pipeline/build_shade.py` | Writes `web/data/shade_south_480m.webp`, the pre-rendered shaded relief for the map (same shading as `web/js/terrain.js`), so the map appears before the terrain grid loads | `web/data/dem_south_480m.bin` |
| `pipeline/build_safety.py` | Writes `web/data/safety.json`: slope at each pad (80 m everywhere, 5 m at six sites, with 1σ), slope statistics over 500 m / 100 m circles, permanent-shadow check and nearest PSR, per-cell slope and PSR for the pad grid. `pipeline/pgda.py` fetches only the TIFF tiles around each pad (HTTP range requests) and caches them in `data/raw/pgda_cache/` | NASA GSFC PGDA: `LDSM_80S_80MPP_ADJ` (+`_ERR`), `LPSR_80S_20MPP_ADJ`, 5 m site DEMs `Site01/04/07/11/20/23` (`slp`, `slperr`) |
| `web/` | Static web app; ephemeris (`web/js/ephem.js`, same math as Python) and custom-point skylines (`web/js/terrain.js`) run in the browser | — |

**Validation**

- Ephemeris vs JPL Horizons: largest difference 0.003 deg in azimuth or elevation
  (the Sun's disc is ~0.53 deg wide).
- Terrain georeferencing: at the IM-1 Odysseus touchdown point our DEM gives +2594 m and a
  10.9 deg slope; LROC reports 2579 m and the landing team reports a ~12 deg slope.
- Annual sunlight at Connecting Ridge (88%) is in the range published by polar illumination studies.
- Browser skylines for custom points (480 m terrain) are within 0.6 deg rms of the 80 m pipeline
  at the curated sites.

**Landing pads:** NASA publishes region centres, not pads, and some centres sit on crater walls
(Shackleton Rim's centre is on a ~31 deg slope). For each region we place the pad on the highest
cell within 1.5 km (3 km fallback) whose slope is below 8 deg (Artemis requires < 10 deg), then
compute the skyline for an observer 2 m above that pad.

**Year 2027 at each pad** (2 h steps, disc centre above the terrain skyline):

| Site | Sunlight | Earth in view | Both | Longest darkness | Longest radio gap |
|---|---|---|---|---|---|
| Connecting Ridge | 88% | 51% | 48% | 9.7 d | 13.3 d |
| Shackleton Rim | 84% | 50% | 43% | 6.3 d | 13.9 d |
| Peak near Shackleton | 84% | 51% | 47% | 12.3 d | 13.5 d |
| de Gerlache Rim | 82% | 55% | 45% | 11.3 d | 12.6 d |
| de Gerlache-Kocher Massif | 73% | 52% | 37% | 11.0 d | 13.0 d |
| Malapert Massif | 58% | 80% | 44% | 15.3 d | 5.8 d |
| Nobile Rim 1 | 49% | 50% | 27% | 12.3 d | 13.7 d |
| Leibnitz Beta Plateau | 63% | 84% | 52% | 14.0 d | 4.8 d |
| Chandrayaan-3 (no terrain) | 49% | 100% | 49% | 15.4 d | 0 d |
| Apollo 11 (no terrain) | 49% | 100% | 49% | 14.8 d | 0 d |

The trade-off is the story: the best-lit ridges near Shackleton see Earth only half the time,
while Earth-facing Malapert and Leibnitz Beta keep radio contact > 80% of the time but get less sun.

## Rebuild the data (optional)

Only needed to change the sites or regenerate `web/data/` from the original NASA data; the app
itself does not need this.

1. Download the LOLA DEMs from the
   [PDS Geosciences Node](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/)
   into `data/raw/`: `ldem_80s_80m_float.img` (231 MB) and `ldem_75s_240m_float.img` (58 MB).
   These are not in the repository (`data/raw/` is ignored by git).

2. Run the Python pipeline. `validate_horizons.py` compares the ephemeris with JPL Horizons;
   `build_data.py` writes the horizon profiles to `web/data/sites.json`.

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install astronomy-engine numpy scipy tifffile imagecodecs pillow
   python pipeline/validate_horizons.py
   python pipeline/build_data.py
   python pipeline/build_dem.py
   python pipeline/build_shade.py
   python pipeline/build_safety.py   # needs network on first run (NASA PGDA)
   ```

3. Start the app as in [Quick start](#quick-start-no-install-no-build).

## Data and credits

- NASA LRO Lunar Orbiter Laser Altimeter (LOLA) gridded data records, PDS Geosciences Node.
- NASA/JPL Horizons System (validation reference).
- NASA GSFC PGDA LOLA south-pole slope, slope-uncertainty and permanent-shadow maps (Barker et al. 2023, PSJ 4, 183, doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole) and 5 m/px landing-site DEMs (Barker et al. 2021, PSS 203, 105119, doi:10.1016/j.pss.2020.105119).
- Site centres: NASA LOLA study regions, Lunar Surface Data Book (2025).
- Landing coordinates: NASA NSSDC, LROC (Arizona State University), JAXA, ISRO and mission releases.
- astronomy-engine by Don Cross, MIT License.

Visibility means a clear geometric line of sight to the body's disc; it is not a power or
link-budget model. Not an official NASA product.
