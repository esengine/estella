from pathlib import Path
import json
import math
import uuid

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / 'assets/textures'
MAT = ROOT / 'assets/materials'
SCENE = ROOT / 'assets/scenes/main.esscene'
rng = np.random.default_rng(4117)


def write_meta(path, srgb=True, wrap='clamp'):
    meta = {
        'uuid': str(uuid.uuid5(uuid.NAMESPACE_URL, 'estella/examples/vfx-showcase/' + path.name)),
        'version': '2.0',
        'type': 'texture',
        'importer': {
            'sRGB': srgb, 'maxSize': 2048, 'filterMode': 'linear', 'wrapMode': wrap, 'premultiplyAlpha': False,
            'sliceBorder': {'left': 0, 'right': 0, 'top': 0, 'bottom': 0},
        },
    }
    Path(str(path) + '.meta').write_text(json.dumps(meta, indent=2) + '\n')


def write_asset_meta(path, kind, importer=None):
    meta = {
        'uuid': str(uuid.uuid5(uuid.NAMESPACE_URL, 'estella/examples/vfx-showcase/' + path.name)),
        'version': '2.0', 'type': kind, 'importer': importer or {},
    }
    Path(str(path) + '.meta').write_text(json.dumps(meta, indent=2) + '\n')


def save(name, rgba, srgb=True, wrap='clamp'):
    path = TEX / name
    Image.fromarray(np.clip(rgba * 255.0 + 0.5, 0, 255).astype(np.uint8)).save(path, optimize=True)
    write_meta(path, srgb, wrap)


def grid(size):
    axis = (np.arange(size) + 0.5) / size
    return np.meshgrid(axis, axis)


def value_noise(size, cells, tile=True):
    lattice = rng.random((cells, cells))
    x, y = grid(size)
    fx, fy = x * cells, y * cells
    ix, iy = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - ix, fy - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    wrap = (lambda v: v % cells) if tile else (lambda v: np.minimum(v, cells - 1))
    a = lattice[wrap(iy), wrap(ix)]
    b = lattice[wrap(iy), wrap(ix + 1)]
    c = lattice[wrap(iy + 1), wrap(ix)]
    d = lattice[wrap(iy + 1), wrap(ix + 1)]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(size, cells, octaves=5):
    total, amplitude, norm = np.zeros((size, size)), 1.0, 0.0
    for _ in range(octaves):
        total += value_noise(size, cells) * amplitude
        norm += amplitude
        amplitude *= 0.5
        cells *= 2
    return total / norm


def white(alpha):
    return np.dstack([np.ones_like(alpha)] * 3 + [alpha])


