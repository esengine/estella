"""Keep the successful proportion edits; reject cheek patches and opened lips."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage'];keys=head.data.shape_keys.key_blocks
multi=next(m for m in head.modifiers if m.type=='MULTIRES');multi.levels=0
for name in ('V7_05_Cheek_Transition','V7_09_Upper_Lip','V7_10_Oral_Contact','V7_11_Cheek_Plane_Fairing'):
    if name in keys:keys[name].value=0;keys[name].mute=True
keys['V7_03_Jaw_Chin_Taper'].value=.5
multi.levels=2;bpy.context.view_layer.update();I.brow_proxies()
multi.levels=1;multi.render_levels=2;multi.sculpt_levels=1
head['art_status']='Proportion revision for reference review; facial identity not approved'
head['rejected_edits']='Cheek envelope, broad cheek fill, extra upper-lip lift and forced lip opening are muted after visual review'
head['editing_note']='Set Multires viewport level to 0 before scripted control-key changes; restore 1 after update'
for ob in bpy.context.selected_objects:ob.select_set(False)
head.hide_set(False);head.select_set(True);bpy.context.view_layer.objects.active=head
head.active_shape_key_index=keys.find('V7_01_Mouth_Height')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.clip_start=.001
            space.region_3d.view_location=(0,-.055,1.585);space.region_3d.view_distance=.46
            space.overlay.show_overlays=False
scene=bpy.context.scene;scene.camera=bpy.data.objects['Review_threequarter']
camera=bpy.data.objects['Reference_profile'];target=Vector((0,-.074,1.582));angle=math.radians(-72)
camera.location=target+Vector((math.sin(angle),-math.cos(angle),0))*.86
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera_report=[]
for ob in bpy.data.objects:
    if ob.type=='CAMERA':camera_report.append({'name':ob.name,'type':ob.data.type,'lens_mm':ob.data.lens,'ortho_scale':ob.data.ortho_scale,'location':list(ob.location),'rotation_euler':list(ob.rotation_euler),'calibrated':False})
(ROOT/'review/cameras.json').write_text(json.dumps(camera_report,indent=2))
(ROOT/'review/accepted-key-values.json').write_text(json.dumps([{'name':k.name,'value':k.value,'muted':k.mute} for k in keys],indent=2))
I.save_stage('06-reviewed-proportions');I.save_main()
print('REVIEW_CANDIDATE_SAVED',flush=True)
