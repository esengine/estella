"""Compare the control surface with inherited sculpt displacement, without overwriting it."""
import bpy,sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage']
head.data.shape_keys.key_blocks['V7_10_Oral_Contact'].value=0
head.hide_set(False);bpy.context.view_layer.objects.active=head;head.select_set(True)
multi=next(m for m in head.modifiers if m.type=='MULTIRES')
multi.show_viewport=False;multi.show_render=False
sub=head.modifiers.new('Control_Surface_Subdivision','SUBSURF');sub.levels=2;sub.render_levels=2
bpy.ops.object.modifier_move_to_index(modifier=sub.name,index=0)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
out=ROOT.parents[3]/'output/qinglan/identity-v7'
for name in ('front','threequarter','profile'):
    scene.camera=bpy.data.objects['Review_'+name];scene.render.filepath=str(out/f'subdivision-{name}.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'control-surface-preview.blend'),copy=True,compress=True)
print('CONTROL_SURFACE_PREVIEW_COMPLETE',flush=True)
