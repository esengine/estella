"""Reference-led edits on the original face control cage in the live session.

Each edit has compact anatomical bounds and its own relative shape key. The
original topology and Multires grids stay intact; no global landmark warp.
"""
import bpy,json,sys
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parents[3]/'output/qinglan/identity-v7'
for path in (ROOT/'review',OUT):path.mkdir(parents=True,exist_ok=True)
SKILLS=Path.home()/'.codex/skills'
sys.path.append(str(SKILLS/'scenario-blender-expert/scripts'))
import bx_gui as G

def coords(data):
    a=np.empty(len(data)*3,dtype=np.float64)
    data.foreach_get('co',a)
    return a.reshape(-1,3)

def smooth(t):
    t=np.clip(t,0,1);return t*t*(3-2*t)

def band(z,a,b,c,d):
    return smooth((z-a)/(b-a))*smooth((d-z)/(d-c))

def piecewise(x,xp,yp):
    out=np.full_like(x,yp[0],dtype=float)
    for i in range(len(xp)-1):
        t=smooth((x-xp[i])/(xp[i+1]-xp[i]))
        out+=(yp[i+1]-yp[i])*t
    return out

def world_coords(ob,co):
    m=np.array(ob.matrix_world)
    return co@m[:3,:3].T+m[:3,3]

def local_coords(ob,co):
    m=np.array(ob.matrix_world.inverted())
    return co@m[:3,:3].T+m[:3,3]

def mixed_coords(ob,exclude_prefix='V7_'):
    keys=ob.data.shape_keys.key_blocks
    base=coords(keys[0].data);out=base.copy()
    for k in list(keys)[1:]:
        if not k.name.startswith(exclude_prefix) and not k.mute:out+=(coords(k.data)-base)*k.value
    return out

def prepare():
    assert bpy.data.filepath.endswith(('qinglan-live-face.blend','qinglan-identity-cage.blend'))
    source=bpy.data.objects['Qinglan_Head_Multires']
    head=bpy.data.objects.get('Qinglan_Identity_Cage')
    if head is None:
        head=source.copy();head.data=source.data.copy();head.name='Qinglan_Identity_Cage'
        bpy.context.scene.collection.objects.link(head)
    for name in ('Qinglan_Head_Multires','Qinglan_Live_Sculpt'):
        ob=bpy.data.objects.get(name)
        if ob:ob.hide_render=True;ob.hide_set(True)
    head.hide_render=False;head.hide_set(False)
    multi=next(m for m in head.modifiers if m.type=='MULTIRES')
    multi.levels=1;multi.render_levels=2;multi.sculpt_levels=1
    head['editing_stage']='Reference identity at control-cage resolution'
    head['source']='V5 original quad topology and Multires, with all original keys retained'
    head['protected_body']='All new shape-key deltas below world Z 1.47 m are zero'
    for ob in bpy.context.selected_objects:ob.select_set(False)
    head.select_set(True);bpy.context.view_layer.objects.active=head
    G.set_view('FRONT')
    w,a,r,v=G.view3d();v.view_location=(0,-.055,1.585);v.view_distance=.46;v.update()
    a.spaces.active.overlay.show_overlays=False
    return head

def eye_field(p,outer=.0055,inner=-.0010,tilt=.0020):
    out=p.copy();u=np.abs(p[:,0]);z=p[:,2]
    wz=band(z,1.576,1.590,1.617,1.638)
    # The inner orbital return has pre-existing touching faces. Keep that
    # return fixed; only deform the visible lid and the forward globe surface.
    front=smooth((-.116-p[:,1])/.012)
    dx=piecewise(u,[0,.008,.020,.0329,.045,.074],[0,0,inner,0,outer,0])
    out[:,0]+=np.sign(p[:,0])*dx*wz*front
    orbital=band(u,.010,.020,.050,.069)*front
    tilt_weight=band(z,1.582,1.591,1.614,1.631)
    out[:,2]+=tilt*np.clip((u-.0329)/.018,-1,1)*orbital*tilt_weight
    upper=band(z,1.601,1.607,1.611,1.630)
    lower=band(z,1.579,1.592,1.598,1.602)
    mid=band(u,.014,.026,.040,.058)*front
    out[:,2]+=(-.0011*upper+.00045*lower)*mid
    return out