def textures():
    TEX.mkdir(parents=True, exist_ok=True)
    x, y = grid(128)
    r = np.hypot(x - 0.5, y - 0.5) * 2
    save('soft.png', white(np.clip(1 - r, 0, 1) ** 2.2))

    x, y = grid(256)
    r = np.hypot(x - 0.5, y - 0.5) * 2
    billow = fbm(256, 4, 5)
    wisps = fbm(256, 7, 4)
    body = np.clip(1.15 - r - (1 - billow) * 0.75, 0, 1)
    alpha = np.clip(body * 3.2, 0, 1) * (0.7 + 0.3 * wisps) * np.clip((1.02 - r) / 0.25, 0, 1)
    shade = 0.62 + 0.38 * fbm(256, 5, 4)
    save('smoke.png', np.dstack([shade, shade, shade, alpha]))

    axis_x = (np.arange(32) + 0.5) / 32
    axis_y = (np.arange(128) + 0.5) / 128
    x, y = np.meshgrid(axis_x, axis_y)
    across = np.exp(-((x - 0.5) / 0.13) ** 2)
    along = np.clip(y * 1.05, 0, 1) ** 0.6 * np.clip((1 - y) / 0.12, 0, 1)
    head = np.exp(-(((y - 0.12) / 0.1) ** 2 + ((x - 0.5) / 0.22) ** 2))
    save('spark.png', white(np.clip(across * (1 - along * 0.85) * np.clip(1 - y, 0, 1) ** 0.5 * np.clip(y / 0.06, 0, 1) + head, 0, 1)))

    x, y = grid(512)
    r = np.hypot(x - 0.5, y - 0.5) * 2
    front = 0.86
    trail = np.where(r < front, np.exp(-(front - r) / 0.035), np.exp(-((r - front) / 0.012) ** 2))
    ragged = 0.8 + 0.2 * fbm(512, 12, 3)
    save('ring.png', white(np.clip(trail * ragged, 0, 1) * np.clip((1 - r) / 0.06, 0, 1)))

    x, y = grid(256)
    dx, dy = x - 0.5, y - 0.5
    r = np.hypot(dx, dy) * 2
    core = np.exp(-(r / 0.16) ** 2) + 0.35 * np.exp(-(r / 0.45) ** 2)
    streak = np.zeros_like(r)
    for k in range(3):
        angle = k * math.pi / 3 + 0.26
        across = np.abs(dx * math.sin(angle) - dy * math.cos(angle)) * 2
        streak += np.exp(-(across / 0.012) ** 2) * np.exp(-(r / 0.55) ** 2)
    save('flare.png', white(np.clip(core + streak * 0.8, 0, 1) * np.clip((1 - r) / 0.1, 0, 1)))

    size, cells = 512, 6
    x, y = grid(size)
    points = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1) + 0.15 + rng.random((cells, cells, 2)) * 0.7) / cells
    tone = rng.random((cells, cells))
    first = np.full((size, size), 9.0)
    second = np.full((size, size), 9.0)
    owner = np.zeros((size, size))
    for j in range(cells):
        for i in range(cells):
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    d = np.hypot(x - points[j, i, 0] - ox, y - points[j, i, 1] - oy)
                    closer = d < first
                    second = np.where(closer, first, np.minimum(second, d))
                    owner = np.where(closer, tone[j, i], owner)
                    first = np.where(closer, d, first)
    seam = np.clip((second - first) / 0.022, 0, 1)
    grain = fbm(size, 16, 5)
    pits = fbm(size, 48, 3)
    height = seam ** 0.5 * (0.72 + 0.2 * owner) + grain * 0.22 - np.clip(pits - 0.62, 0, 1) * 0.6
    albedo = (0.105 + 0.05 * owner + 0.07 * grain) * (0.62 + 0.38 * seam)
    save('stone-albedo.png', np.dstack([albedo * 0.95, albedo * 1.0, albedo * 1.1, np.ones_like(albedo)]), wrap='repeat')
    gx = np.roll(height, -1, 1) - np.roll(height, 1, 1)
    gy = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    normal = np.dstack([-gx * 8, gy * 8, np.ones_like(gx)])
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    save('stone-normal.png', np.dstack([normal * 0.5 + 0.5, np.ones_like(gx)]), srgb=False, wrap='repeat')


def material(name, shader, blend, properties, depth_test=True, depth_write=False, cull=0):
    data = {
        'version': '1.0', 'type': 'material', 'shader': shader, 'blendMode': blend,
        'depthTest': depth_test, 'depthWrite': depth_write, 'cull': cull, 'properties': properties,
    }
    (MAT / f'{name}.esmaterial').write_text(json.dumps(data, indent=2) + '\n')
    write_asset_meta(MAT / f'{name}.esmaterial', 'material')
    return f'assets/materials/{name}.esmaterial'


NORMAL, ADDITIVE, PREMULTIPLIED, OPAQUE = 0, 1, 4, 9


def color(r, g, b, a=1.0):
    return {'r': r, 'g': g, 'b': b, 'a': a}


def vec(x, y, z):
    return {'x': x, 'y': y, 'z': z}


