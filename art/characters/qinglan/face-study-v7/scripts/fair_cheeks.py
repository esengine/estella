"""Fair the broad cheek plane without changing the matched front contour."""
import bpy,sys,json
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage'];keys=head.data.shape_keys.key_blocks
multi=next(m for m in head.modifiers if m.type=='MULTIRES');multi.levels=0
name='V7_11_Cheek_Plane_Fairing'
if name in keys:keys[name].value=0
for rejected in ('V7_09_Upper_Lip','V7_10_Oral_Contact'):
    if rejected in keys:keys[rejected].value=0
current=I.world_coords(head,I.mixed_coords(head,exclude_prefix='NONE'));new=current.copy()
u=np.abs(current[:,0]);z=current[:,2];y=current[:,1]
weight=I.band(u,.027,.038,.067,.082)*I.band(z,1.510,1.538,1.564,1.593)*I.smooth((-.045-y)/.035)
tree=BVHTree.FromPolygons([Vector(p) for p in current],[list(p.vertices) for p in head.data.polygons])
visible=np.zeros(len(current))
for i in np.flatnonzero(weight>0):
    hit,normal,index,distance=tree.ray_cast(Vector((current[i,0],-.4,current[i,2])),Vector((0,1,0)))
    if hit is not None and current[i,1]-hit.y<.001:visible[i]=1
# A smooth convex cheek envelope is an explicit volume guide, limited to
# the externally visible cheek. It cannot move the oral cavity or eye return.
target=-.04-.12*np.sqrt(np.maximum(1-(u/.074)**2,0))
fill=np.minimum(np.maximum(y-target,0),.018)
new[:,1]-=fill*weight*visible
report=I.key_delta(head,name,current,new,{'target':'Fill the hollow cheek surface to a local convex envelope; matched X/Z contour held','depth_only':True,'internal_vertices_protected_by_front_visibility':True})
(ROOT/'review/cheek-fairing.json').write_text(json.dumps(report,indent=2))
multi.levels=1;bpy.context.view_layer.update()
I.save_stage('05-cheek-planes');I.save_main()
print('CHEEK_FAIRING_SAVED '+json.dumps(report),flush=True)
