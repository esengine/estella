"""Protect the deep orbital return and separate contacting lip shells by flow."""
import bpy,sys,json,heapq
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage'];keys=head.data.shape_keys.key_blocks
multi=next(m for m in head.modifiers if m.type=='MULTIRES')
multi.levels=0
bpy.context.view_layer.update()
print('CONTACT_START',flush=True)
if 'V7_10_Oral_Contact' in keys:keys['V7_10_Oral_Contact'].value=0
keys['V7_04_Orbital_Proportion'].value=0
current=I.world_coords(head,I.mixed_coords(head,exclude_prefix='NONE'))
new=I.eye_field(current)
eye_report=I.key_delta(head,'V7_04_Orbital_Proportion',current,new,{'target':'Visible lid edits with fixed deep orbital return'})
print('ORBITAL_KEY_UPDATED',flush=True)
I.fit_globes();I.fit_irises()
print('EYEBALLS_UPDATED',flush=True)
source=I.world_coords(head,I.mixed_coords(head))
edges=np.array([e.vertices[:] for e in head.data.edges]);neighbors=[[] for _ in source]
for a,b in edges:
    length=float(np.linalg.norm(source[a]-source[b]));neighbors[a].append((int(b),length));neighbors[b].append((int(a),length))
u=np.abs(source[:,0]);z=source[:,2];y=source[:,1]
def distances(seed):
    d=np.full(len(source),np.inf);heap=[]
    for i in np.flatnonzero(seed):d[i]=0;heapq.heappush(heap,(0,int(i)))
    while heap:
        v,i=heapq.heappop(heap)
        if v>d[i]:continue
        for j,length in neighbors[i]:
            candidate=v+length
            if candidate<d[j]:d[j]=candidate;heapq.heappush(heap,(candidate,j))
    return d
upper=distances((u<.020)&(z>1.532)&(z<1.540)&(y<-.137))
lower=distances((u<.020)&(z>1.514)&(z<1.523)&(y<-.137))
assert np.isfinite(upper).any() and np.isfinite(lower).any()
current=I.world_coords(head,I.mixed_coords(head,exclude_prefix='NONE'));new=current.copy()
weight=I.band(z,1.514,1.524,1.531,1.543)*(1-I.smooth((u-.024)/.014))*I.smooth((-.114-y)/.020)
weight*=np.isfinite(upper)&np.isfinite(lower)
sign=np.where(upper<lower,1,-1)
new[:,2]+=.0011*sign*weight
oral_report=I.key_delta(head,'V7_10_Oral_Contact',current,new,{'target':'Separate upper/lower lip shells using geodesic surface labels','separation_each_side_m':.0011})
(ROOT/'review/contact-protection.json').write_text(json.dumps({'orbital':eye_report,'oral':oral_report},indent=2))
# Match the framing of the fixed inspection images. Lens remains at 90 mm.
from mathutils import Vector
for ob in bpy.data.objects:
    if ob.name.startswith('Reference_') and ob.type=='CAMERA':
        target=Vector((0,-.048,1.582));ob.location=target+(ob.location-target).normalized()*.79
multi.levels=2
bpy.context.view_layer.update()
I.brow_proxies()
multi.levels=1
for item in (cameras:=json.loads((ROOT/'review/cameras.json').read_text())):item['distance_m']=.79
(ROOT/'review/cameras.json').write_text(json.dumps(cameras,indent=2))
I.save_stage('04-contact-protection');I.save_main()
print('CONTACT_PROTECTION_SAVED',flush=True)
