"""Author equipment sockets from the real Tripo mesh, without changing its shape.

Background Blender, --write to author; default verifies the GLB, profile and native
prefab. --render also produces the diagram using projector-socket-diagram.py.
Only POSITION accessor values are converted from normalized units to metres. All
other binary data (topology, normals, UVs and embedded PBR images) stay byte exact.
This is equipment authoring data, not an implementation of an engine hand solver.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import runpy
import struct
import sys

from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

PROJECT = Path(__file__).resolve().parents[1]
STEM = 'UC_EQ_ConstructionProjector_v02'
ASSET = PROJECT / 'assets/models/equipment/construction-projector-v02'
REF = PROJECT / 'references/construction-projector-v02'
MODEL = ASSET / (STEM + '.glb')
PROFILE = REF / 'grasp-profile.json'
OUT = PROJECT.parents[1] / 'output/cyber-rooftop/projector-sockets'
SOURCE_SHA = '60d3641684c7a35dc9457856b77ece9741a00f4c48e6507c8a73d231a24ad552'
METRES = 0.315
GRIP_UP = Vector((0, 1, .39)).normalized()


def read_glb(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert (magic, version, length) == (0x46546c67, 2, len(raw))
    size, kind = struct.unpack_from('<II', raw, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(raw[20:20 + size])
    bsize, bkind = struct.unpack_from('<II', raw, 20 + size)
    assert bkind == 0x004e4942 and len(raw) == 28 + size + bsize
    return doc, bytearray(raw[28 + size:]), raw


def layout(doc, index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    fmt = {5126: 'f', 5125: 'I', 5123: 'H'}[a['componentType']]
    n = {'VEC3': 3, 'SCALAR': 1}[a['type']]
    step = v.get('byteStride', struct.calcsize(fmt) * n)
    offset = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return a, '<' + fmt * n, step, offset


def accessor(doc, binary, index):
    a, fmt, step, offset = layout(doc, index)
    return [struct.unpack_from(fmt, binary, offset + i * step) for i in range(a['count'])]


def position_ids(doc):
    return sorted({p['attributes']['POSITION'] for m in doc['meshes'] for p in m['primitives']})


def invariant_hash(doc, binary):
    # Mask just the position floats. Any other binary change is an error.
    masked = bytearray(binary)
    for index in position_ids(doc):
        a, fmt, step, offset = layout(doc, index)
        assert fmt == '<fff' and 'sparse' not in a
        for i in range(a['count']):
            masked[offset + i * step:offset + i * step + 12] = b'\0' * 12
    return hashlib.sha256(masked).hexdigest()


def position_hash(doc, binary):
    digest = hashlib.sha256()
    for index in position_ids(doc):
        a, _, step, offset = layout(doc, index)
        for i in range(a['count']):
            digest.update(binary[offset + i * step:offset + i * step + 12])
    return digest.hexdigest()


def convert_units(doc, binary):
    for index in position_ids(doc):
        a, fmt, step, offset = layout(doc, index)
        points = accessor(doc, binary, index)
        for i, point in enumerate(points):
            struct.pack_into(fmt, binary, offset + i * step, *(v * METRES for v in point))
        for key in ('min', 'max'):
            if key in a:
                a[key] = [v * METRES for v in a[key]]


def mesh_bvh(doc, binary):
    assert len(doc['meshes']) == 1 and len(doc['meshes'][0]['primitives']) == 1
    p = doc['meshes'][0]['primitives'][0]
    vertices = accessor(doc, binary, p['attributes']['POSITION'])
    indices = [v[0] for v in accessor(doc, binary, p['indices'])]
    assert len(indices) == 31554
    return BVHTree.FromPolygons(vertices, [indices[i:i + 3] for i in range(0, len(indices), 3)], all_triangles=True), vertices


def rounded(values):
    return [round(v, 9) for v in values]


def frame(normal, up=GRIP_UP):
    z = Vector(normal).normalized()
    y = (up - z * up.dot(z)).normalized()
    x = y.cross(z).normalized()
    q = Matrix((x, y, z)).transposed().to_quaternion()
    return rounded((q.x, q.y, q.z, q.w))


def make_profile(bvh, vertices, provenance):
    def hit(origin, direction):
        # Author seeds in the original normalized frame, measure real triangles.
        point, normal, tri, distance = bvh.ray_cast(Vector(origin) * METRES, Vector(direction))
        assert point is not None, (origin, direction)
        assert normal.dot(Vector(direction)) < 0, ('Expected exterior surface', origin, list(point), list(normal))
        return point, normal, tri

    def grip_span(y):
        rear = hit((0, y, -.6), (0, 0, 1))
        point, normal, tri, _ = bvh.ray_cast(rear[0] + Vector((0, 0, 1e-6)), Vector((0, 0, 1)))
        assert point is not None and normal.z > 0, ('Grip exit', y)
        return rear, (point, normal, tri)

    contacts = [
        ('Socket_Palm_R', 'palm-surface', (-.2, .255, -.382), (1, 0, 0), 'Palm pad; negative-X side'),
        ('Socket_Thumb_R', 'finger-pad-surface', (.2, .345, -.36), (-1, 0, 0), 'Opposed thumb pad; positive-X side'),
        ('Socket_Index_R', 'finger-pad-surface', (-.2, .405, -.185), (1, 0, 0), 'Idle index outside the trigger guard'),
        ('Socket_Middle_R', 'finger-pad-surface', (.2, .25, -.325), (-1, 0, 0), 'Middle fingertip contact'),
        ('Socket_Ring_R', 'finger-pad-surface', (.2, .215, -.345), (-1, 0, 0), 'Ring fingertip contact'),
        ('Socket_Pinky_R', 'finger-pad-surface', (.2, .168, -.362), (-1, 0, 0), 'Pinky fingertip contact'),
        ('Guide_Middle_R', 'wrap-surface', (0, .25, 0), None, 'Front wrap guide; not a bone target'),
        ('Guide_Ring_R', 'wrap-surface', (0, .215, 0), None, 'Front wrap guide; not a bone target'),
        ('Guide_Pinky_R', 'wrap-surface', (0, .168, 0), None, 'Front wrap guide; not a bone target'),
        ('Socket_Trigger', 'action-surface', (0, .35, -.12), (0, 0, -1), 'Optional index press contact; guard clearance must be solved'),
        ('Socket_Support_L', 'palm-surface', (0, -.2, .16), (0, 1, 0), 'Optional left palm under forward housing'),
    ]
    sockets = []
    for name, role, origin, direction, note in contacts:
        point, normal, tri = hit(origin, direction) if direction else grip_span(origin[1])[1]
        sockets.append(dict(name=name, role=role, positionMetres=rounded(point), rotationXYZW=frame(normal),
                            surfaceNormal=rounded(normal), sourceTriangle=tri, note=note))
    # Grip frame sits inside the handle and is a registration frame, not a wrist.
    rear_hit, front_hit = grip_span(.255)
    rear, front = rear_hit[0], front_hit[0]
    centre = (rear + front) / 2
    rotation = Matrix.Rotation(math.atan(.39), 3, 'X').to_quaternion()
    sockets.insert(0, dict(name='Socket_Grip_R', role='grip-frame', positionMetres=rounded(centre),
                          rotationXYZW=rounded((rotation.x, rotation.y, rotation.z, rotation.w)),
                          note='Inside grip; +Y follows handle, +Z points forward. Not a wrist bone target.'))
    bounds = [[min(v[i] for v in vertices) for i in range(3)], [max(v[i] for v in vertices) for i in range(3)]]
    sockets.append(dict(name='Socket_Muzzle', role='emission-frame',
                        positionMetres=[0, round(.51 * METRES, 9), round(bounds[1][2] + .005, 9)],
                        rotationXYZW=[0, 0, 0, 1], note='5 mm ahead of frontmost housing; local +Z emits'))
    sections = []
    for y in (.15, .19, .23, .25, .31, .35):
        back_hit, forward_hit = grip_span(y)
        back, forward = back_hit[0], forward_hit[0]
        c = (back + forward) / 2
        left = hit((-.2, y, c.z / METRES), (1, 0, 0))[0]
        right = hit((.2, y, c.z / METRES), (-1, 0, 0))[0]
        sections.append(dict(centreMetres=rounded(c), halfWidthMetres=round((right.x - left.x) / 2, 9),
                             halfDepthMetres=round((forward.z - back.z) / 2, 9)))
    return dict(schemaVersion=1, asset=STEM, status='equipment sockets authored; character grasp integration deferred',
                units='metres', coordinateSystem='right-handed; +Y up; +Z muzzle forward; +X lateral',
                rootScale=[1, 1, 1], quaternionOrder='x,y,z,w',
                contactAxes='+Z outward surface normal; +Y handle-up projected onto contact tangent plane; +X = +Y cross +Z',
                gripAxes='+Y along handle toward receiver; +Z forward, perpendicular to handle; +X lateral',
                source=provenance, boundsMetres=[rounded(v) for v in bounds], sockets=sockets,
                gripSections=dict(kind='approximate horizontal elliptical sections; not collision geometry', samples=sections),
                handContract=dict(
                    attachmentFrame='Mounts/Socket_Grip_R',
                    contactTarget='surface point + outward normal * character-specific pad/joint offset',
                    wrist='Character hand profile supplies wrist-to-grasp registration; Grip_R is inside the handle.',
                    fingers='Use joint limits, finger lengths, pad thickness and wrap guides; solve against actual mesh.',
                    index='Rest at Socket_Index_R; use Socket_Trigger only for press after checking guard clearance.',
                    elbow='Character-owned pole/constraint, not an equipment socket.',
                    solveOrder='Aim equipment, place wrist from character registration, solve arm then fingers; avoid cyclic parenting.'),
                optionalSockets=['Socket_Support_L', 'Socket_Trigger'])


def write_asset(doc, binary, profile):
    body = next(n for n in doc['nodes'] if 'mesh' in n).copy()
    assert not any(k in body for k in ('matrix', 'translation', 'rotation', 'scale', 'children'))
    body['name'] = 'Body'
    doc['meshes'][0]['name'] = STEM + '_Body'
    for i, material in enumerate(doc.get('materials', [])):
        material['name'] = f'M_ConstructionProjector_{i:02}'
    nodes = [dict(name=STEM, children=[1, 2]), body,
             dict(name='Mounts', children=list(range(3, 3 + len(profile['sockets']))))]
    for socket in profile['sockets']:
        nodes.append(dict(name=socket['name'], translation=socket['positionMetres'], rotation=socket['rotationXYZW'],
                          extras=dict(role=socket['role'], note=socket['note'])))
    doc['nodes'] = nodes
    doc['scenes'] = [dict(name=STEM, nodes=[0])]
    doc['scene'] = 0
    doc.setdefault('extras', {})['estellaSocketAuthoring'] = profile['source']
    payload = json.dumps(doc, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload) % 4)
    output = struct.pack('<III', 0x46546c67, 2, 28 + len(payload) + len(binary))
    output += struct.pack('<II', len(payload), 0x4e4f534a) + payload
    output += struct.pack('<II', len(binary), 0x004e4942) + binary
    MODEL.write_bytes(output)
    PROFILE.write_text(json.dumps(profile, indent=2) + '\n', encoding='utf-8')


def validate(doc, binary, profile, bvh, prefab_required):
    assert invariant_hash(doc, binary) == profile['source']['nonPositionBinarySha256']
    assert position_hash(doc, binary) == profile['source']['metrePositionsSha256']
    assert len({n['name'] for n in doc['nodes']}) == len(doc['nodes'])
    assert all(n.get('scale', [1, 1, 1]) == [1, 1, 1] for n in doc['nodes'])
    checks = []
    for socket in profile['sockets']:
        node = next(n for n in doc['nodes'] if n['name'] == socket['name'])
        assert node['translation'] == socket['positionMetres'] and node['rotation'] == socket['rotationXYZW']
        assert all(math.isfinite(v) for v in node['translation'] + node['rotation'])
        assert abs(sum(v*v for v in node['rotation']) - 1) < 1e-6
        distance = None
        if 'surfaceNormal' in socket:
            point = Vector(socket['positionMetres']); normal = Vector(socket['surfaceNormal'])
            distance = bvh.find_nearest(point)[3]
            assert distance < 1e-6, (socket['name'], distance)
            # A point slightly outside the surface must ray-hit back at the contact.
            hit, _, _, _ = bvh.ray_cast(point + normal * .001, -normal, .002)
            assert hit is not None and (hit - point).length < 1e-5
        checks.append(dict(name=socket['name'], surfaceDistanceMetres=distance))
    if prefab_required:
        prefab = json.loads((ASSET / (STEM + '.esprefab')).read_text())
        entities = {e['name']: e for e in prefab['entities']}
        mounts = entities['Mounts']
        for socket in profile['sockets']:
            entity = entities[socket['name']]
            assert entity['parent'] == mounts['prefabEntityId']
            transform = next(c['data'] for c in entity['components'] if c['type'] == 'Transform')
            assert all(abs(transform.get('position', {}).get(k, 0) - v) < 1e-7 for k, v in zip('xyz', socket['positionMetres']))
            assert all(abs(transform.get('rotation', {}).get(k, 1 if k == 'w' else 0) - v) < 1e-7 for k, v in zip('xyzw', socket['rotationXYZW']))
            assert transform.get('scale', dict(x=1, y=1, z=1)) == dict(x=1, y=1, z=1)
    report = dict(passed=True, socketCount=len(checks), triangles=10518,
                  nonPositionBinaryUnchanged=True, nativePrefabChecked=prefab_required, checks=checks)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    doc, binary, raw = read_glb(MODEL)
    provenance = doc.get('extras', {}).get('estellaSocketAuthoring')
    if not provenance:
        assert args.write, 'Run --write once before verification'
        assert hashlib.sha256(raw).hexdigest() == SOURCE_SHA, 'Unexpected source; do not overwrite'
        provenance = dict(provider='Tripo', originalGlbSha256=SOURCE_SHA,
                          normalizationScaleToMetres=METRES, nonPositionBinarySha256=invariant_hash(doc, binary),
                          geometryChange='Uniform unit conversion only; topology, UVs, normals and PBR byte-preserved')
        convert_units(doc, binary)
    assert invariant_hash(doc, binary) == provenance['nonPositionBinarySha256']
    if 'metrePositionsSha256' in provenance:
        assert position_hash(doc, binary) == provenance['metrePositionsSha256']
    else:
        assert args.write
        provenance['metrePositionsSha256'] = position_hash(doc, binary)
    bvh, vertices = mesh_bvh(doc, binary)
    if args.write:
        profile = make_profile(bvh, vertices, provenance)
        write_asset(doc, binary, profile)
        doc, binary, _ = read_glb(MODEL)
    else:
        profile = json.loads(PROFILE.read_text())
    report = validate(doc, binary, profile, bvh, prefab_required=not args.write)
    if args.render:
        runpy.run_path(str(Path(__file__).with_name('projector-socket-diagram.py')), run_name='__main__')
    print('RESULT ' + json.dumps(report))


if __name__ == '__main__':
    main()
