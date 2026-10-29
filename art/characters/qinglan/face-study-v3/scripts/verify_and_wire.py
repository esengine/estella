"""Check saved editable geometry and render its actual cage edges."""
import bpy,bmesh,json,sys,os,math
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-face-study.blend'))
head=bpy.data.objects['Qinglan_Face_Cage'];scene=bpy.context.scene
source=json.loads((ROOT/'head-cage.json').read_text())
expected=np.array(json.loads((ROOT/'fitted-cage.json').read_text()))
base=np.array([v['co'] for v in source['vertices']])
keys=head.data.shape_keys.key_blocks
assert np.max(np.abs(np.array([tuple(v.co) for v in keys[0].data])-base))<1e-7
assert [list(p.vertices) for p in head.data.polygons]==source['faces']
assert [int(d.value) for d in head.data.attributes['source_vertex_id'].data]==[v['source_id'] for v in source['vertices']]
assert all(abs(k.value-1)<1e-6 for k in list(keys)[1:])
assert [g.name for g in head.vertex_groups]==[k.name for k in list(keys)[1:]]
assert all(g.group<len(head.vertex_groups) for v in head.data.vertices for g in v.groups)

sub=head.modifiers.get('Preview_Subdivision_Not_Base_Topology')
sub.show_viewport=False;sub.show_render=False
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get();ev=head.evaluated_get(dg)
me=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=dg)
actual=np.array([tuple(v.co) for v in me.vertices])
assert np.max(np.abs(actual-expected))<1e-6
bm=bmesh.new();bm.from_mesh(me);bm.normal_update()
boundary=[e for e in bm.edges if e.is_boundary]
boundary_z=[v.co.z for e in boundary for v in e.verts]
assert all(abs(z-1.435)<1e-5 for z in boundary_z),'Unexpected head boundary outside neck cut'
assert all(math.isfinite(a) for co in actual for a in co)
assert not any(len(e.link_faces)>2 for e in bm.edges)
assert not any(f.calc_area()<1e-12 for f in bm.faces)
edges=[tuple(e.vertices) for e in me.edges]
normals=np.array([tuple(v.normal) for v in me.vertices])
bm.free()

# QA runs on the fitted base cage, not the undeformed Basis or a dense render.
qa_ob=bpy.data.objects.new('QA_Fitted_Cage',me);scene.collection.objects.link(qa_ob)
skill=Path(os.environ.get('BLENDER_SKILLS_ROOT',r'D:\tmp\estella-blender-skills-20261028'))/'skills'
sys.path.insert(0,str(skill/'blender-asset-qa/scripts'))
import qa_check
qa=qa_check.run(objects=[qa_ob.name],profile='render',eps=.00002,tol=.0001,no_modifiers=True,uv=False)
(ROOT/'review/mesh-qa.json').write_text(json.dumps(qa,indent=2),encoding='utf-8')
bpy.data.objects.remove(qa_ob,do_unlink=True)
assert qa['pass'],json.dumps(qa['errors'])

report={'scope':'Static editable face study, not rig/game acceptance',
 'vertices':len(actual),'edges':len(edges),'faces':len(head.data.polygons),
 'triangles':sum(len(p.vertices)-2 for p in head.data.polygons),
 'quad_faces':sum(len(p.vertices)==4 for p in head.data.polygons),
 'source_vertex_ids_preserved':True,'topology_preserved':True,'basis_preserved':True,
 'shape_keys':[k.name for k in keys],
 'saved_mix_matches_fitted_cage_max_error_m':float(np.max(np.abs(actual-expected))),
 'boundary_edges':len(boundary),'boundary_description':'Intentional open neck cut, all at z=1.435m',
 'nonfinite_coordinates':0,'degenerate_faces_below_1e12_m2':0,'edges_over_two_faces':0,
 'blender_skills_qa_pass':qa['pass'],
 'camera_calibration':{'resolution':[592,828],'ortho_scale_m':.357696,'mm_per_pixel':.432,
   'reference_side_degrees_from_front':75,'true_profile_degrees':90},
 'not_verified':['Final likeness approval','Eyelid deformation/blinking','Mouth expressions','Production skin and hair','Engine integration']}
(ROOT/'review/verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

# Each spline is an existing cage edge, not an invented grid or wire shader.
wire_col=bpy.data.collections.new('Review_Actual_Cage_Edges');scene.collection.children.link(wire_col)
data=bpy.data.curves.new('Original_edge_connectivity','CURVE');data.dimensions='3D'
data.bevel_depth=.000065;data.bevel_resolution=0;data.resolution_u=1
coords=actual+normals*.00013
for a,b in edges:
    sp=data.splines.new('POLY');sp.points.add(1)
    sp.points[0].co=(*coords[a],1);sp.points[1].co=(*coords[b],1)
wire=bpy.data.objects.new('Cage_edges',data);wire_col.objects.link(wire)
material=bpy.data.materials.new('Cage_edge_ink');material.use_nodes=True
bs=material.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.012,.022,.027,1)
bs.inputs['Roughness'].default_value=.8;data.materials.append(material)
eyes=bpy.data.collections['Eye_volume_checks'];eyes.hide_render=True
scene.cycles.samples=48
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception:pass
for view,camname in [('front','Review_Front'),('profile','Review_Profile'),('three-quarter','Review_ThreeQuarter')]:
    scene.camera=bpy.data.objects[camname]
    scene.render.filepath=str(ROOT/'review'/f'cage-{view}-wire.png')
    bpy.ops.render.render(write_still=True)

wire_col.hide_render=True;wire_col.hide_viewport=True
sub.show_viewport=True;sub.show_render=True;eyes.hide_render=False
scene.camera=bpy.data.objects['Review_ThreeQuarter']
for ob in bpy.context.selected_objects:ob.select_set(False)
head.select_set(True);bpy.context.view_layer.objects.active=head
head['status']='Editable face study; remaining likeness differences documented in README'
scene['review_method']='Neutral clay plus actual base-cage edge renders, fixed reference projections'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.clip_start=.001
            space.region_3d.view_location=(0,-.025,1.60);space.region_3d.view_distance=.42
            space.region_3d.view_rotation=scene.camera.rotation_euler.to_quaternion()
            space.shading.type='SOLID';space.shading.color_type='MATERIAL'
bpy.data.meshes.remove(me)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qinglan-face-study.blend'),compress=True)
print('HEAD_VERIFICATION '+json.dumps(report),flush=True)
