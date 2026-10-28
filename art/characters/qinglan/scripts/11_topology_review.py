"""Render actual base-mesh edges at a scale suitable for human face topology."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-human-study.blend'))
body=bpy.data.objects['QL01_Complete_Human_Study']
for ob in bpy.data.objects:
    if ob.type in {'MESH','CURVE'} and ob!=body and ob.name!='StudioFloor':ob.hide_render=True
for mod in body.modifiers:
    mod.show_render=False;mod.show_viewport=False
clay=material('M_Topology_Clay',(.63,.69,.70),.8)
body.data.materials.clear();body.data.materials.append(clay)
for p in body.data.polygons:p.material_index=0
ink=material('M_Topology_Lines',(.035,.085,.09),.8)
data=bpy.data.curves.new('Base_Topology_Edges','CURVE');data.dimensions='3D';data.resolution_u=1
data.bevel_depth=.00014;data.bevel_resolution=0
body.data.update()
for edge in body.data.edges:
    spline=data.splines.new('POLY');spline.points.add(1)
    for point,idx in zip(spline.points,edge.vertices):
        v=body.data.vertices[idx];p=v.co+v.normal*.00020;point.co=(*p,1)
wire=bpy.data.objects.new('Base_Topology_Edges',data);bpy.context.scene.collection.objects.link(wire);data.materials.append(ink)
sc=bpy.context.scene;sc.view_settings.exposure=-.20
for filename,cam,w,h in [
    ('topology-body-front.png','HUMAN_BODY_Front',900,1300),
    ('topology-face-front.png','HUMAN_HEAD_front',1000,1100),
    ('topology-face-profile.png','HUMAN_HEAD_profile',1000,1100),
    ('topology-face-three-quarter.png','HUMAN_HEAD_three-quarter',1000,1100)]:
    render(bpy.data.objects[cam],ROOT/'review'/filename,w,h,48)
    print('TOPOLOGY '+filename,flush=True)
