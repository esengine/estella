"""Move labelled face-cage vertices with smooth spline displacement.

The targets are measured from the saved working face reference, not generated
from a face recipe. Source vertex IDs, achieved offsets and residuals are saved.
"""
import bpy,sys,os,json,math
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'head-base.blend'))
head=bpy.data.objects['Qinglan_Head_Base'];head.name='Qinglan_Face_Cage'
base=np.array([tuple(v.co) for v in head.data.vertices],dtype=float)
current=base.copy();records=[];stages=[]
head.shape_key_add(name='Basis_Previous_Face',from_mix=False)

def nearest(hint):return int(np.argmin(np.linalg.norm((base-np.array(hint))*[1,1,1],axis=1)))
def radial(points,controls,radius):
    r=np.linalg.norm((points[:,None,:]-controls[None,:,:])/np.array(radius),axis=2)
    return r
def stage(name,specs,radius):
    global current
    constraints={}
    for label,hint,target,mirror in specs:
        for sign in ([1,-1] if mirror else [1]):
            h=np.array(hint,dtype=float);h[0]*=sign;i=nearest(h)
            dest=current[i].copy() if target is None else np.array(target,dtype=float)
            if target is not None:dest[0]*=sign
            constraints[i]=(label+('_L' if sign==1 else '_R') if mirror else label,dest)
    ids=list(constraints);centers=current[ids].copy();targets=np.array([constraints[i][1] for i in ids])
    # A linear polyharmonic spline has a global affine component. Unlike a
    # compact interpolant it cannot create a ring of displacement around an
    # isolated pin. Fixed anchors below bound each regional solve.
    kernel=radial(centers,centers,radius)
    affine=np.column_stack([np.ones(len(ids)),centers/np.array(radius)])
    system=np.block([[kernel+np.eye(len(ids))*1e-7,affine],
                     [affine.T,np.zeros((4,4))]])
    weights=np.linalg.solve(system,np.vstack([targets-centers,np.zeros((4,3))]))
    delta=np.column_stack([radial(current,centers,radius),np.ones(len(current)),current/np.array(radius)])@weights
    # The neck cut is fixed; edits fade out before the boundary ring.
    fade=np.clip((current[:,2]-1.445)/.025,0,1);delta*=fade[:,None]
    before=current.copy();current+=delta
    key=head.shape_key_add(name=name,from_mix=False)
    for v,co in zip(key.data,base+delta):v.co=co
    key.value=1
    group=head.vertex_groups.new(name=name)
    influenced=np.linalg.norm(delta,axis=1)
    for i,d in enumerate(influenced):
        if d>1e-5:group.add([i],min(1,float(d/influenced.max())),'REPLACE')
    for i,target in zip(ids,targets):
        records.append({'stage':name,'label':constraints[i][0],'cage_vertex':i,
          'source_vertex':int(head.data.attributes['source_vertex_id'].data[i].value),
          'before':before[i].tolist(),'target':target.tolist(),'after':current[i].tolist(),
          'residual_mm':float(np.linalg.norm(current[i]-target)*1000)})
    stages.append({'name':name,'pins':len(ids),'moved_vertices':int(np.count_nonzero(influenced>1e-5)),
       'max_displacement_mm':float(influenced.max()*1000),'radius_m':radius})

# Named control vertices first establish the skull/jaw. Inner face pins stay
# fixed at this stage so that silhouette work cannot silently move the eyes.
stage('01_Skull_Cheeks_Jaw',[
 ('Temple',(.073,-.052,1.638),(.071,-.047,1.638),True),
 ('Upper_Cheek',(.070,-.080,1.584),(.069,-.080,1.584),True),
 ('Cheek_Turn',(.066,-.075,1.557),(.063,-.077,1.555),True),
 ('Jaw_Upper',(.0546,-.088,1.530),(.052,-.085,1.527),True),
 ('Jaw_Lower',(.040,-.110,1.510),(.037,-.107,1.506),True),
 ('Chin_Side',(.020,-.126,1.490),(.019,-.124,1.489),True),
 ('Chin_Front',(0,-.1426,1.498),(0,-.134,1.494),False),
 ('Chin_Lower_Front',(0,-.14107,1.49267),(0,-.131,1.4855),False),
 ('Chin_Under',(0,-.124,1.483),(0,-.122,1.4795),False),
 ('Under_Jaw',(.031,-.073,1.488),(.029,-.064,1.493),True),
 ('Jaw_Angle',(.055,-.035,1.511),(.053,-.025,1.520),True),
 ('Ear_Lobe',(.082,-.043,1.554),(.081,-.028,1.554),True),
 ('Ear_Root',(.077,-.022,1.592),(.080,-.007,1.592),True),
 ('Ear_Helix',(.081,-.039,1.596),(.084,-.024,1.596),True),
 ('Occipital_Low',(0,.076,1.579),(0,.056,1.579),False),
 ('Occipital_Mid',(0,.091,1.625),(0,.061,1.625),False),
 ('Occipital_High',(0,.066,1.677),(0,.052,1.677),False),
 ('Crown',(0,-.025,1.720),None,False),
 ('Crown_Side',(.058,.014,1.697),None,True),
 ('Neck_Back',(0,.029,1.464),None,False),
 ('Neck_Side',(.038,-.012,1.469),None,True),
 ('Eye_Hold',(.033,-.143,1.603),None,True),
 ('Nose_Hold',(0,-.165,1.559),None,False),
 ('Mouth_Hold',(.014,-.150,1.528),None,True),
],(.070,.090,.075))

