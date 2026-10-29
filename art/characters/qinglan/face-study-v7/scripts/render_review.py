"""Render a saved control-cage candidate without changing the live session."""
import bpy,sys,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=32
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.cycles.device='GPU'
scene.render.resolution_x=600;scene.render.resolution_y=800
scene.render.resolution_percentage=100
names=('front','profile','threequarter','low')
if '--front-only' in sys.argv:names=('front',)
for name in names:
    scene.camera=bpy.data.objects['Review_'+name]
    scene.render.filepath=str(ROOT/'review'/f'after-{name}.png')
    bpy.ops.render.render(write_still=True)
if '--reference-views' in sys.argv:
    for name in ('front','profile','threequarter'):
        scene.camera=bpy.data.objects['Reference_'+name]
        scene.render.filepath=str(ROOT/'review'/f'reference-camera-{name}.png')
        bpy.ops.render.render(write_still=True)
print('REVIEW_RENDER_COMPLETE '+json.dumps({'views':names}),flush=True)
