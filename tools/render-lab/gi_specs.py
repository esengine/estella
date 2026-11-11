"""Global-illumination scenes of the render lab: rooms whose light, past the patch the sun lands on, is all bounce.

Every scene is boxes, written once here and built from this list on both sides: Blender (Cycles, 12 bounces) draws the reference, the engine
draws the same boxes as built-in cubes. With no sky, a pixel the sun does not reach directly is exactly what a GI method gives it, so the
ratio engine / Cycles over a region is that method's answer for that region.

Units: the engine's world is centimetres (the built-in cube is 100 across), Blender's is metres. Coordinates here are the engine's
(+Y up), Blender's are (x, -z, y) / 100 of them.

Colours are linear albedo on both sides: a MeshRenderer's `color` reaches the mesh shader and the bake as written (only light and clear
colours are linearized in a linear project), so Blender is handed the same numbers.
"""
import math

SIZE = (1280, 720)

W, H, D, T = 400.0, 300.0, 500.0, 10.0      # room inner width, height, depth, wall thickness
WHITE, RED, GREEN = (0.85, 0.85, 0.85), (0.80, 0.18, 0.15), (0.18, 0.70, 0.22)
SKY = (120.0, 120.0)                        # skylight opening, x by z, in the ceiling


def room(skylight_z=None, emissive=None):
    """The six walls (inner faces at x = +-W/2, y = 0 and H, z = +-D/2), the ceiling with a hole at `skylight_z` when given."""
    hw, hd = W / 2, D / 2
    b = [
        ('floor', (0, -T / 2, 0), (W + 2 * T, T, D + 2 * T), WHITE),
        ('left', (hw + T / 2, H / 2, 0), (T, H, D), RED),       # +X: seen on the camera's left when it looks along +Z
        ('right', (-hw - T / 2, H / 2, 0), (T, H, D), GREEN),
        ('back', (0, H / 2, hd + T / 2), (W + 2 * T, H, T), WHITE),
        ('front', (0, H / 2, -hd - T / 2), (W + 2 * T, H, T), WHITE),
    ]
    if skylight_z is None:
        b.append(('ceiling', (0, H + T / 2, 0), (W + 2 * T, T, D + 2 * T), WHITE))
    else:
        sx, sz = SKY
        z0, z1 = skylight_z - sz / 2, skylight_z + sz / 2
        zlo, zhi = -hd - T, hd + T
        b += [
            ('ceil_n', (0, H + T / 2, (zlo + z0) / 2), (W + 2 * T, T, z0 - zlo), WHITE),
            ('ceil_s', (0, H + T / 2, (z1 + zhi) / 2), (W + 2 * T, T, zhi - z1), WHITE),
            ('ceil_l', ((hw + T + sx / 2) / 2, H + T / 2, skylight_z), (hw + T - sx / 2, T, sz), WHITE),
            ('ceil_r', (-(hw + T + sx / 2) / 2, H + T / 2, skylight_z), (hw + T - sx / 2, T, sz), WHITE),
        ]
    # A block in the room, so there is a contact shadow and a face that sees only bounce.
    b.append(('block', (-90, 50, 80), (100, 100, 100), WHITE))
    if emissive:
        b.append(('panel', emissive['centre'], emissive['size'], (1, 1, 1)))
    return b


def sun_dir(elev_deg, azim_deg):
    """Direction the light travels: down at `elev_deg` below the horizon, heading `azim_deg` from +Z toward +X."""
    e, a = math.radians(elev_deg), math.radians(azim_deg)
    return (math.cos(e) * math.sin(a), -math.sin(e), math.cos(e) * math.cos(a))


CAM_IN = ((0.0, 160.0, -235.0), (0.0, 110.0, 250.0), 62.0)
# Facing the front wall from the back: the sun's patch is on the floor behind and under the camera, off the picture.
CAM_AWAY = ((0.0, 170.0, 235.0), (0.0, 175.0, -250.0), 50.0)

SUN = dict(dir=sun_dir(68.0, 20.0), intensity=1.0)

