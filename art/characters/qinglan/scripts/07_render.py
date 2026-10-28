"""Fixed-view high-poly review renders, with no visible application window."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-highpoly.blend'))
sc=bpy.context.scene;sc.cycles.use_denoising=True;sc.cycles.adaptive_threshold=.025
sc.render.use_persistent_data=True
for name,loc in [('CAM_Front',(0,-4,.93)),('CAM_Side',(4,0,.93)),('CAM_Back',(0,4,.93))]:
    cam=bpy.data.objects[name];cam.location=loc
    cam.rotation_euler=(Vector((0,0,.93))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.ortho_scale=2.04
rear=camera('CAM_Rear34',(-2.55,5.8,2.3),(0,0,.94),ortho=2.08)
profile=camera('CAM_Profile',(3,-.04,1.62),(0,-.04,1.62),ortho=.47)
face34=bpy.data.objects['CAM_Face34'];face34.data.type='ORTHO';face34.data.ortho_scale=.47
face34.rotation_euler=(Vector((0,-.03,1.62))-face34.location).to_track_quat('-Z','Y').to_euler()
jobs=[('hero.png','CAM_Hero',1400,1900,128),
      ('front.png','CAM_Front',900,1200,64),
      ('side.png','CAM_Side',900,1200,64),
      ('back.png','CAM_Back',900,1200,64),
      ('rear-three-quarter.png','CAM_Rear34',900,1200,64),
      ('face-front.png','CAM_Face',1100,1200,128),
      ('face-profile.png','CAM_Profile',1000,1100,96),
      ('face-three-quarter.png','CAM_Face34',1100,1200,128)]
for filename,name,w,h,samples in jobs:
    render(bpy.data.objects[name],ROOT/'review'/filename,w,h,samples)
    print('RENDERED '+filename,flush=True)
sc.camera=bpy.data.objects['CAM_Hero'];sc.render.resolution_x=1400;sc.render.resolution_y=1900
sc.render.filepath='//review/hero.png'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.overlay.show_overlays=False
# Persist the complete fixed camera rig for repeatable review.
save(ROOT/'qinglan-highpoly.blend')
