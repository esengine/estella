"""Neutral, identically calibrated cameras for the editable head cage.

Run in Blender background. No sculpt operators or desktop interaction.
"""
import bpy, math, sys, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-face-cage.blend'))
scene=bpy.context.scene
head=bpy.data.objects['Qinglan_Face_Cage']

def mat(name,color,rough=.6):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=rough
    return m

clay=mat('Neutral_gray_clay',(.37,.39,.41),.64)
head.data.materials.clear();head.data.materials.append(clay)
for p in head.data.polygons:p.material_index=0

def aim(ob,at):ob.rotation_euler=(Vector(at)-ob.location).to_track_quat('-Z','Y').to_euler()

def light(name,location,energy,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=location
    aim(ob,(0,-.03,1.59))
light('Key',(-.65,-.9,2.45),55,.7)
light('Fill',(.6,-.6,1.85),14,.7)
light('Rim',(.5,.6,2.2),35,.6)
world=bpy.data.worlds.new('Neutral_studio');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.35,.37,.4,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.32
scene.world=world
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX';prefs.get_devices()
    for device in prefs.devices:device.use=device.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception as exc:print('GPU fallback:',exc)
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.65
scene.render.resolution_x=592;scene.render.resolution_y=828;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.color_depth='8'
scene.render.fps=24

def camera(name,location,target,scale=.357696):
    d=bpy.data.cameras.new(name);d.type='ORTHO';d.ortho_scale=scale;d.lens=85
    ob=bpy.data.objects.new(name,d);scene.collection.objects.link(ob);ob.location=location;aim(ob,target)
    return ob

z=1.577064
cameras={
 'front':camera('Review_Front',(.003672,-3,z),(.003672,0,z)),
 'profile':camera('Review_Profile',(-3,-.051136,z),(0,-.051136,z)),
 'three-quarter':camera('Review_ThreeQuarter',(1.65,-3,z),(0,-.025,z)),
}
theta=math.radians(15)
target=Vector((math.sin(theta)*.045684,-math.cos(theta)*.045684,z))
cameras['reference-side']=camera('Review_ReferenceSide_75deg',target+Vector((-math.cos(theta)*3,-math.sin(theta)*3,0)),target)
cameras['reference-side']['reference_camera_assumption']='Approximately 75 degrees from front; reference side view is not a true profile. Same scale/height as front.'
eyes=bpy.data.collections.new('Eye_volume_checks');scene.collection.children.link(eyes)
eye_mat=mat('Eyes_neutral',(.58,.59,.60),.4)
iris_mat=mat('Iris_neutral',(.035,.038,.042),.38)
pupil_mat=mat('Pupil',(.004,.004,.004),.28)
for s in [-1,1]:
    center=(s*.040,-.110,1.598)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=40,location=center)
    eye=bpy.context.object;eye.name='Eye_volume_L' if s<0 else 'Eye_volume_R'
    eye.scale=(.022,.0195,.0155)
    for c in list(eye.users_collection):c.objects.unlink(eye)
    eyes.objects.link(eye);eye.data.materials.append(eye_mat)
    for p in eye.data.polygons:p.use_smooth=True
    # Front spherical patch, used only to make gaze readable, never for fitting.
    for name,radius,material,advance in [('Iris',.0078,iris_mat,.00008),('Pupil',.0031,pupil_mat,.00015)]:
        verts=[(center[0],center[1]-.0195-advance,center[2])];faces=[]
        for j in range(1,9):
            r=radius*j/8
            for i in range(64):
                a=2*math.pi*i/64;dx=r*math.cos(a);dz=r*math.sin(a)
                y=center[1]-.0195*math.sqrt(max(0,1-(dx/.022)**2-(dz/.0155)**2))-advance
                verts.append((center[0]+dx,y,center[2]+dz))
        for i in range(64):faces.append((0,1+(i+1)%64,1+i))
        for j in range(7):
            for i in range(64):
                a=1+j*64+i;b=1+j*64+(i+1)%64
                faces.append((a,b,b+64,a+64))
        me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.materials.append(material);me.update()
        ob=bpy.data.objects.new(name+('_L' if s<0 else '_R'),me);eyes.objects.link(ob)
        for p in me.polygons:p.use_smooth=True
eyes.hide_render=False

# Retain the visual reference inside the editable project, without rendering it.
ref=bpy.data.images.load(str(ROOT.parent/'references/qinglan-face-target.png'),check_existing=True);ref.pack()
refob=bpy.data.objects.new('Reference_sheet_not_geometry',None);scene.collection.objects.link(refob)
refob.empty_display_type='IMAGE';refob.data=ref;refob.empty_display_size=.767
refob.location=(.26,.10,1.58);refob.rotation_euler=(math.pi/2,0,0)
refob.hide_render=True;refob.hide_set(True)

scene.camera=cameras['three-quarter']
for ob in bpy.context.selected_objects:ob.select_set(False)
head.select_set(True);bpy.context.view_layer.objects.active=head
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qinglan-face-study.blend'),compress=True)

mode=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
views=['front','profile','three-quarter','reference-side']
eyes.hide_render=True
for state in ['after','before'] if 'all' in mode else ['after']:
    for key in list(head.data.shape_keys.key_blocks)[1:]:key.value=1 if state=='after' else 0
    for view in views:
        scene.camera=cameras[view]
        scene.render.filepath=str(ROOT/'review'/f'{state}-{view}-clay.png')
        bpy.ops.render.render(write_still=True)
if 'eyes' in mode:
    for key in list(head.data.shape_keys.key_blocks)[1:]:key.value=1
    eyes.hide_render=False
    for view in views:
        scene.camera=cameras[view]
        scene.render.filepath=str(ROOT/'review'/f'after-{view}-eyes.png')
        bpy.ops.render.render(write_still=True)
print('HEAD_REVIEW_RENDERED',flush=True)
