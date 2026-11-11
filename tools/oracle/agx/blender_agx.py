# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
"""
Blender's own AgX, read back for a list of flat colours: the reference tools/oracle/agx.mjs compares the engine's AgX effect against.

    blender --background --python tools/oracle/agx/blender_agx.py -- patches.json out.json [Look]

patches.json is a list of scene-linear [r, g, b]. Each becomes a flat quad drawn by Workbench with no lighting, no anti-aliasing and no
dithering, under the view transform AgX (look None, or the named look), and out.json holds the 8-bit display value Blender writes for it:
what a person comparing the engine with Blender's viewport sees.
"""
import json
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
patches = json.load(open(args[0]))
look = args[2] if len(args) > 2 else 'None'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'OBJECT'
scene.display.render_aa = 'OFF'
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '8'
scene.render.dither_intensity = 0.0
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = look
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
scene.display_settings.display_device = 'sRGB'
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.0, 0.0, 0.0)

CELL = 32
cols = 8
rows = (len(patches) + cols - 1) // cols
scene.render.resolution_x = cols * CELL
scene.render.resolution_y = rows * CELL
scene.render.resolution_percentage = 100

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = float(cols)
cam.location = (cols / 2.0, -rows / 2.0, 10.0)
scene.collection.objects.link(cam)
scene.camera = cam

for n, rgb in enumerate(patches):
    x, y = n % cols, n // cols
    mesh = bpy.data.meshes.new('q%d' % n)
    mesh.from_pydata([(0, 0, 0), (1, 0, 0), (1, -1, 0), (0, -1, 0)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new('q%d' % n, mesh)
    obj.location = (x, -y, 0)
    obj.color = (rgb[0], rgb[1], rgb[2], 1.0)
    scene.collection.objects.link(obj)

out_png = args[1] + '.png'
scene.render.filepath = out_png
bpy.ops.render.render(write_still=True)

img = bpy.data.images.load(out_png)
w, h = img.size
px = list(img.pixels)
result = []
for n in range(len(patches)):
    x, y = n % cols, n // cols
    cx, cy = x * CELL + CELL // 2, (rows - 1 - y) * CELL + CELL // 2  # image rows run bottom-up
    i = (cy * w + cx) * 4
    result.append([round(px[i + k] * 255) for k in range(3)])
json.dump({'look': look, 'view': 'AgX', 'patches': patches, 'codes': result}, open(args[1], 'w'))
print('AGX_DONE', len(result))
