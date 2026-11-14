# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026, challenge *Lunar Landing Site Navigator*. Team from Ankara.

Compare two lunar landing plans (site + date) at a glance: when the Sun is above the real
terrain horizon (solar power) and when Earth is (direct-to-Earth radio), with countdowns to
the next sunset / Earthset and a 30-day timeline after landing.

## How it works

| Piece | What it does | Data |
|---|---|---|
| `pipeline/ephem.py` | Topocentric Sun/Earth azimuth & elevation from any lunar surface point | astronomy-engine (VSOP87, ELP, IAU lunar orientation with libration) |
| `pipeline/validate_horizons.py` | Compares the above with NASA/JPL Horizons | Horizons API samples, 3 sites x 1 year |
| `pipeline/horizon.py` | 360 deg terrain skyline per site (0.5 deg steps, out to 450 km, lunar curvature included, no refraction) | LOLA `LDEM_80S_80M` + `LDEM_75S_240M` |
| `pipeline/build_data.py` | Writes `web/data/sites.json` (site metadata + horizon profiles) | `pipeline/sites.py` |
| `web/` | Static web app; ephemeris runs live in the browser (`web/js/ephem.js`, same math as Python) | — |

**Validation:** against Horizons, the largest difference is 0.003 deg in azimuth or elevation
(the Sun's disc is ~0.53 deg wide).

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

## Run it

1. Download the LOLA DEMs from the
   [PDS Geosciences Node](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/)
   into `data/raw/`: `ldem_80s_80m_float.img` (231 MB) and `ldem_75s_240m_float.img` (58 MB).

2. Run the Python pipeline. `validate_horizons.py` compares the ephemeris with JPL Horizons;
   `build_data.py` writes the horizon profiles to `web/data/sites.json`.

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install astronomy-engine numpy scipy
   python pipeline/validate_horizons.py
   python pipeline/build_data.py
   ```

3. Serve the web app and open http://localhost:8000

   ```bash
   cd web
   python3 -m http.server 8000
   ```

The live version is served from GitHub Pages; the root `index.html` redirects to `web/`.

## Data and credits

- NASA LRO Lunar Orbiter Laser Altimeter (LOLA) gridded data records, PDS Geosciences Node.
- NASA/JPL Horizons System (validation reference).
- Site centres: NASA LOLA study regions, Lunar Surface Data Book (2025).
- astronomy-engine by Don Cross, MIT License.

Visibility means a clear geometric line of sight to the body's disc; it is not a power or
link-budget model. Not an official NASA product.