# Reference front projection: nose midline x=287.5 px, chin y=641 px;
# 0.432 mm/px. The profile uses the same vertical scale, not independent zoom.
stage('02_Forehead_Orbit_Eyelids',[
 ('Forehead_Upper',(0,-.131,1.681),(0,-.116,1.681),False),
 ('Forehead_Mid',(0,-.146,1.651),(0,-.132,1.651),False),
 ('Glabella',(0,-.149,1.622),(0,-.140,1.619),False),
 ('Forehead_Side',(.042,-.130,1.645),(.042,-.118,1.645),True),
 ('Brow_Inner',(.017,-.144,1.616),(.021,-.134,1.613),True),
 ('Brow_Arch',(.041,-.134,1.617),(.044,-.125,1.619),True),
 ('Brow_Outer',(.058,-.112,1.615),(.061,-.104,1.612),True),
 ('Inner_Canthus',(.015,-.139,1.597),(.0225,-.1275,1.595),True),
 ('Upper_Lid_Inner',(.024,-.145,1.604),(.030,-.132,1.603),True),
 ('Upper_Lid_Peak',(.03825,-.14165,1.60446),(.0405,-.1308,1.6054),True),
 ('Upper_Lid_Outer',(.047,-.135,1.603),(.052,-.125,1.603),True),
 ('Outer_Canthus',(.049,-.130,1.600),(.059,-.122,1.599),True),
 ('Lower_Lid_Outer',(.046,-.134,1.594),(.050,-.125,1.5935),True),
 ('Lower_Lid_Center',(.03262,-.14039,1.59314),(.039,-.1305,1.5918),True),
 ('Lower_Lid_Inner',(.024,-.141,1.593),(.030,-.132,1.593),True),
 ('Lower_Orbit',(.038,-.133,1.581),(.040,-.124,1.580),True),
 ('Cheek_Inner',(.030,-.128,1.565),(.032,-.129,1.565),True),
 ('Nasal_Root',(0,-.147,1.600),(0,-.1385,1.598),False),
 ('Nose_Hold',(0,-.165,1.559),None,False),
 ('Mouth_Hold',(0,-.154,1.532),None,False),
 ('Temple_Hold',(.073,-.052,1.638),None,True),
 ('Chin_Hold',(0,-.1426,1.498),None,False),
 ('Back_Hold',(0,.091,1.625),None,False),
 ('Crown_Hold',(0,-.025,1.720),None,False),
 ('Ear_Hold',(.081,-.039,1.596),None,True),
 ('Jaw_Hold',(.0546,-.088,1.530),None,True),
],(.047,.047,.042))

