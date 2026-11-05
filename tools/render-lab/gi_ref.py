"""The Cycles picture of a GI lab scene: the boxes of gi_specs, the camera and the sun, no sky.
blender --background --python gi_ref.py -- <lab> <out.png>   (env SAMPLES, default 512)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gi_specs as S  # noqa: E402
import lab_specs as L  # noqa: E402

lab, out = sys.argv[sys.argv.index('--') + 1:][:2]
spec = S.GI[lab]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = int(os.environ.get('SAMPLES', '512'))
scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'
scene.cycles.max_bounces = 12
scene.cycles.diffuse_bounces = 12
scene.render.resolution_x, scene.render.resolution_y = S.SIZE
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

to_b = lambda v: Vector((v[0] / 100.0, -v[2] / 100.0, v[1] / 100.0))
world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
scene.world = world

for name, centre, size, colour in spec['boxes']:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=to_b(centre))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0] / 100.0, size[2] / 100.0, size[1] / 100.0)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    lin = tuple(colour)   # linear, as the engine takes MeshRenderer.color
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if name == 'panel':
        bsdf.inputs['Emission Color'].default_value = (1, 1, 1, 1)
        bsdf.inputs['Emission Strength'].default_value = spec['emission']
    ob.data.materials.append(m)

pos, target, fov = spec['cam']
cam_data = bpy.data.cameras.new('C')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(fov)
cam_data.clip_start, cam_data.clip_end = 0.05, 100
cam = bpy.data.objects.new('C', cam_data)
scene.collection.objects.link(cam)
cam.location = to_b(pos)
cam.rotation_euler = (to_b(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

if spec['sun']:
    sun = bpy.data.lights.new('S', 'SUN')
    sun.energy = spec['sun']['intensity'] * L.SUN_STRENGTH_PER_INTENSITY
    sun.angle = 0.0
    ob = bpy.data.objects.new('S', sun)
    scene.collection.objects.link(ob)
    d = spec['sun']['dir']
    ob.rotation_euler = Vector((d[0], -d[2], d[1])).to_track_quat('-Z', 'Y').to_euler()

scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
