"""Render real control edges, not a dense triangulated beauty surface."""
import bpy,json,sys
from pathlib import Path
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage'];scene=bpy.context.scene
# Project actual pupil patch centers to support subsequent image overlays.
landmarks={}
for name in ('Review_front','Reference_front','Reference_profile','Reference_threequarter'):
    camera=bpy.data.objects[name];points={}
    for side in ('L','R'):
        eye=bpy.data.objects['Iris_'+side];co=I.world_coords(eye,I.mixed_coords(eye,exclude_prefix='NONE'))[0]
        p=world_to_camera_view(scene,camera,Vector(co));points[side]=[float(p.x*600),float((1-p.y)*800)]
    landmarks[name]=points
(ROOT/'review/projected-pupils.json').write_text(json.dumps(landmarks,indent=2))
multi=next(m for m in head.modifiers if m.type=='MULTIRES');multi.levels=0;multi.render_levels=0
mat=bpy.data.materials.new('Review_Control_Edges');mat.diffuse_color=(.012,.018,.022,1);mat.use_nodes=True
bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
if bs is None:
    bs=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=mat.node_tree.nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
bs.inputs['Base Color'].default_value=(.012,.018,.022,1);bs.inputs['Roughness'].default_value=.7
idx=len(head.data.materials);head.data.materials.append(mat)
wire=head.modifiers.new('Review_Control_Edges','WIREFRAME');wire.thickness=.00012;wire.use_replace=False;wire.offset=1;wire.material_offset=idx
scene.render.engine='CYCLES';scene.cycles.samples=24
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
for name in ('front','threequarter'):
    scene.camera=bpy.data.objects['Review_'+name];scene.render.filepath=str(ROOT/'review'/f'cage-{name}.png');bpy.ops.render.render(write_still=True)
print('CONTROL_CAGE_RENDERED',flush=True)
