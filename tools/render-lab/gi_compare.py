"""Reads a GI lab scene's regions in the Cycles picture and in one or more engine pictures, in linear light.
python gi_compare.py <lab> <ref.png> <name=engine.png> [...]   prints, per region, Cycles' linear value and each engine picture's share of it.
The share is of the indirect light alone where the region is not lit directly, which is every region but the sun's patch.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gi_specs as S  # noqa: E402


def lin(img):
    c = img / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


lab, ref_path = sys.argv[1:3]
engines = [a.split('=', 1) for a in sys.argv[3:]]
ref = lin(np.array(Image.open(ref_path).convert('RGB')).astype(float))
eng = {n: lin(np.array(Image.open(p).convert('RGB')).astype(float)) for n, p in engines}
spec = S.GI[lab]
R = 10


def patch(img, px, py):
    return img[int(py) - R:int(py) + R, int(px) - R:int(px) + R].reshape(-1, 3).mean(0)


rows = []
for name, pt in S.REGIONS[lab]:
    if pt is None:
        pt = S.sun_patch_centre(lab)
    px, py, z = S.project(pt, spec['cam'])
    if z <= 0 or not (R <= px < S.SIZE[0] - R and R <= py < S.SIZE[1] - R):
        print('%-22s off screen' % name)
        continue
    r = patch(ref, px, py)
    cells = []
    for n, im in eng.items():
        e = patch(im, px, py)
        cells.append('%s %s' % (n, ' '.join('%4.2f' % (e[k] / r[k]) if r[k] > 1e-3 else ' -- ' for k in range(3))))
    rows.append(name)
    print('%-22s cycles %.3f %.3f %.3f | %s' % (name, r[0], r[1], r[2], ' | '.join(cells)))

# The whole picture: the share of Cycles' light (linear luminance summed over the frame) each engine picture holds, and the mean error.
Y = lambda im: im @ np.array([0.2126, 0.7152, 0.0722])
print('frame light share: ' + '  '.join('%s %.2f (mean |d| %.4f)' % (n, Y(im).sum() / Y(ref).sum(), np.abs(Y(im) - Y(ref)).mean()) for n, im in eng.items()))