stage('03_Nose_Philtrum_Lips',[
 ('Nasion',(0,-.147,1.600),(0,-.1385,1.598),False),
 ('Bridge',(0,-.153,1.580),(0,-.1458,1.5785),False),
 ('Nose_Dorsum',(0,-.162,1.567),(0,-.153,1.566),False),
 ('Nose_Tip',(0,-.1655,1.559),(0,-.160,1.553),False),
 ('Nose_Base',(0,-.1629,1.552),(0,-.1515,1.5445),False),
 ('Nose_Wing',(.0125,-.148,1.552),(.0142,-.1405,1.547),True),
 ('Alar_Root',(.017,-.137,1.549),(.017,-.132,1.548),True),
 ('Philtrum',(0,-.143,1.540),(0,-.139,1.536),False),
 ('Philtrum_Column',(.005,-.149,1.539),(.005,-.143,1.534),True),
 ('Cupid_Peak',(.007,-.154,1.535),(.0075,-.1475,1.530),True),
 ('Cupid_Center',(0,-.1544,1.536),(0,-.1465,1.5276),False),
 ('Upper_Vermillion',(0,-.154,1.5326),(0,-.150,1.525),False),
 ('Upper_Lip_Side',(.016,-.146,1.533),(.018,-.1445,1.526),True),
 ('Mouth_Corner',(.024,-.139,1.527),(.0245,-.139,1.5227),True),
 ('Upper_Seam',(0,-.149,1.529),(0,-.1475,1.523),False),
 ('Lower_Seam',(0,-.148,1.5275),(0,-.1455,1.5224),False),
 ('Lower_Lip_Peak',(0,-.149,1.5232),(0,-.1445,1.517),False),
 ('Lower_Lip_Side',(.014,-.145,1.523),(.016,-.143,1.5178),True),
 ('Lower_Lip_Border',(0,-.149,1.5218),(0,-.1405,1.514),False),
 ('LabioMental_Fold',(0,-.142,1.512),(0,-.1355,1.507),False),
 ('Cheek_Hold',(.042,-.110,1.551),None,True),
 ('Chin_Hold',(0,-.1426,1.498),None,False),
 ('Eye_Hold',(.024,-.145,1.604),None,True),
 ('Jaw_Hold',(.0546,-.088,1.530),None,True),
 ('Forehead_Hold',(0,-.146,1.651),None,False),
 ('Crown_Hold',(0,-.025,1.720),None,False),
 ('Back_Hold',(0,.091,1.625),None,False),
 ('Ear_Hold',(.081,-.039,1.596),None,True),
],(.038,.043,.039))

# The volume check uses an ellipsoid seated behind the aperture. Move only
# outward-facing skin where its current position would intersect that volume;
# this retains the socket's internal wall and the original edge topology.
before=current.copy()
for sign in [-1,1]:
    dx=current[:,0]-sign*.040;dz=current[:,2]-1.598
    q=(dx/.022)**2+(dz/.0155)**2
    for i in np.flatnonzero((q<1)&(base[:,1]<-.118)):
        if head.data.vertices[i].normal.y>-.05:continue
        surface=-.110-.0195*math.sqrt(max(0,1-q[i]))-.00055
        if current[i,1]>surface:current[i,1]=surface
delta=current-before
key=head.shape_key_add(name='04_Eyelid_Volume_Clearance',from_mix=False)
for v,co in zip(key.data,base+delta):v.co=co
key.value=1
group=head.vertex_groups.new(name=key.name)
influenced=np.linalg.norm(delta,axis=1)
for i,d in enumerate(influenced):
    if d>1e-6:group.add([i],min(1,float(d/influenced.max())),'REPLACE')
stages.append({'name':key.name,'moved_vertices':int(np.count_nonzero(np.linalg.norm(delta,axis=1)>1e-6)),
               'max_displacement_mm':float(np.linalg.norm(delta,axis=1).max()*1000),
               'method':'Outward skin only, clearance to explicit eye volume'})

head['editing_method']='Named cage vertex pins, smooth spline displacement, reversible per-region shape keys'
head['art_status']='rejected_by_user'
head['art_review']='review/art-review.json'
head['reference']='../references/qinglan-face-target.png'
sub=head.modifiers.new('Preview_Subdivision_Not_Base_Topology','SUBSURF');sub.levels=2;sub.render_levels=2
head.show_wire=False
for ob in bpy.data.objects:ob.select_set(False)
head.select_set(True);bpy.context.view_layer.objects.active=head
head.active_shape_key_index=len(head.data.shape_keys.key_blocks)-1
head.use_shape_key_edit_mode=True
skill=Path(os.environ.get('BLENDER_SKILLS_ROOT',r'D:\tmp\estella-blender-skills-20261028'))/'skills'
sys.path.insert(0,str(skill/'blender-facial-shapekeys/scripts'))
import shapekeys
report=shapekeys.run(mesh=head.name,report=True)
(ROOT/'review/shapekey-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
for r in records:
    r['final']=current[r['cage_vertex']].tolist()
    r['final_target_distance_mm']=float(np.linalg.norm(current[r['cage_vertex']]-r['target'])*1000)
(ROOT/'landmark-pins.json').write_text(json.dumps({'reference_scale_mm_per_px':.432,
  'interpretation':'Pins are edit controls; numerical pin residual is not a likeness score. Later regional edits can move previous pins.',
  'stages':stages,'pins':records},indent=2),encoding='utf-8')
(ROOT/'fitted-cage.json').write_text(json.dumps(current.tolist(),separators=(',',':')),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qinglan-face-cage.blend'),compress=True)
print('FIT_STAGES '+json.dumps(stages),flush=True)
