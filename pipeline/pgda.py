"""
Windowed reader for NASA PGDA LOLA GeoTIFFs (south polar stereographic, metres).

The PGDA files are large (the 80 m slope map alone is 242 MB, the 20 m PSR map
154 MB) but tiled or striped, and the server accepts HTTP range requests. We
only need small windows around each landing pad, so this module fetches just
the TIFF segments that cover a window and caches each one under
data/raw/pgda_cache/ (git-ignored). A rerun works offline from the cache.

Products used (all NASA GSFC PGDA, LOLA team):
  * LOLA_20mpp/LDSM_80S_80MPP_ADJ.TIF      slope (deg), 80 m/px, 80-90 S
  * LOLA_20mpp/LDSM_80S_80MPP_ADJ_ERR.TIF  slope uncertainty (deg)
  * LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF      permanently shadowed regions, 20 m/px
    -> Barker et al. 2023, PSJ 4, 183, doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole
  * LOLA_5mpp/SiteNN/SiteNN_final_adj_5mpp_slp.tif / _slperr.tif  slope + uncertainty, 5 m/px
    -> Barker et al. 2021, PSS 203, 105119, doi:10.1016/j.pss.2020.105119

Needs: numpy, tifffile, imagecodecs (for the floating-point predictor).
"""
from __future__ import annotations

import io
import math
import urllib.request
from pathlib import Path

import numpy as np
import tifffile

BASE = "https://pgda.gsfc.nasa.gov/data/"
CACHE = Path(__file__).resolve().parent.parent / "data" / "raw" / "pgda_cache"
R_MOON_M = 1737400.0


def polar_xy(lat, lon):
    """South polar stereographic x, y (m), same convention as the LOLA PDS grids."""
    rho = 2 * R_MOON_M * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


class _HTTPFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests (only used for TIFF headers)."""
    BLOCK = 1 << 16

    def __init__(self, url):
        self.url, self.pos, self.blocks = url, 0, {}
        head = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60)
        self.size = int(head.headers["Content-Length"])

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def fetch(self, a, n):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={a}-{a + n - 1}"})
        for attempt in range(4):
            try:
                return urllib.request.urlopen(req, timeout=180).read()
            except OSError:
                if attempt == 3:
                    raise

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if not n:
            return b""
        a, b = self.pos, self.pos + n
        out = bytearray()
        for k in range(a // self.BLOCK, (b - 1) // self.BLOCK + 1):
            if k not in self.blocks:
                s = k * self.BLOCK
                self.blocks[k] = self.fetch(s, min(self.BLOCK, self.size - s))
            out += self.blocks[k]
        o = a - (a // self.BLOCK) * self.BLOCK
        self.pos = b
        return bytes(out[o:o + n])

    def readinto(self, buf):
        d = self.read(len(buf))
        buf[:len(d)] = d
        return len(d)


class Raster:
    """One remote GeoTIFF; read(x, y, half_m) returns a window around a polar x/y point."""

    def __init__(self, rel_path):
        self.rel = rel_path
        self.dir = CACHE / rel_path.replace("/", "__")
        self.dir.mkdir(parents=True, exist_ok=True)
        self.f = _HTTPFile(BASE + rel_path)
        self.page = tifffile.TiffFile(self.f).pages[0]
        p = self.page
        self.h, self.w = p.shape
        self.scale = float(p.tags["ModelPixelScaleTag"].value[0])
        tie = p.tags["ModelTiepointTag"].value
        self.x0, self.y0 = float(tie[3]), float(tie[4])           # upper-left corner (m)
        if p.is_tiled:
            self.seg_h, self.seg_w = p.tilelength, p.tilewidth
        else:
            self.seg_h, self.seg_w = p.rowsperstrip, self.w
        self.nx = math.ceil(self.w / self.seg_w)

    def px(self, x, y):
        """Fractional (row, col) of pixel centres for polar x/y in metres."""
        return (self.y0 - y) / self.scale - 0.5, (x - self.x0) / self.scale - 0.5

    def covers(self, x, y, margin_px=0):
        r, c = self.px(x, y)
        return margin_px <= r < self.h - margin_px and margin_px <= c < self.w - margin_px

    def _segment(self, sr, sc):
        idx = sr * self.nx + sc
        f = self.dir / f"{idx}.npy"
        if f.exists():
            return np.load(f)
        p = self.page
        raw = self.f.fetch(p.dataoffsets[idx], p.databytecounts[idx])
        a = p.decode(raw, idx)[0]
        a = np.asarray(a).reshape(-1, self.seg_w)[: self.seg_h].astype(np.float32)
        np.save(f, a)
        return a

    def window(self, x, y, half_m):
        """Array of pixels within +-half_m of (x, y) and the pixel coords of the centre in it."""
        r, c = self.px(x, y)
        hp = int(math.ceil(half_m / self.scale))
        r0, r1 = max(0, int(round(r)) - hp), min(self.h, int(round(r)) + hp + 1)
        c0, c1 = max(0, int(round(c)) - hp), min(self.w, int(round(c)) + hp + 1)
        out = np.full((r1 - r0, c1 - c0), np.nan, np.float32)
        for sr in range(r0 // self.seg_h, (r1 - 1) // self.seg_h + 1):
            for sc in range(c0 // self.seg_w, (c1 - 1) // self.seg_w + 1):
                a = self._segment(sr, sc)
                ar0, ac0 = sr * self.seg_h, sc * self.seg_w
                rr0, rr1 = max(r0, ar0), min(r1, ar0 + a.shape[0])
                cc0, cc1 = max(c0, ac0), min(c1, ac0 + a.shape[1])
                if rr1 > rr0 and cc1 > cc0:
                    out[rr0 - r0:rr1 - r0, cc0 - c0:cc1 - c0] = a[rr0 - ar0:rr1 - ar0, cc0 - ac0:cc1 - ac0]
        return out, (r - r0, c - c0)

    def value(self, x, y):
        a, _ = self.window(x, y, 0)
        return float(a[0, 0]) if a.size else float("nan")
