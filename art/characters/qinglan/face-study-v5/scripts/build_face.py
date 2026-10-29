"""Local, reversible face refinement on Blender Studio's CC0 female base.

The artist-authored Multires surface is retained. The body is protected and
masked after Multires; this avoids discarding sculpt detail when isolating a head.
"""
import bpy, sys, json, math, hashlib, os
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(os.environ.get('BLENDER_HUMAN_BASE_BUNDLE','D:/tmp/blender-human-base-v1.4.1/source/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend'))
SKILLS=Path(os.environ.get('SCENARIO_SKILLS_ROOT',str(Path.home()/'.codex/skills')))
sys.path += [str(SKILLS/'scenario-blender-expert/scripts'),str(SKILLS/'scenario-blender-sculpting/scripts'),str(SKILLS/'scenario-blender-retopology/scripts')]
import bx_sculpt as S, bx_review
(ROOT/'review').mkdir(exist_ok=True,parents=True)
for ob in list(bpy.data.objects):bpy.data.objects.remove(ob,do_unlink=True)
with bpy.data.libraries.load(str(SOURCE),link=False) as (src,dst):
    dst.objects=['GEO-body_female_realistic','GEO-body_female_realistic.eye.L','GEO-body_female_realistic.eye.R']
objs=dst.objects
for ob in objs:
    bpy.context.scene.collection.objects.link(ob);ob.hide_set(False);ob.hide_viewport=False;ob.hide_render=False
bpy.context.view_layer.update()
worlds=[ob.matrix_world.copy() for ob in objs];offset=worlds[0].translation.copy()
for ob,mw in zip(objs,worlds):
    ob.parent=None;ob.matrix_world=Matrix.Translation(-offset)@mw;ob.animation_data_clear()
head=objs[0];head.name='Qinglan_Head_Multires'
head['source_author']='Dan Ulrich / Blender Studio Human Base Meshes v1.4.1'
head['source_license']='CC0-1.0'
head['source_file_sha256']=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
head['art_status']='Face identity candidate, not production approval'
base=np.array([v.co[:] for v in head.data.vertices]);current=base.copy()
stages=[];deltas=[]

def local(name,hint,radius,delta=None,scale=None,depth_protection=None):
    global current
    head.data.vertices.foreach_set('co',current.astype(np.float32).ravel());head.data.update()
    sc=S.Sculptor(head,symmetry_x=hint[0]!=0)
    before=sc.co.copy();protected=before[:,2]<1.39
    transition=np.clip((before[:,2]-1.39)/.020,0,1)
    sc.mask=1-transition*transition*(3-2*transition)
    center=sc.on_surface(hint,(0,1,0))
    if delta is not None:sc.grab(center,radius,delta)
    else:sc.move_feature(center,radius,scale=scale,pivot=center,blur=2)
    current=sc.co.copy();change=current-before
    if depth_protection is not None:
        full,stop=depth_protection
        weight=np.clip((stop-base[:,1])/(stop-full),0,1)
        weight=weight*weight*(3-2*weight)
        change*=weight[:,None];current=before+change
    length=np.linalg.norm(change,axis=1)
    assert float(length[protected].max(initial=0))==0
    stages.append({'name':name,'center':center.tolist(),'radius_m':radius,
                   'delta':delta,'scale':scale,'depth_protection':depth_protection,
                   'affected_vertices':int((length>1e-9).sum()),
                   'unchanged_vertices':int((length<=1e-9).sum()),
                   'protected_vertices':int(protected.sum()),'protected_delta_mm':0,
                   'max_delta_mm':float(length.max()*1000)})
    deltas.append((name,change))

def shorten_lower_face():
    global current
    head.data.vertices.foreach_set('co',current.astype(np.float32).ravel());head.data.update()
    sc=S.Sculptor(head,symmetry_x=False);before=sc.co.copy()
    def smooth(t):
        t=np.clip(t,0,1);return t*t*(3-2*t)
    influence=smooth((before[:,2]-1.390)/.030)*smooth((1.470-before[:,2])/.008)
    influence*=smooth((-.035-before[:,1])/.060)
    sc.mask=1-influence
    sc.move_feature((0,-.11,1.445),.18,scale=(1,1,.72),pivot=(0,-.11,1.468),falloff='constant',blur=0)
    current=sc.co.copy();change=current-before;length=np.linalg.norm(change,axis=1)
    protected=influence==0;assert float(length[protected].max(initial=0))==0
    name='10_Lower_face_proportion'
    stages.append({'name':name,'method':'Masked lower-jaw scale about the mouth; compact band',
                   'scale':[1,1,.72],'affected_vertices':int((length>1e-9).sum()),
                   'unchanged_vertices':int((length<=1e-9).sum()),'protected_vertices':int(protected.sum()),
                   'protected_delta_mm':0,'max_delta_mm':float(length.max()*1000)})
    deltas.append((name,change))

