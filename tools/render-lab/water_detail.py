"""The fine ripple normal map a Water material tiles over its waves: python tools/render-lab/water_detail.py <out.png> [size] [seed]

Two layers, red and green the first's slope and blue and alpha the second's (0.5 flat), which is what u_detailMap reads. Each is the slope of a
sum of many waves in every direction. A whole number of cycles to the tile makes it seamless, and no wave is strong enough to be seen alone: a map
that is mostly one wave lays straight parallel lines across a whole sea, however the waves under it are bent.
"""
import math
import random
import sys

import numpy as np
from PIL import Image


def layer(size, low, high, count, rng):
    """(dh/dx, dh/dy) of `count` waves of low..high cycles to the tile, each direction as likely as any other, with less height the shorter."""
    v, u = np.mgrid[0:size, 0:size] / size
    sx = np.zeros((size, size))
    sy = np.zeros((size, size))
    seen = set()
    while len(seen) < count:
        radius = rng.uniform(low, high)
        angle = rng.uniform(0, math.pi * 2)
        fx, fy = round(radius * math.cos(angle)), round(radius * math.sin(angle))
        if (fx, fy) in seen or (-fx, -fy) in seen or not low <= math.hypot(fx, fy) <= high:
            continue
        seen.add((fx, fy))
        k = math.hypot(fx, fy)
        amp = rng.uniform(0.6, 1.0) / k
        phase = 2 * math.pi * (fx * u + fy * v) + rng.uniform(0, math.pi * 2)
        sx += amp * fx * np.cos(phase)
        sy += amp * fy * np.cos(phase)
    return sx, sy


def main():
    out = sys.argv[1]
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
    # A channel's spread around 0.5. Slopes are read steep (1 in 60 of them), and the material's u_detailStrength scales them from there.
    spread = 0.016
    channels = []
    for low, high, count in ((3, 14, 72), (8, 34, 96)):
        for s in layer(size, low, high, count, rng):
            channels.append(0.5 + s / s.std() * spread)
    image = np.stack(channels, axis=-1)
    Image.fromarray((np.clip(image, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(out)


if __name__ == '__main__':
    main()