def key_delta(ob,name,current,new,stage):
    keys=ob.data.shape_keys.key_blocks;base=coords(keys[0].data)
    delta=local_coords(ob,new)-local_coords(ob,current)
    key=keys.get(name) or ob.shape_key_add(name=name)
    key.data.foreach_set('co',(base+delta).astype(np.float32).ravel())
    key.value=0;key.value=1;ob.data.update()
    length=np.linalg.norm(new-current,axis=1)
    assert np.max(length[current[:,2]<1.47],initial=0)==0
    stage.update({'key':name,'moved_control_vertices':int((length>1e-8).sum()),
                  'max_displacement_mm':float(length.max()*1000),'protected_body_delta_m':0})
    return stage

def secondary_volume(cheek_fill=.006,jaw_relax=.35):
    head=bpy.data.objects['Qinglan_Identity_Cage'];keys=head.data.shape_keys.key_blocks
    names=('V7_05_Cheek_Transition','V7_06_Chin_Roundness')
    for name in names:
        if name in keys:keys[name].value=0
    current=world_coords(head,mixed_coords(head,exclude_prefix='NONE'));new=current.copy()
    u=np.abs(current[:,0]);z=current[:,2];y=current[:,1]
    # Restore the soft tissue beneath the zygoma after the silhouette taper.
    # Compact support excludes the lips, eyelids, ear canal and neck.
    weight=band(u,.026,.043,.062,.082)*band(z,1.505,1.537,1.555,1.584)*smooth((-.025-y)/.050)
    new[:,1]-=cheek_fill*weight
    # Local fairing of cheek depth. X and Z remain the approved proportions.
    edges=np.array([e.vertices[:] for e in head.data.edges]);a=edges[:,0];b=edges[:,1]
    degree=np.bincount(edges.ravel(),minlength=len(current))
    for _ in range(6):
        sums=np.bincount(a,weights=new[b,1],minlength=len(current))+np.bincount(b,weights=new[a,1],minlength=len(current))
        mean=sums/np.maximum(degree,1)
        new[:,1]+=(mean-new[:,1])*weight*jaw_relax
    reports=[key_delta(head,names[0],current,new,{'target':'Restore cheek fullness and fair cheek-to-jaw depth','cheek_fill_m':cheek_fill,'relax_iterations':6})]
    current=new;new=current.copy();u=np.abs(current[:,0]);z=current[:,2]
    w=band(z,1.472,1.488,1.505,1.525)*smooth((-.025-current[:,1])/.050)
    w*=1-smooth((u-.028)/.025)
    new[:,2]+=.0032*np.clip(u/.030,0,1)**2*w
    reports.append(key_delta(head,names[1],current,new,{'target':'Round the blunt chin edge while holding the central chin anchor'}))
    bpy.context.view_layer.update()
    (ROOT/'review/secondary-edits.json').write_text(json.dumps(reports,indent=2))
    print(json.dumps(reports))