# Neutral adult female reference: softer brow, delicate alae, restrained lips,
# tapered lower face; source orbital and nasolabial anatomy stays continuous.
local('01_Soften_brow',(.016,-.3,1.548),.024,delta=(0,.0018,-.0005))
local('02_Nose_width',(0,-.3,1.498),.026,scale=(.78,1,1))
local('03_Nose_projection',(0,-.3,1.504),.022,delta=(0,.0022,0))
local('04_Mouth_width',(0,-.3,1.470),.030,scale=(.91,1,1))
local('05_Lip_projection',(0,-.3,1.468),.021,delta=(0,.0012,0))
local('06_Jaw_taper',(.057,-.3,1.464),.043,delta=(-.0036,0,0))
local('07_Chin_width',(0,-.3,1.445),.035,scale=(.85,1,1))
local('08_Cheek_softness',(.042,-.3,1.501),.032,delta=(0,-.0015,0))
local('09_Eye_aperture',(.033,-.3,1.535),.026,scale=(1.23,1,1.08),depth_protection=(-.123,-.108))
shorten_lower_face()
local('11_Nasal_tip',(0,-.3,1.505),.024,delta=(0,0,-.0055))

head.data.vertices.foreach_set('co',base.astype(np.float32).ravel());head.data.update()
head.shape_key_add(name='Basis_Studio_Female',from_mix=False)
for name,change in deltas:S.write_shape_key(head,name,base+change,value=1)
sid=head.data.attributes.new('source_vertex_id','INT','POINT')
sid.data.foreach_set('value',np.arange(len(base),dtype=np.int32))
group=head.vertex_groups.new(name='Head_Display_Only')
group.add([int(i) for i in np.flatnonzero(base[:,2]>1.365)],1,'REPLACE')
mask=head.modifiers.new('Isolate_Head_After_Multires','MASK');mask.vertex_group=group.name
mask.show_in_editmode=True
head['mask_note']='Body topology retained only to preserve original Multires grids; body vertices protected during edits'

# A display-only neck trim after the mask. The open attachment border is kept,
# but its saw-tooth height is flattened without touching source control points.
ng=bpy.data.node_groups.new('Flat_Neck_Attachment_Border','GeometryNodeTree')
ng.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
ng.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
nodes=ng.nodes;links=ng.links
inp=nodes.new('NodeGroupInput');out=nodes.new('NodeGroupOutput')
neighbours=nodes.new('GeometryNodeInputMeshVertexNeighbors')
compare=nodes.new('FunctionNodeCompare');compare.data_type='INT';compare.operation='GREATER_THAN'
links.new(neighbours.outputs['Vertex Count'],compare.inputs['A'])
links.new(neighbours.outputs['Face Count'],compare.inputs['B'])
pos=nodes.new('GeometryNodeInputPosition');xyz=nodes.new('ShaderNodeSeparateXYZ');links.new(pos.outputs[0],xyz.inputs[0])
stats=nodes.new('GeometryNodeAttributeStatistic');stats.data_type='FLOAT';stats.domain='POINT'
links.new(inp.outputs[0],stats.inputs['Geometry']);links.new(compare.outputs['Result'],stats.inputs['Selection'])
links.new(xyz.outputs['Z'],stats.inputs['Attribute'])
combine=nodes.new('ShaderNodeCombineXYZ');links.new(xyz.outputs['X'],combine.inputs['X']);links.new(xyz.outputs['Y'],combine.inputs['Y'])
links.new(stats.outputs['Min'],combine.inputs['Z'])
setpos=nodes.new('GeometryNodeSetPosition');links.new(inp.outputs[0],setpos.inputs['Geometry'])
links.new(compare.outputs['Result'],setpos.inputs['Selection']);links.new(combine.outputs[0],setpos.inputs['Position'])
links.new(setpos.outputs['Geometry'],out.inputs[0])
trim=head.modifiers.new('Flat_Neck_Border','NODES');trim.node_group=ng

# Face study scale: crown at 1.72 m; height/width independently calibrated to the
# working design. These are visual proportion edits, not a calibrated fit.
# The source-space edits above remain in anatomical metres.
normalise=Matrix.Diagonal((1.0,1.02,1.10,1.0))
normalise.translation.z=1.72-1.641334056854248*1.10
for ob in objs:ob.matrix_world=normalise@ob.matrix_world
bpy.context.view_layer.update()

