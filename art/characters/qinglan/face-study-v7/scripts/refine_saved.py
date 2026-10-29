"""Continue reversible control-mesh work on the recovered saved candidate."""
import bpy,sys,json,math
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage'];keys=head.data.shape_keys.key_blocks
next(m for m in head.modifiers if m.type=='MULTIRES').levels=0
for name in ('V7_07_Ear_Proportion','V7_08_Nose_Profile','V7_09_Upper_Lip'):
    if name in keys:keys[name].value=0
reports=[]
current=I.world_coords(head,I.mixed_coords(head,exclude_prefix='NONE'))
new=current.copy();x=np.abs(current[:,0]);z=current[:,2];y=current[:,1]
# Ears in the reference sit above the nasal base; the source ears are low.
weight=I.smooth((x-.062)/.016)*I.band(z,1.505,1.535,1.610,1.636)*I.smooth((y+.085)/.030)
new[:,2]+=(.010-.16*(z-1.574))*weight
new[:,0]-=np.sign(current[:,0])*.0015*weight
reports.append(I.key_delta(head,'V7_07_Ear_Proportion',current,new,{'target':'Raise and shorten low source ears to the reference eye/nose-base band'}))
current=new;new=current.copy();x=np.abs(current[:,0]);z=current[:,2];y=current[:,1]
# Reduce the sharply projecting source tip; the bridge stays anchored.
w=(1-I.smooth((x-.008)/.013))*I.band(z,1.548,1.558,1.572,1.599)*I.smooth((-.145-y)/.012)
new[:,1]+=.0032*w
reports.append(I.key_delta(head,'V7_08_Nose_Profile',current,new,{'target':'Soften projecting nasal tip while preserving bridge and nostril topology'}))
current=new;new=current.copy();x=np.abs(current[:,0]);z=current[:,2];y=current[:,1]
# The raised oral region compressed the upper vermilion. Restore its height
# without opening the mouth seam or shortening the philtrum further.
w=I.band(z,1.5363,1.5395,1.5432,1.5518)*(1-I.smooth((x-.010)/.016))*I.smooth((-.129-y)/.012)
new[:,2]+=.0023*w
new[:,1]-=.0007*w
reports.append(I.key_delta(head,'V7_09_Upper_Lip',current,new,{'target':'Restore upper-lip volume above the raised mouth seam'}))
bpy.context.view_layer.update()
(ROOT/'review/feature-edits.json').write_text(json.dumps(reports,indent=2))
# Reference views are illustrations, not calibrated orthographic views.
# These explicitly labelled long-lens estimates complement fixed ortho views.
cameras=[]
for name,yaw in [('Reference_front',0),('Reference_profile',-72),('Reference_threequarter',25)]:
    ob=bpy.data.objects.get(name)
    if ob is None:
        data=bpy.data.cameras.new(name);ob=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(ob)
    target=Vector((0,-.048,1.582));angle=math.radians(yaw)
    ob.location=target+Vector((math.sin(angle),-math.cos(angle),0))*.79
    ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
    ob.data.type='PERSP';ob.data.lens=90;ob.data.sensor_width=36
    ob.data.clip_start=.001;ob.data.clip_end=20
    ob['calibration']='Approximate yaw and long-lens perspective; reference metadata unavailable'
    cameras.append({'name':name,'yaw_degrees':yaw,'focal_length_mm':90,'distance_m':.79,'calibrated':False})
(ROOT/'review/cameras.json').write_text(json.dumps(cameras,indent=2))
I.save_stage('03-features-and-reference-cameras')
I.save_main()
print('REFINEMENT_SAVED '+json.dumps(reports),flush=True)
