import bpy,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.open_mainfile(filepath=str(WORK/'01_body.blend'))
body=bpy.data.objects['QL01_Body']
body.data.materials.clear();body.data.materials.append(material('M_Skin',(.78,.59,.49),.48,sss=.10))
mod=body.modifiers.new('Preview subdivision','SUBSURF');mod.levels=2;mod.render_levels=2
src=bpy.data.objects['SRC_Qinglan_Parametric']
for m in src.modifiers:m.show_viewport=False
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get();ev=src.evaluated_get(dg);me=ev.to_mesh()
scale=json.loads((WORK/'body-landmarks.json').read_text())['scale']
pts=[v.co*scale for v in me.vertices]
groups={}
for g in src.vertex_groups:
    if any(k in g.name for k in ['joint','eye','head','face']):
        vs=[pts[v.index] for v in src.data.vertices if any(x.group==g.index for x in v.groups)]
        if vs:groups[g.name]={'min':[min(v[k] for v in vs) for k in range(3)],'max':[max(v[k] for v in vs) for k in range(3)],'center':[sum(v[k] for v in vs)/len(vs) for k in range(3)]}
ev.to_mesh_clear()
for m in src.modifiers:m.show_viewport=True
(WORK/'joints.json').write_text(json.dumps(groups,indent=2))
verts=body.data.vertices
slices={}
for z in [1.68,1.63,1.60,1.58,1.55,1.50,1.45,1.4,1.35,1.3,1.2,1.1,1.,.95]:
    vs=[v.co for v in verts if abs(v.co.z-z)<.012]
    if vs:slices[z]={'x':[min(v.x for v in vs),max(v.x for v in vs)],'y':[min(v.y for v in vs),max(v.y for v in vs)]}
print('SLICES '+json.dumps(slices))
studio()
cam=camera('FaceFront',(0,-2,1.59),(0,-.04,1.59),ortho=.38)
render(cam,WORK/'face-base.png',768,900,32)
print('JOINTS '+json.dumps(groups))