def materials():
    MAT.mkdir(parents=True, exist_ok=True)
    return {
        'ground': material('ground', 'builtin:model', OPAQUE, {
            'u_uvTiling': {'x': 44, 'y': 44}, 'u_normalMap': '../textures/stone-normal.png', 'u_metallic': 0.0, 'u_roughness': 0.62,
        }, depth_write=True),
        'pillar': material('pillar', 'builtin:model', OPAQUE, {
            'u_uvTiling': {'x': 4, 'y': 9}, 'u_normalMap': '../textures/stone-normal.png', 'u_metallic': 0.0, 'u_roughness': 0.7,
        }, depth_write=True),
        'core': material('core', 'energy-core.esshader', ADDITIVE, {
            'u_inner': color(0.2, 0.7, 1.0), 'u_rim': color(0.45, 0.16, 1.0), 'u_intensity': 0.0, 'u_flow': 1.0, 'u_instability': 0.0,
        }),
        'rune': material('rune', 'rune.esshader', ADDITIVE, {
            'u_color': color(0.3, 0.75, 1.0), 'u_intensity': 0.0, 'u_spin': 0.0, 'u_reveal': 0.0,
        }),
        'ring': material('ring', 'glow.esshader', ADDITIVE, {'u_color': color(1.0, 0.46, 0.14), 'u_intensity': 0.0}),
        'scorch': material('scorch', 'scorch.esshader', PREMULTIPLIED, {'u_heat': 0.0, 'u_soot': 0.0}),
        'shock': material('shock', 'builtin:distortion', NORMAL, {
            'u_strength': 0.05, 'u_radial': 1.0, 'u_noiseScale': 6.0, 'u_scroll': {'x': 0, 'y': 0}, 'u_dispersion': 0.08,
        }),
        'airshock': material('airshock', 'builtin:distortion', NORMAL, {
            'u_strength': 0.03, 'u_radial': 1.0, 'u_noiseScale': 6.0, 'u_scroll': {'x': 0, 'y': 0}, 'u_dispersion': 0.12,
        }),
        'haze': material('haze', 'builtin:distortion', NORMAL, {
            'u_strength': 0.012, 'u_radial': 0.0, 'u_noiseScale': 3.0, 'u_scroll': {'x': 0.1, 'y': 0.9}, 'u_dispersion': 0.0,
        }),
        'smoke': material('smoke', 'builtin:particle', NORMAL, {'u_softness': 1.4, 'u_erosion': 0.6, 'u_erosionEdge': 0.5}),
        'dust': material('dust', 'builtin:particle', NORMAL, {'u_softness': 0.9, 'u_erosion': 0.7, 'u_erosionEdge': 0.5}),
        'glow': material('glow', 'builtin:particle', ADDITIVE, {'u_softness': 1.6, 'u_erosion': 0.0, 'u_erosionEdge': 0.2}),
        'fire': material('fire', 'builtin:particle', ADDITIVE, {'u_softness': 0.8, 'u_erosion': 1.0, 'u_erosionEdge': 0.35}),
    }


def quat_x(degrees):
    half = math.radians(degrees) / 2
    return {'x': math.sin(half), 'y': 0.0, 'z': 0.0, 'w': math.cos(half)}


def look_at(eye, target):
    forward = np.array(target, float) - np.array(eye, float)
    forward /= np.linalg.norm(forward)
    yaw = math.atan2(-forward[0], -forward[2])
    pitch = math.asin(forward[1])
    cy, sy, cp, sp = math.cos(yaw / 2), math.sin(yaw / 2), math.cos(pitch / 2), math.sin(pitch / 2)
    return {'x': cy * sp, 'y': sy * cp, 'z': -sy * sp, 'w': cy * cp}


def entity(name, position, components, rotation=None, scale=None):
    transform = {'position': vec(*position)}
    if rotation:
        transform['rotation'] = rotation
    if scale:
        transform['scale'] = vec(*scale)
    return {'name': name, 'parent': None, 'children': [], 'visible': True,
            'components': [{'type': 'Transform', 'data': transform}] + components}


def mesh(shape, material_path, texture=None, tint=None, lit=True, opaque=True):
    data = {'mesh': f'builtin:{shape}', 'lit': lit, 'material': material_path, 'color': tint or color(1, 1, 1),
            'opaque': opaque, 'cullBackfaces': opaque, 'enabled': True}
    if texture:
        data['texture'] = f'assets/textures/{texture}'
    return {'type': 'MeshRenderer', 'data': data}


def gradient(*stops):
    return {'stops': [{'t': t, 'color': color(*c)} for t, c in stops]}


