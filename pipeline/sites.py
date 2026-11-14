"""
Curated landing sites.

South-pole study regions: centre points published by NASA for the LOLA
high-resolution study sites (NASA Lunar Surface Data Book, 2025; PGDA).
These are regional reference points, not landing ellipses, so build_data.py
moves the pad to the highest gentle (< 8 deg) ground nearby (snap=True).

Actual landings use the published touchdown coordinates as-is (snap=False):
IM-1 / IM-2 / Chang'e / SLIM / Blue Ghost / Apollo from NASA NSSDC, LROC and
mission releases.

Sites outside the polar DEMs are modelled with a bare-sphere horizon
(flagged `terrain: false`).
"""

SITES = [
    # id, name, lat, east-lon, group, note, snap
    ("connecting-ridge", "Connecting Ridge", -89.4632, -137.49000, "Artemis / LOLA study site",
     "High ridge linking Shackleton and de Gerlache craters (Site01).", True),
    ("shackleton-rim", "Shackleton Rim", -89.7668, -171.87000, "Artemis / LOLA study site",
     "Rim of Shackleton crater, almost exactly at the pole (Site04).", True),
    ("peak-near-shackleton", "Peak near Shackleton", -88.8110, 123.69010, "Artemis / LOLA study site",
     "Elevated region between Shackleton and Slater craters (Site07).", True),
    ("de-gerlache-rim", "de Gerlache Rim", -88.6834, -67.93210, "Artemis III candidate",
     "Rim of de Gerlache crater (Site11).", True),
    ("de-gerlache-kocher", "de Gerlache-Kocher Massif", -85.8296, -116.32200, "Artemis / LOLA study site",
     "Massif between de Gerlache and Kocher craters (Site42).", True),
    ("malapert-massif", "Malapert Massif", -85.9948, -0.23578, "Artemis III candidate",
     "~5 km high massif on the Earth-facing side of the pole (Site23).", True),
    ("nobile-rim-1", "Nobile Rim 1", -85.4381, 37.36667, "Artemis III candidate",
     "South-western rim of Nobile crater (Site06).", True),
    ("leibnitz-beta", "Leibnitz Beta Plateau", -85.4266, 31.74276, "Artemis / LOLA study site",
     "Plateau region, later refined into the Mons Mouton candidates (Site20).", True),
    # --- CLPS landings (NASA Commercial Lunar Payload Services) ---
    ("im-2", "IM-2 Athena (Mons Mouton)", -84.7906, 29.1957, "CLPS landing",
     "Intuitive Machines, 6 March 2025: southernmost landing so far, on the Mons Mouton plateau.", False),
    ("im-1", "IM-1 Odysseus (Malapert A)", -80.13, 1.44, "CLPS landing",
     "Intuitive Machines, 22 February 2024: first commercial soft landing, on a ~12 deg slope.", False),
    ("blue-ghost-1", "Blue Ghost 1 (Mare Crisium)", 18.562, 61.810, "CLPS landing",
     "Firefly Aerospace, 2 March 2025: first fully successful commercial landing.", False),
    # --- other agencies ---
    ("chandrayaan-3", "Chandrayaan-3 (Shiv Shakti)", -69.373, 32.319, "Other lunar programmes",
     "ISRO, 2023: high southern latitude, but Earth is always in view.", False),
    ("slim", "SLIM (Shioli crater)", -13.3160, 25.2510, "Other lunar programmes",
     "JAXA, 19 January 2024: the 'Moon Sniper' pinpoint landing.", False),
    ("change-4", "Chang'e 4 (Von Kármán, far side)", -45.4561, 177.5885, "Other lunar programmes",
     "CNSA, 2019: on the far side Earth never rises, so all radio goes through the Queqiao relay.", False),
    ("change-6", "Chang'e 6 (Apollo basin, far side)", -41.6385, -153.9852, "Other lunar programmes",
     "CNSA, 2024: first far-side sample return; no direct line of sight to Earth.", False),
    # --- Apollo ---
    ("apollo-11", "Apollo 11 (Tranquility Base)", 0.67408, 23.47297, "Apollo",
     "Equatorial: Earth hangs high in the sky, Sun rises and sets every ~29.5 days.", False),
    ("apollo-14", "Apollo 14 (Fra Mauro)", -3.64589, -17.47194, "Apollo",
     "Near side, close to the equator: Earth stays high, roughly two weeks of day and night.", False),
]
