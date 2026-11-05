"""The engine's side of a GI lab scene: a project whose scene is the boxes of gi_specs as built-in cubes, the camera and the sun.
python gi_project.py <projectDir> <lab>   (env BACKEND, EFFECTS (json list), Q (json quality), BAKE=1 adds a BakedLighting entity)
"""
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gi_specs as S  # noqa: E402
import lab_specs as L  # noqa: E402

proj, lab = sys.argv[1:3]
spec = S.GI[lab]
os.makedirs(proj + '/assets/scenes', exist_ok=True)
os.makedirs(proj + '/assets/materials', exist_ok=True)
json.dump({'formatVersion': '1', 'name': 'GiLab', 'version': '0.1.0', 'tag': '3D', 'defaultScene': 'assets/scenes/lab.esscene',
           'designResolution': {'width': S.SIZE[0], 'height': S.SIZE[1]}, 'spineVersion': 'none',
           'features': {'rendering': {'backend': os.environ.get('BACKEND', 'webgl2'), 'colorSpace': 'linear', 'outputTransform': 'none',
                                      'quality': dict({'mode': 'high'}, **json.loads(os.environ.get('Q', '{}')))}}},
          open(proj + '/project.esproject', 'w'), indent=2)

pos, target, fov = spec['cam']
qw, qx, qy, qz = L.cam_quaternion(spec['cam'])
entities = [{'id': 0, 'name': 'Camera', 'parent': None, 'children': [], 'visible': True, 'components': [
    {'type': 'Transform', 'data': {'position': {'x': pos[0], 'y': pos[1], 'z': pos[2]}, 'rotation': {'w': qw, 'x': qx, 'y': qy, 'z': qz}}},
    {'type': 'Camera', 'data': {'projectionType': 0, 'fov': fov, 'nearPlane': 5.0, 'farPlane': 5000.0, 'isActive': True, 'priority': 0, 'clearFlags': 3}}]}]

panel_material = None
if 'emission' in spec:
    e = spec['emission']
    mid = str(uuid.uuid4())
    json.dump({'version': '1.0', 'type': 'material', 'shader': 'builtin:model', 'blendMode': 0, 'depthTest': True, 'depthWrite': True,
               'properties': {'u_emissive': {'r': e, 'g': e, 'b': e, 'a': 1}, 'u_roughness': 1}},
              open(proj + '/assets/materials/panel.esmaterial', 'w'), indent=2)
    json.dump({'uuid': mid, 'version': '2.0', 'type': 'material', 'importer': {}}, open(proj + '/assets/materials/panel.esmaterial.meta', 'w'), indent=2)
    panel_material = '@uuid:' + mid

for i, (name, centre, size, colour) in enumerate(spec['boxes']):
    mr = {'mesh': 'builtin:cube', 'lit': True, 'opaque': True, 'cullBackfaces': True,
          'color': {'r': colour[0], 'g': colour[1], 'b': colour[2], 'a': 1}}
    if name == 'panel' and panel_material:
        mr['material'] = panel_material
    entities.append({'id': 10 + i, 'name': name, 'parent': None, 'children': [], 'visible': True, 'components': [
        {'type': 'Transform', 'data': {'position': {'x': centre[0], 'y': centre[1], 'z': centre[2]},
                                       'scale': {'x': size[0] / 100.0, 'y': size[1] / 100.0, 'z': size[2] / 100.0}}},
        {'type': 'MeshRenderer', 'data': mr}]})

if spec['sun']:
    sw, sx, sy, sz = L.sun_quaternion(spec['sun']['dir'])
    entities.append({'id': 5, 'name': 'Sun', 'parent': None, 'children': [], 'visible': True, 'components': [
        {'type': 'Transform', 'data': {'rotation': {'w': sw, 'x': sx, 'y': sy, 'z': sz}}},
        {'type': 'Light', 'data': {'type': 1, 'color': {'r': 1, 'g': 1, 'b': 1, 'a': 1}, 'intensity': spec['sun']['intensity'], 'enabled': True,
                                   'meshShadows': True, 'shadowExtent': 0.0, 'shadowStrength': 1.0, 'sourceAngle': 0.0}}]})

if os.environ.get('BAKE') == '1':
    entities.append({'id': 6, 'name': 'Lighting', 'parent': None, 'children': [], 'visible': True, 'components': [
        {'type': 'BakedLighting', 'data': {'atlasSize': 1024, 'texelsPerUnit': float(os.environ.get('TPU', '0.2')), 'bounces': int(os.environ.get('BOUNCES', '4')),
                                           'samples': int(os.environ.get('BAKE_SAMPLES', '256')), 'probeSamples': 128}}]})

effects = json.loads(os.environ.get('EFFECTS', '[]'))
if effects:
    entities[0]['components'].append({'type': 'PostProcessVolume', 'data': {'isGlobal': True, 'weight': 1, 'priority': 0, 'effects': effects}})
json.dump({'version': 4, 'name': 'Lab', 'entities': entities}, open(proj + '/assets/scenes/lab.esscene', 'w'), indent=1)
print('project ready')