def curve(*keys):
    out = []
    for i, (time, value) in enumerate(keys):
        before = keys[i - 1] if i > 0 else keys[i]
        after = keys[i + 1] if i + 1 < len(keys) else keys[i]
        slope = (after[1] - before[1]) / max(after[0] - before[0], 1e-6)
        out.append({'time': time, 'value': value, 'inTangent': slope, 'outTangent': slope})
    return {'keys': out}


def emitter(texture, **fields):
    data = {
        'enabled': True, 'looping': True, 'playOnStart': True, 'simulationSpace': 0, 'rate': 0, 'burstCount': 0,
        'duration': 1000, 'shape': 0, 'speedMin': 0, 'speedMax': 0, 'gravity': vec(0, 0, 0), 'damping': 0,
        'rotationMin': 0, 'rotationMax': 0, 'angularVelocityMin': 0, 'angularVelocityMax': 0,
        'startColor': color(1, 1, 1), 'endColor': color(1, 1, 1, 0), 'blendMode': ADDITIVE,
        'texture': f'assets/textures/{texture}',
    }
    data.update(fields)
    return {'type': 'ParticleEmitter', 'data': data}


POINT, CIRCLE, BOX, CONE, SPHERE, HEMISPHERE = 0, 1, 2, 3, 4, 5
CORE = (0.0, 2.6, 0.0)