scene=bpy.context.scene
def mat(name,color,roughness=.6):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=roughness
    return m
clay=mat('Neutral_Clay',(.36,.38,.40));white=mat('Sclera',(.65,.64,.62),.28)
iris=mat('Iris',(.030,.021,.014),.3);pupil=mat('Pupil',(.002,.002,.002),.2)
for ob in objs:
    ob.data.materials.clear();ob.data.materials.append(clay if ob==head else white)
    for p in ob.data.polygons:p.material_index=0;p.use_smooth=True

eye_info=[]
for eye in objs[1:]:
    c=eye.matrix_world.translation.copy()
    # Source eyes are a physically sized 24 mm globe. Add only the readable iris.
    p=np.array([tuple(eye.matrix_world@v.co) for v in eye.data.vertices])
    center=(p.min(0)+p.max(0))/2;radii=(p.max(0)-p.min(0))/2
    eye_info.append({'name':eye.name,'center':center.tolist(),'radii':radii.tolist()})
    for label,radius,material,off in [('Iris',.0055,iris,.00005),('Pupil',.0023,pupil,.00010)]:
        verts=[(center[0],center[1]-radii[1]-off,center[2])];faces=[]
        for j in range(1,11):
            r=radius*j/10
            for i in range(80):
                a=math.tau*i/80;dx=r*math.cos(a);dz=r*math.sin(a)
                y=center[1]-radii[1]*math.sqrt(max(0,1-(dx/radii[0])**2-(dz/radii[2])**2))-off
                verts.append((center[0]+dx,y,center[2]+dz))
        for i in range(80):faces.append((0,1+i,1+(i+1)%80))
        for j in range(9):
            for i in range(80):
                a=1+j*80+i;b=1+j*80+(i+1)%80;faces.append((a,a+80,b+80,b))
        me=bpy.data.meshes.new(label);me.from_pydata(verts,[],faces);me.materials.append(material);me.update()
        ob=bpy.data.objects.new(label+('_L' if center[0]>0 else '_R'),me);scene.collection.objects.link(ob)
        for p in me.polygons:p.use_smooth=True

def aim(ob,target):ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
def light(name,loc,energy,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size
    ob=bpy.data.objects.new(name,d);scene.collection.objects.link(ob);ob.location=loc;aim(ob,(0,-.06,1.59))
light('Key',(-.65,-.9,2.45),55,.8);light('Fill',(.65,-.7,1.9),24,.85);light('Rim',(.5,.6,2.2),28,.6)
world=bpy.data.worlds.new('Neutral_Studio');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.32,.34,.37,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.6
scene.render.resolution_x=600;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
cameras={}
for name,direction in [('front',(0,-1,0)),('profile',(-1,0,0)),('threequarter',(.7,-1,0)),('low',(.45,-1,-.25))]:
    cd=bpy.data.cameras.new(name);cd.type='ORTHO' if name in ('front','profile') else 'PERSP'
    cd.ortho_scale=.309;cd.lens=90;cd.sensor_fit='VERTICAL';cd.sensor_height=24
    ob=bpy.data.objects.new('Review_'+name,cd);scene.collection.objects.link(ob)
    target=Vector((0,-.065 if name=='profile' else -.043,1.582));ob.location=target+Vector(direction).normalized()*1.16;aim(ob,target)
    cameras[name]=ob
scene.camera=cameras['threequarter']
ref=bpy.data.images.load(str(ROOT.parent/'references/qinglan-face-target.png'));ref.pack()
for ob in bpy.context.selected_objects:ob.select_set(False)
head.select_set(True);bpy.context.view_layer.objects.active=head
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.clip_start=.001
            space.region_3d.view_location=(0,-.06,1.59)
            space.region_3d.view_distance=.48
            space.region_3d.view_rotation=cameras['threequarter'].rotation_euler.to_quaternion()
            space.shading.type='SOLID';space.shading.color_type='MATERIAL'
bpy.context.view_layer.update()
(ROOT/'review/edit-report.json').write_text(json.dumps({'stages':stages,'eyes':eye_info},indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qinglan-face-candidate.blend'),compress=True)
for name,cam in cameras.items():
    scene.camera=cam;scene.render.filepath=str(ROOT/'review'/(name+'.png'));bpy.ops.render.render(write_still=True)
print('STUDIO_CANDIDATE_READY '+json.dumps({'stages':len(stages),'base_vertices':len(base)}),flush=True)
