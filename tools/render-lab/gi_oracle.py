"""The GI check: each of the engine's global-illumination methods, against Blender's Cycles, over the GI lab's rooms.

python tools/render-lab/gi_oracle.py                run the engine side (export + hidden shot, about 17 s a picture) and check it against gi_reference.json
python tools/render-lab/gi_oracle.py --reference    rebuild gi_reference.json from Cycles pictures (output/render-lab/gi/ref_<lab>.png; see gi_ref.py)
python tools/render-lab/gi_oracle.py --methods baked,vgi --labs gi_room

gi_reference.json is Cycles' linear light (12 bounces) over each region of each room, so this needs no Blender once it is written. The engine
side needs the engine built and, for the voxel method, a real GPU (a software rasteriser draws it black). What is asserted is the share of
Cycles' light each method puts in each region that the sun does not light directly, in a band: the band is the accuracy the method has today,
so a change that makes a method worse fails, and a change that makes it better says the band can come in. `KNOWN_GAP` marks a result that is
wrong and why; when it stops being wrong the check says so.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import gi_specs as S  # noqa: E402

OUT = os.path.join(ROOT, 'output', 'render-lab', 'gi')
REFERENCE = os.path.join(HERE, 'gi_reference.json')
RADIUS = 10

METHODS = {
    'baked': {'BAKE': '1', 'BOUNCES': '8'},
    'vgi': {'EFFECTS': json.dumps([{'type': 'voxelGI', 'enabled': True, 'uniforms': {}}])},
    'dgi': {'BACKEND': 'webgpu', 'HEADLESS_GPU': '1', 'EFFECTS': json.dumps([{'type': 'dynamicGI', 'enabled': True, 'uniforms': {}}])},
    # The same with a field that follows the camera: three levels from a 2.5 cm cell, so the far half of the room is in the coarse ones.
    'dgil': {'BACKEND': 'webgpu', 'HEADLESS_GPU': '1', 'EFFECTS': json.dumps([{'type': 'dynamicGI', 'enabled': True, 'uniforms': {'u_cellSize': 2.5}}])},
    # The same, with every box a mesh and the `.esmeshsdf` / `.esmeshcards` an import with `dynamicGI` on writes beside it (make_mesh_boxes.mjs).
    'dgim': {'BACKEND': 'webgpu', 'HEADLESS_GPU': '1', 'MESH_BOXES': '1', 'EFFECTS': json.dumps([{'type': 'dynamicGI', 'enabled': True, 'uniforms': {}}])},
}

# The share of Cycles' light, per region, each method is allowed (measured 2026-11-11). A region the sun lights directly reads about 1 for all.
# (lo, hi) is the band; ('zero', limit) is "Cycles has no light here, so neither may the method: the linear value stays under limit".
BANDS = {
    ('gi_room', 'baked'): (0.65, 1.10),
    ('gi_away', 'baked'): (0.65, 1.10),
    ('gi_leak', 'baked'): ('zero', 0.004),
    ('gi_room', 'vgi'): (0.10, 1.70),
    ('gi_away', 'vgi'): (0.25, 0.75),
    ('gi_emissive', 'vgi'): (0.05, 0.70),
    ('gi_room', 'dgi'): (0.45, 1.25),
    ('gi_away', 'dgi'): (0.45, 1.00),
    ('gi_leak', 'dgi'): ('zero', 0.0005),
    ('gi_emissive', 'dgi'): (0.75, 1.35),
    ('gi_room', 'dgim'): (0.45, 1.45),
    ('gi_away', 'dgim'): (0.45, 1.30),
    ('gi_leak', 'dgim'): ('zero', 0.0005),
    ('gi_point', 'dgi'): (0.8, 1.25),
    ('gi_point', 'dgim'): (0.7, 1.4),
    ('gi_room', 'dgil'): (0.45, 1.45),
    ('gi_away', 'dgil'): (0.45, 1.30),
    ('gi_leak', 'dgil'): ('zero', 0.0005),
    ('gi_point', 'dgil'): (0.7, 1.4),
    ('gi_spot', 'dgi'): (0.75, 1.3),
    ('gi_spot', 'dgim'): (0.7, 1.6),
    ('gi_spot', 'dgil'): (0.7, 1.4),
    ('gi_emissive', 'dgim'): (0.75, 1.50),
}
# Wrong today, on purpose written down: the lightmap baker has no notion of an emissive surface (tools/lightmap-wasm/kernel.cpp carries albedo
# and the sun, nothing that emits), so a room lit only by a glowing panel bakes black. The region shares are asserted to stay under this.
# The dynamic GI (distance field + surface cache + probes; WebGPU, headless on swiftshader) is the one with no leak and no screen-only memory.
# Likewise the voxel method lets the sun through a sealed room's walls: its voxels are larger than a 10 cm wall, so one that holds the lit outside
# of a wall holds its dark inside too (with the sun taken out the room is exactly black). 0.005 linear, about 16 codes, in a room Cycles leaves black.
KNOWN_GAP = {
    ('gi_emissive', 'baked'): ('the lightmap baker does not light from emissive surfaces', 0.05),
    ('gi_leak', 'vgi'): ('the voxel method lets the sun through thin walls', 0.008),
}


# A lab with no Cycles picture (a lamp) is for the methods that light from the scene's own lights.
ONLY = {'gi_point': ['dgi', 'dgim', 'dgil'], 'gi_spot': ['dgi', 'dgim', 'dgil']}


def lin(img):
    c = img / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def regions(lab):
    spec = S.GI[lab]
    out = []
    for name, point in S.REGIONS[lab]:
        if point is None:
            point = S.sun_patch_centre(lab)
        px, py, z = S.project(point, spec['cam'])
        if z > 0 and RADIUS <= px < S.SIZE[0] - RADIUS and RADIUS <= py < S.SIZE[1] - RADIUS:
            out.append((name, int(px), int(py)))
    return out


def read(path, lab):
    img = lin(np.array(Image.open(path).convert('RGB')).astype(float))
    return {name: img[py - RADIUS:py + RADIUS, px - RADIUS:px + RADIUS].reshape(-1, 3).mean(0).tolist() for name, px, py in regions(lab)}


def run_engine(lab, method):
    env = dict(os.environ, OUT=OUT.replace('\\', '/'), **METHODS[method])
    name = '%s_%s' % (method, lab)
    result = subprocess.run(['bash', os.path.join(HERE, 'gi-run.sh'), lab, name], env=env, cwd=ROOT, capture_output=True, text=True, encoding='utf8', errors='replace')
    path = os.path.join(OUT, 'engine_%s.png' % name)
    if not os.path.exists(path):
        raise SystemExit('%s: no picture\n%s' % (name, (result.stdout + result.stderr)[-600:]))
    return path


def main():
    args = sys.argv[1:]
    flag = lambda n, d: args[args.index(n) + 1] if n in args else d
    labs = flag('--labs', ','.join(S.GI)).split(',')
    if '--reference' in args:
        labs = [l for l in labs if os.path.exists(os.path.join(OUT, 'ref_%s.png' % l))]
    if '--reference' in args:
        data = {}
        for lab in labs:
            data[lab] = read(os.path.join(OUT, 'ref_%s.png' % lab), lab)
        json.dump({'source': 'Blender Cycles, 12 bounces, the lab boxes and sun, no sky (tools/render-lab/gi_ref.py); linear RGB mean over a 20 px square at each region', 'regions': data},
                  open(REFERENCE, 'w'), indent=1)
        print('wrote', REFERENCE)
        return 0
    reference = json.load(open(REFERENCE))['regions']
    methods = flag('--methods', ','.join(METHODS)).split(',')
    failures = []
    for lab in labs:
        for method in methods:
            if method not in ONLY.get(lab, methods):
                continue
            got = read(run_engine(lab, method), lab)
            ref = reference[lab]
            band = BANDS.get((lab, method))
            gap = KNOWN_GAP.get((lab, method))
            print('== %s / %s' % (lab, method))
            for name in got:
                r, e = np.array(ref[name]), np.array(got[name])
                direct = name.startswith('sun patch') or 'emitter' in name
                if r.max() < 1e-3:
                    limit = gap[1] if gap else (band[1] if band and band[0] == 'zero' else 0.004)
                    clean = e.max() < limit
                    verdict = 'zero' if clean else 'LIGHT WHERE CYCLES HAS NONE'
                    if gap and clean:
                        verdict = 'under %.3f   KNOWN GAP: %s%s' % (limit, gap[0], '' if e.max() > 0.002 else ' - NOT A GAP ANY MORE, drop the entry')
                    print('  %-22s cycles 0      engine %s  %s' % (name, ' '.join('%.4f' % v for v in e), verdict))
                    if not clean:
                        failures.append('%s/%s %s: %.4f where Cycles has none' % (lab, method, name, e.max()))
                    continue
                share = e / np.maximum(r, 1e-4)
                weighted = float((e * r).sum() / (r * r).sum())  # one number for the region: the share of its light, weighted by the light
                line = '  %-22s cycles %s   share %s' % (name, ' '.join('%.3f' % v for v in r), ' '.join('%.2f' % v for v in share))
                if direct:
                    ok = 0.85 <= weighted <= 1.2
                elif gap:
                    ok = weighted <= gap[1]
                    line += '   KNOWN GAP: ' + gap[0]
                    if weighted > gap[1]:
                        line += ' - NOT A GAP ANY MORE, drop the entry'
                elif band and band[0] != 'zero':
                    ok = band[0] <= weighted <= band[1]
                else:
                    ok = True
                print(line + ('' if ok else '   OUT OF BAND'))
                if not ok:
                    failures.append('%s/%s %s: share %.2f' % (lab, method, name, weighted))
    print()
    if failures:
        print('GI check FAILED:')
        for f in failures:
            print('  ', f)
        return 1
    print('GI check passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