def scene(mats):
    eye, target = (0.0, 3.6, 12.2), (0.0, 2.9, 0.0)
    entities = [
        entity('Camera', eye, [
            {'type': 'Camera', 'data': {'projectionType': 0, 'fov': 52, 'nearPlane': 0.1, 'farPlane': 400, 'isActive': True, 'priority': 0, 'clearFlags': 3}},
            {'type': 'PostProcessVolume', 'data': {'isGlobal': True, 'weight': 1, 'priority': 0, 'effects': [
                {'type': 'heightFog', 'enabled': True, 'uniforms': {'u_density': 0.012, 'u_heightFalloff': 0.06, 'u_baseHeight': 0, 'u_startDistance': 24,
                                                                    'u_maxOpacity': 0.4, 'u_inscatter': 0, 'u_skyFog': 0.4, 'u_volumetric': 0},
                 'colors': {'u_fogColor': color(0.1, 0.15, 0.24)}},
                {'type': 'bloom', 'enabled': True, 'uniforms': {'u_threshold': 1.0, 'u_intensity': 0.55, 'u_radius': 1.4}},
                {'type': 'chromaticAberration', 'enabled': True, 'uniforms': {'u_intensity': 0.8}},
                {'type': 'colorGrade', 'enabled': True, 'uniforms': {'u_exposure': 0.0, 'u_contrast': 1.08, 'u_saturation': 1.05}},
                {'type': 'vignette', 'enabled': True, 'uniforms': {'u_intensity': 0.32, 'u_softness': 0.75}},
                {'type': 'fxaa', 'enabled': True, 'uniforms': {}},
            ]}},
        ], rotation=look_at(eye, target)),
        entity('Sky', (0, 0, 0), [{'type': 'Light', 'data': {'type': 2, 'color': color(0.8, 0.88, 1.0), 'intensity': 0.9, 'enabled': True,
                                                           'environment': 'assets/env/rain-sky.esenv', 'drawEnvironment': True}}]),
        entity('Moon', (0, 0, 0), [{'type': 'Light', 'data': {'type': 1, 'color': color(0.5, 0.66, 1.0), 'intensity': 0.55, 'enabled': True,
                                                            'meshShadows': True, 'shadowExtent': 40, 'shadowStrength': 0.85}}],
               rotation={'x': -0.3129, 'y': -0.4361, 'z': -0.0473, 'w': 0.8326}),
        entity('CoreLight', CORE, [{'type': 'Light', 'data': {'type': 0, 'color': color(0.35, 0.75, 1.0), 'intensity': 0.0, 'radius': 26, 'innerRadius': 0.6,
                                                             'falloff': 1.4, 'enabled': True, 'meshShadows': True, 'shadowStrength': 0.9, 'shadowSoftness': 0.3}}]),
        entity('BlastLight', (0.0, 1.6, 0.0), [{'type': 'Light', 'data': {'type': 0, 'color': color(1.0, 0.55, 0.2), 'intensity': 0.0, 'radius': 34,
                                                                         'innerRadius': 0.8, 'falloff': 1.2, 'enabled': True}}]),
        entity('Ground', (0, 0, 0), [mesh('plane', mats['ground'], 'stone-albedo.png')], scale=(4, 1, 4)),
    ]
    for k in range(1, 7):
        angle = k * math.pi / 4 + math.pi / 8
        height = (7.5, 5.2, 8.4, 3.1, 7.9, 6.4, 2.4, 8.8)[k]
        px, pz = math.sin(angle) * 12.5, math.cos(angle) * 12.5
        entities.append(entity(f'Pillar {k}', (px, height / 2, pz), [mesh('cylinder', mats['pillar'], 'stone-albedo.png')],
                               scale=(0.013, height / 100, 0.013)))
        entities.append(entity(f'Plinth {k}', (px, 0.2, pz), [mesh('cube', mats['pillar'], 'stone-albedo.png')], scale=(0.02, 0.004, 0.02)))
    skyline = np.random.default_rng(77)
    for k in range(26):
        angle = k * math.tau / 26 + skyline.uniform(-0.08, 0.08)
        reach = skyline.uniform(55, 95)
        width, tall = skyline.uniform(5, 16), skyline.uniform(6, 34)
        entities.append(entity(f'Ruin {k}', (math.sin(angle) * reach, tall / 2 - 1, math.cos(angle) * reach),
                               [mesh('cube', mats['pillar'], 'stone-albedo.png')],
                               rotation={'x': 0.0, 'y': math.sin(angle / 2), 'z': 0.0, 'w': math.cos(angle / 2)},
                               scale=(width / 100, tall / 100, skyline.uniform(4, 10) / 100)))
    flat = quat_x(-90)
    entities += [
        entity('Rune', (0, 0.03, 0), [mesh('plane', mats['rune'], lit=False, opaque=False)], scale=(0.15, 1, 0.15)),
        entity('Scorch', (0, 0.02, 0), [mesh('plane', mats['scorch'], lit=False, opaque=False)], scale=(0.12, 1, 0.12)),
        entity('ShockGlow', (0, 0.07, 0), [mesh('plane', mats['ring'], 'ring.png', lit=False, opaque=False)], scale=(0.001, 1, 0.001)),
        entity('ShockBend', (0, 0.1, 0), [mesh('plane', mats['shock'], 'ring.png', lit=False, opaque=False)], scale=(0.001, 1, 0.001)),
        entity('Core', CORE, [mesh('sphere', mats['core'], lit=False, opaque=False)], scale=(0.001, 0.001, 0.001)),
        entity('Pull', CORE, [{'type': 'ParticleForceField', 'data': {'type': 1, 'strength': 13.0, 'radius': 12, 'falloff': False, 'enabled': True}}]),
        entity('Swirl', CORE, [{'type': 'ParticleForceField', 'data': {'type': 2, 'strength': 3.0, 'radius': 12, 'direction': vec(0, 1, 0),
                                                                      'falloff': False, 'enabled': True}}]),
        entity('Gather', CORE, [emitter(
            'spark.png', shape=SPHERE, shapeRadius=7.5, speedMin=-1.2, speedMax=-0.4, lifetimeMin=1.1, lifetimeMax=1.7, maxParticles=900,
            startSizeMin=0.07, startSizeMax=0.12, endSizeMin=0.02, endSizeMax=0.04, renderMode=1, velocityScale=0.06, lengthScale=2.5, intensity=4.0,
            colorGradient=gradient((0, (0.25, 0.6, 1.0, 0.0)), (0.2, (0.3, 0.7, 1.0, 1.0)), (0.75, (0.6, 0.45, 1.0, 1.0)), (1, (1.0, 0.95, 1.0, 0.0))))]),
        entity('Motes', CORE, [emitter(
            'soft.png', shape=SPHERE, shapeRadius=1.6, speedMin=0.2, speedMax=0.8, lifetimeMin=0.5, lifetimeMax=1.1, maxParticles=160,
            startSizeMin=0.15, startSizeMax=0.35, endSizeMin=0.04, endSizeMax=0.08, noiseStrength=2.0, noiseFrequency=0.8, intensity=0.5,
            material=mats['glow'], colorGradient=gradient((0, (0.3, 0.7, 1.0, 0.0)), (0.3, (0.45, 0.6, 1.0, 0.8)), (1, (0.7, 0.4, 1.0, 0.0))))]),
        entity('Mist', (0, 0.35, 0), [emitter(
            'smoke.png', shape=CIRCLE, shapeRadius=8.5, speedMin=-1.6, speedMax=-0.7, lifetimeMin=2.2, lifetimeMax=3.4, maxParticles=140,
            startSizeMin=2.4, startSizeMax=3.6, endSizeMin=1.2, endSizeMax=1.8, rotationMin=0, rotationMax=6.28, angularVelocityMin=-0.4,
            angularVelocityMax=0.4, intensity=1.0, material=mats['dust'],
            colorGradient=gradient((0, (0.2, 0.34, 0.6, 0.0)), (0.35, (0.2, 0.36, 0.62, 0.16)), (1, (0.3, 0.3, 0.7, 0.0))))], rotation=flat),
        entity('Flash', CORE, [emitter(
            'soft.png', lifetimeMin=0.22, lifetimeMax=0.22, maxParticles=8, startSizeMin=5, startSizeMax=5, endSizeMin=15, endSizeMax=15,
            intensity=4.5, material=mats['glow'], colorGradient=gradient((0, (0.85, 0.95, 1.0, 1.0)), (0.3, (1.0, 0.8, 0.5, 0.7)), (1, (1.0, 0.4, 0.1, 0.0))))]),
        entity('Flare', CORE, [emitter(
            'flare.png', lifetimeMin=0.5, lifetimeMax=0.5, maxParticles=4, startSizeMin=16, startSizeMax=16, endSizeMin=7, endSizeMax=7,
            intensity=9.0, colorGradient=gradient((0, (1.0, 0.95, 0.9, 1.0)), (0.4, (1.0, 0.7, 0.4, 0.6)), (1, (1.0, 0.4, 0.1, 0.0))))]),
        entity('AirShock', CORE, [emitter(
            'ring.png', lifetimeMin=0.75, lifetimeMax=0.75, maxParticles=4, startSizeMin=1.5, startSizeMax=1.5, endSizeMin=1.5, endSizeMax=1.5,
            blendMode=NORMAL, material=mats['airshock'], sizeCurve=curve((0, 1), (0.25, 9), (1, 17)),
            colorGradient=gradient((0, (1, 1, 1, 1.0)), (0.5, (1, 1, 1, 0.7)), (1, (1, 1, 1, 0.0))))]),
        entity('Sparks', (0, 1.4, 0), [emitter(
            'spark.png', shape=HEMISPHERE, shapeRadius=0.6, speedMin=7, speedMax=24, gravity=vec(0, -13, 0), damping=0.5, lifetimeMin=0.9,
            lifetimeMax=2.2, maxParticles=700, startSizeMin=0.07, startSizeMax=0.13, endSizeMin=0.02, endSizeMax=0.04, renderMode=1,
            velocityScale=0.035, lengthScale=2.0, intensity=6.0, collisionEnabled=True, collisionMode=0, collisionFloor=0.03,
            collisionBounce=0.38, collisionFriction=0.25, collisionLifetimeLoss=0.1,
            colorGradient=gradient((0, (1.0, 0.85, 0.55, 1.0)), (0.25, (1.0, 0.55, 0.15, 1.0)), (0.7, (1.0, 0.22, 0.04, 0.9)), (1, (0.5, 0.05, 0.0, 0.0))))]),
        entity('Embers', (0, 2.0, 0), [emitter(
            'soft.png', shape=SPHERE, shapeRadius=1.2, speedMin=1.5, speedMax=8, gravity=vec(0, 0.5, 0), damping=1.1, lifetimeMin=2.6,
            lifetimeMax=5.0, maxParticles=500, startSizeMin=0.07, startSizeMax=0.14, endSizeMin=0.015, endSizeMax=0.03, noiseStrength=3.2,
            noiseFrequency=0.35, noiseScrollSpeed=0.4, intensity=6.0,
            colorGradient=gradient((0, (1.0, 0.8, 0.4, 1.0)), (0.3, (1.0, 0.45, 0.1, 1.0)), (0.8, (0.9, 0.15, 0.03, 0.7)), (1, (0.3, 0.02, 0.0, 0.0))))]),
        entity('Fireball', (0, 2.0, 0), [emitter(
            'smoke.png', shape=SPHERE, shapeRadius=0.5, speedMin=1.0, speedMax=6.0, gravity=vec(0, 1.5, 0), damping=3.0, lifetimeMin=0.4,
            lifetimeMax=0.75, maxParticles=90, startSizeMin=1.6, startSizeMax=2.6, endSizeMin=3.4, endSizeMax=4.8, rotationMin=0, rotationMax=6.28,
            angularVelocityMin=-1.2, angularVelocityMax=1.2, intensity=3.6, material=mats['fire'],
            colorGradient=gradient((0, (1.0, 0.9, 0.7, 1.0)), (0.25, (1.0, 0.55, 0.14, 0.95)), (0.65, (0.9, 0.2, 0.04, 0.7)), (1, (0.3, 0.03, 0.0, 0.0))))]),
        entity('Smoke', (0, 1.8, 0), [emitter(
            'smoke.png', shape=SPHERE, shapeRadius=0.9, speedMin=1.5, speedMax=6.5, gravity=vec(0, 1.1, 0), damping=1.7, lifetimeMin=2.8,
            lifetimeMax=4.6, maxParticles=160, startSizeMin=2.6, startSizeMax=4.2, endSizeMin=6.0, endSizeMax=8.5, rotationMin=0, rotationMax=6.28,
            angularVelocityMin=-0.5, angularVelocityMax=0.5, blendMode=NORMAL, intensity=3.4, material=mats['smoke'],
            colorGradient=gradient((0, (1.0, 0.7, 0.3, 0.95)), (0.04, (1.0, 0.36, 0.08, 0.95)), (0.09, (0.4, 0.08, 0.02, 0.9)), (0.17, (0.013, 0.011, 0.012, 0.88)),
                                   (0.7, (0.014, 0.014, 0.017, 0.5)), (1, (0.02, 0.02, 0.025, 0.0))))]),
        entity('DustRing', (0, 0.5, 0), [emitter(
            'smoke.png', shape=CIRCLE, shapeRadius=1.2, speedMin=8, speedMax=15, damping=2.4, lifetimeMin=1.6, lifetimeMax=2.8, maxParticles=160,
            startSizeMin=1.4, startSizeMax=2.2, endSizeMin=3.8, endSizeMax=5.4, rotationMin=0, rotationMax=6.28, angularVelocityMin=-0.6,
            angularVelocityMax=0.6, blendMode=NORMAL, intensity=1.0, material=mats['dust'],
            colorGradient=gradient((0, (0.3, 0.2, 0.14, 0.0)), (0.12, (0.12, 0.095, 0.085, 0.42)), (1, (0.06, 0.065, 0.08, 0.0))))], rotation=flat),
        entity('Haze', (0, 0.6, 0), [emitter(
            'soft.png', shape=BOX, shapeSize=vec(5, 0.4, 5), speedMin=0.8, speedMax=1.6, angleSpreadMin=85, angleSpreadMax=95, lifetimeMin=1.6,
            lifetimeMax=2.4, maxParticles=80, startSizeMin=2.2, startSizeMax=3.4, endSizeMin=3.6, endSizeMax=4.6, blendMode=NORMAL,
            material=mats['haze'], colorGradient=gradient((0, (1, 1, 1, 0.0)), (0.3, (1, 1, 1, 0.9)), (1, (1, 1, 1, 0.0))))]),
    ]
    for index, item in enumerate(entities):
        item['id'] = index
    SCENE.parent.mkdir(parents=True, exist_ok=True)
    SCENE.write_text(json.dumps({'version': 4, 'name': 'VfxShowcase', 'entities': entities}, indent=1) + '\n')
    write_asset_meta(SCENE, 'scene', {'autoMigrate': True})
    for shader in sorted(MAT.glob('*.esshader')):
        write_asset_meta(shader, 'shader')


if __name__ == '__main__':
    textures()
    scene(materials())
