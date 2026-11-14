"""
Curated landing sites.

South-pole study regions: centre points published by NASA for the LOLA
high-resolution study sites (NASA Lunar Surface Data Book, 2025; PGDA).
These are regional reference points, not landing ellipses.

Non-polar sites are included for contrast. They lie outside the polar DEMs,
so their horizon is modelled as a bare sphere (flagged `terrain: false`).
"""

SITES = [
    # id, name, lat, east-lon, group, note
    ("connecting-ridge", "Connecting Ridge", -89.4632, -137.49000, "Artemis / LOLA study site",
     "High ridge linking Shackleton and de Gerlache craters (Site01)."),
    ("shackleton-rim", "Shackleton Rim", -89.7668, -171.87000, "Artemis / LOLA study site",
     "Rim of Shackleton crater, almost exactly at the pole (Site04)."),
    ("peak-near-shackleton", "Peak near Shackleton", -88.8110, 123.69010, "Artemis / LOLA study site",
     "Elevated region between Shackleton and Slater craters (Site07)."),
    ("de-gerlache-rim", "de Gerlache Rim", -88.6834, -67.93210, "Artemis III candidate",
     "Rim of de Gerlache crater (Site11)."),
    ("de-gerlache-kocher", "de Gerlache-Kocher Massif", -85.8296, -116.32200, "Artemis / LOLA study site",
     "Massif between de Gerlache and Kocher craters (Site42)."),
    ("malapert-massif", "Malapert Massif", -85.9948, -0.23578, "Artemis III candidate",
     "~5 km high massif on the Earth-facing side of the pole (Site23)."),
    ("nobile-rim-1", "Nobile Rim 1", -85.4381, 37.36667, "Artemis III candidate",
     "South-western rim of Nobile crater (Site06)."),
    ("leibnitz-beta", "Leibnitz Beta Plateau", -85.4266, 31.74276, "Artemis / LOLA study site",
     "Plateau region, later refined into the Mons Mouton candidates (Site20)."),
    # --- contrast sites (no polar DEM) ---
    ("chandrayaan-3", "Chandrayaan-3 (Shiv Shakti)", -69.373, 32.319, "Past landing (ISRO)",
     "India's 2023 landing site, high southern latitude but far from the pole."),
    ("apollo-11", "Apollo 11 (Tranquility Base)", 0.67408, 23.47297, "Past landing (NASA)",
     "Equatorial: Earth hangs high in the sky, Sun rises and sets every ~29.5 days."),
]