GI = {
    # A Cornell-like room lit through a skylight: the floor patch is direct, the rest is bounce; the red and green walls tint what faces them.
    'gi_room': dict(cam=CAM_IN, boxes=room(skylight_z=60.0), sun=SUN),
    # The same light, the camera turned so the lit patch is off screen: a method that only knows what the picture shows has nothing to bounce.
    'gi_away': dict(cam=CAM_AWAY, boxes=room(skylight_z=60.0), sun=SUN),
    # The room closed, the sun on its roof and walls outside: every pixel inside is 0 in Cycles, so whatever the engine shows is leak.
    'gi_leak': dict(cam=CAM_IN, boxes=room(), sun=dict(dir=sun_dir(40.0, 60.0), intensity=1.0)),
    # The room closed and dark but for an emissive panel on the back wall: the light of an emissive surface, which a lamp list does not have.
    # The room closed and lit by one lamp inside it (linear falloff to its radius): the engine lights what the lamp reaches, and the GI adds what those
    # surfaces bounce. No Cycles reference (its point lights are inverse-square watts); the reference is the CPU solver the GI is held to, tools/render-lab/gi_point_reference.json.
    'gi_point': dict(cam=CAM_IN, boxes=room(), sun=None, point=dict(pos=(0.0, 200.0, 50.0), intensity=0.3, radius=600.0)),
    'gi_emissive': dict(cam=CAM_IN, boxes=room(emissive=dict(centre=(0.0, 150.0, 248.0), size=(120.0, 70.0, 4.0))), sun=None, emission=4.0),
}


# Regions read by the comparison: a world point on a surface and the pixel radius of the patch read around where it lands.
REGIONS = {
    'gi_room': [
        ('sun patch (direct)', None), ('ceiling', (0.0, 299.0, 150.0)), ('red wall', (199.0, 120.0, 120.0)),
        ('green wall', (-199.0, 120.0, 120.0)), ('back wall', (60.0, 200.0, 249.0)), ('floor in shade', (120.0, 1.0, 200.0)),
        ('block, shaded face', (-90.0, 50.0, 29.0)),
    ],
    'gi_away': [
        ('front wall', (0.0, 170.0, -249.0)), ('ceiling', (0.0, 299.0, -100.0)), ('red wall', (199.0, 150.0, -100.0)),
        ('green wall', (-199.0, 150.0, -100.0)),
    ],
    'gi_leak': [
        ('ceiling', (0.0, 299.0, 150.0)), ('red wall', (199.0, 120.0, 120.0)), ('green wall', (-199.0, 120.0, 120.0)),
        ('back wall', (60.0, 200.0, 249.0)), ('floor', (100.0, 1.0, 150.0)),
    ],
    'gi_point': [
        ('ceiling', (0.0, 299.0, 50.0)), ('red wall', (199.0, 150.0, 50.0)), ('green wall', (-199.0, 150.0, 50.0)),
        ('back wall', (0.0, 150.0, 249.0)), ('floor', (0.0, 1.0, 50.0)), ('block, lit side', (-90.0, 50.0, 29.0)),
    ],
    'gi_emissive': [
        ('panel (emitter)', (0.0, 150.0, 246.0)), ('ceiling', (0.0, 299.0, 150.0)), ('red wall', (199.0, 120.0, 150.0)),
        ('green wall', (-199.0, 120.0, 150.0)), ('floor', (60.0, 1.0, 150.0)), ('block, top', (-90.0, 100.5, 80.0)),
    ],
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def project(point, cam, size=SIZE):
    """Where a world point lands, in pixels, for a camera (position, target, vertical fov degrees)."""
    pos, target, fov = cam
    f = [target[i] - pos[i] for i in range(3)]
    n = math.sqrt(sum(c * c for c in f))
    f = [c / n for c in f]
    right = [-f[2], 0.0, f[0]]
    rn = math.sqrt(sum(c * c for c in right))
    right = [c / rn for c in right]
    up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]]
    d = [point[i] - pos[i] for i in range(3)]
    z = sum(d[i] * f[i] for i in range(3))
    x = sum(d[i] * right[i] for i in range(3))
    y = sum(d[i] * up[i] for i in range(3))
    t = math.tan(math.radians(fov) / 2)
    aspect = size[0] / size[1]
    return (x / (z * t * aspect) * 0.5 + 0.5) * size[0], (0.5 - y / (z * t) * 0.5) * size[1], z


def sun_patch_centre(lab):
    """Where the sun through the skylight lands on the floor (the skylight's centre carried down along the light)."""
    d = GI[lab]['sun']['dir']
    sz = 60.0
    t = H / -d[1]
    return (0.0 + d[0] * t, 0.0, sz + d[2] * t)