def rebuild(mouth_lift=.0085,mouth_width=.90,outer_eye=.0055,inner_eye=-.0010,eye_tilt=.0020,jaw_strength=1.0):
    head=bpy.data.objects['Qinglan_Identity_Cage'];keys=head.data.shape_keys.key_blocks
    next(m for m in head.modifiers if m.type=='MULTIRES').levels=0
    for k in keys:
        if k.name.startswith('V7_'):k.value=0
    current=world_coords(head,mixed_coords(head));stages=[]
    # Nose base and chin are stationary anchors. The whole mouth region,
    # including its internal seam, follows a smooth monotonic vertical field.
    new=current.copy();z=current[:,2];u=np.abs(current[:,0])
    w=band(z,1.489,1.520,1.535,1.556)
    w*=smooth((-.035-current[:,1])/.035)*(1-smooth((u-.045)/.030))
    new[:,2]+=mouth_lift*w
    stages.append(key_delta(head,'V7_01_Mouth_Height',current,new,{'target':'Raise oral region toward reference lip-line height','target_lift_m':mouth_lift}))
    current=new
    new=current.copy();u=np.abs(current[:,0]);z=current[:,2]
    w=band(z,1.511,1.528,1.544,1.563)*smooth((-.055-current[:,1])/.035)
    w*=1-smooth((u-.030)/.024)
    new[:,0]*=1-(1-mouth_width)*w
    stages.append(key_delta(head,'V7_02_Mouth_Width',current,new,{'target':'Compact lip outline','central_width_scale':mouth_width}))
    current=new
    # Taper jaw outside the oral rings; avoid multiplying the mouth-width edit.
    new=current.copy();u=np.abs(current[:,0]);z=current[:,2]
    amount=piecewise(z,[1.474,1.490,1.508,1.536,1.555,1.576,1.602],[0,.10,.17,.16,.10,.035,0])*jaw_strength
    outer=smooth((u-.026)/.023)
    chin=1-smooth((z-1.510)/.016)
    shape=np.maximum(outer,chin)
    front=smooth((.015-current[:,1])/.035)
    new[:,0]*=1-amount*shape*front
    stages.append(key_delta(head,'V7_03_Jaw_Chin_Taper',current,new,{'target':'Oval lower-face contour; oral rings protected from jaw taper','strength':jaw_strength}))
    current=new
    new=eye_field(current,outer=outer_eye,inner=inner_eye,tilt=eye_tilt)
    stages.append(key_delta(head,'V7_04_Orbital_Proportion',current,new,{'target':'Wider almond-shaped aperture with coordinated lid tilt','outer_canthal_target_m':outer_eye,'inner_canthal_target_m':inner_eye,'tilt_m':eye_tilt}))
    head.active_shape_key_index=len(keys)-1
    bpy.context.view_layer.update()
    (ROOT/'review/control-edits.json').write_text(json.dumps(stages,indent=2))
    print(json.dumps({'stages':stages,'total_control_vertices':len(current)}))

def fit_globes(outer_eye=.0055,inner_eye=-.0010,eye_tilt=.0020):
    report=[]
    for side in ('L','R'):
        ob=bpy.data.objects['GEO-body_female_realistic.eye.'+side]
        keys=ob.data.shape_keys.key_blocks
        for k in keys:
            if k.name.startswith('V7_'):k.value=0
        old_local=mixed_coords(ob);old=world_coords(ob,old_local);new=eye_field(old,outer=outer_eye,inner=inner_eye,tilt=eye_tilt)
        key=keys.get('V7_Orbital_Fit') or ob.shape_key_add(name='V7_Orbital_Fit')
        key.data.foreach_set('co',(coords(keys[0].data)+local_coords(ob,new)-old_local).astype(np.float32).ravel())
        key.value=0;key.value=1;ob.data.update()
        report.append({'side':side,'method':'Same spatial deformation as orbital control region','max_delta_mm':float(np.linalg.norm(new-old,axis=1).max()*1000)})
    bpy.context.view_layer.update()
    (ROOT/'review/globe-fit.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

def fit_irises(iris_radius=.0066,pupil_radius=.0017):
    report=[]
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    for side in ('L','R'):
        globe=bpy.data.objects['GEO-body_female_realistic.eye.'+side]
        ev=globe.evaluated_get(dg);inv=globe.matrix_world.inverted()
        for prefix,radius,offset in (('Iris_',iris_radius,.00006),('Pupil_',pupil_radius,.00012)):
            ob=bpy.data.objects[prefix+side];keys=ob.data.shape_keys.key_blocks
            for k in keys:
                if k.name.startswith('V7_'):k.value=0
            old_local=mixed_coords(ob);old=world_coords(ob,old_local)
            center=old[0].copy();xz=old[:,[0,2]]-center[[0,2]]
            old_radius=np.linalg.norm(xz,axis=1).max()
            xz*=radius/old_radius
            target=old.copy();target[:,[0,2]]=xz+center[[0,2]]
            for i,p in enumerate(target):
                origin=inv@Vector((p[0],-.4,p[2]))
                direction=(inv.to_3x3()@Vector((0,1,0))).normalized()
                hit,q,n,index=ev.ray_cast(origin,direction)
                if not hit:raise RuntimeError('Iris projection missed eye globe')
                target[i,1]=(globe.matrix_world@q).y-offset
            key=keys.get('V7_Iris_Fit') or ob.shape_key_add(name='V7_Iris_Fit')
            key.data.foreach_set('co',(coords(keys[0].data)+local_coords(ob,target)-old_local).astype(np.float32).ravel())
            key.value=1;ob.data.update()
            report.append({'object':ob.name,'radius_m':radius,'surface_offset_m':offset,'ray_misses':0})
    bpy.context.view_layer.update()
    (ROOT/'review/iris-fit.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

def brow_proxies():
    head=bpy.data.objects['Qinglan_Identity_Cage']
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();ev=head.evaluated_get(dg)
    inv=head.matrix_world.inverted()
    mat=bpy.data.materials.get('Qinglan_Brow_Blockout') or bpy.data.materials.new('Qinglan_Brow_Blockout')
    mat.diffuse_color=(.045,.034,.027,1);mat.use_nodes=True
    bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if bs is None:
        bs=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output=next((n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL'),None) or mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(bs.outputs['BSDF'],output.inputs['Surface'])
    bs.inputs['Base Color'].default_value=(.045,.034,.027,1);bs.inputs['Roughness'].default_value=.75
    controls=np.array([[.0135,1.6140,.0011],[.025,1.6188,.0019],[.039,1.6203,.0020],[.050,1.6187,.0013],[.057,1.6157,.00008]])
    slopes=np.gradient(controls[:,1:],controls[:,0],axis=0)
    for side in (-1,1):
        name='Qinglan_Brow_Proxy_'+('L' if side>0 else 'R')
        old=bpy.data.objects.get(name)
        if old:bpy.data.objects.remove(old,do_unlink=True)
        verts=[];faces=[]
        for i in range(65):
            x=controls[0,0]+i/64*(controls[-1,0]-controls[0,0])
            seg=min(max(np.searchsorted(controls[:,0],x)-1,0),len(controls)-2)
            dx=controls[seg+1,0]-controls[seg,0];t=(x-controls[seg,0])/dx
            z,width=(2*t**3-3*t*t+1)*controls[seg,1:]+(t**3-2*t*t+t)*dx*slopes[seg]+(-2*t**3+3*t*t)*controls[seg+1,1:]+(t**3-t*t)*dx*slopes[seg+1]
            for j in range(5):
                zz=z+(j/4*2-1)*width
                origin=inv@Vector((side*x,-.4,zz));direction=(inv.to_3x3()@Vector((0,1,0))).normalized()
                hit,p,n,index=ev.ray_cast(origin,direction)
                if not hit:raise RuntimeError('Brow ray missed the face')
                q=head.matrix_world@p;q.y-=.00022;verts.append(q)
        for i in range(64):
            for j in range(4):
                a=i*5+j;face=(a,a+5,a+6,a+1);faces.append(face if side>0 else tuple(reversed(face)))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(mat);mesh.update()
        ob=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(ob)
        ob['purpose']='Temporary brow silhouette for identity review, not final hair'
        for p in mesh.polygons:p.use_smooth=True
    print('BROW_PROXIES_READY')

def save_stage(label):
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(label+'.blend')),copy=True,compress=True)

def save_main():
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'),compress=True)

