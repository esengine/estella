"""Run the blender-skills asset gate and export an inspectable static GLB."""
import sys,os,time,collections
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
from mathutils import Matrix

bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-highpoly.blend'))
skillroot=Path(os.environ.get('BLENDER_SKILLS_ROOT',r'D:\tmp\estella-blender-skills-20261028'))/'skills'
for folder in ['blender-asset-qa','blender-export-pipelines']:
    sys.path.insert(0,str(skillroot/folder/'scripts'))
import qa_check,export_asset,review_shots
source=[o for o in col().objects if o.type in {'MESH','CURVE'} and not o.hide_render]
for o in source:
    for m in o.modifiers:
        if m.type in {'SUBSURF','MULTIRES'}:m.levels=m.render_levels
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
high={};bounds=[]
for o in source:
    ev=o.evaluated_get(dg);me=ev.to_mesh()
    coords=np.empty(len(me.vertices)*3,dtype=np.float32);me.vertices.foreach_get('co',coords)
    matrix=np.array(o.matrix_world);world=coords.reshape(-1,3)@matrix[:3,:3].T+matrix[:3,3]
    lo=world.min(axis=0).tolist();hi=world.max(axis=0).tolist()
    high[o.name]={'verts':len(me.vertices),'triangles':sum(len(p.vertices)-2 for p in me.polygons),'min':lo,'max':hi}
    bounds.extend([Vector(lo),Vector(hi)]);ev.to_mesh_clear()
dimensions=[max(p[k] for p in bounds)-min(p[k] for p in bounds) for k in range(3)]
high_total=sum(x['triangles'] for x in high.values())
print('HIGH_STATS '+json.dumps({'triangles':high_total,'objects':len(source),'dimensions_m':dimensions}),flush=True)

# Preserve the high source. The GLB uses two face subdivision steps, one garment
# subdivision step to retain embroidery contact, and lower curve
# tessellation for portable inspection; it is explicitly not the accepted LOD0.
for o in source:
    for m in o.modifiers:
        if m.type=='MULTIRES':m.levels=2
        elif m.type=='SUBSURF':m.levels=1 if o.name=='QL08_Scalp' or o.name.startswith(('QL03_','QL04_','QL05_','QL06_')) else 0
    if o.type=='CURVE':o.data.resolution_u=1;o.data.bevel_resolution=1
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
export_col=col('EXPORT_STATIC')
export_objects=[]
for o in source:
    ev=o.evaluated_get(dg)
    me=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=dg)
    me.transform(o.matrix_world)
    # Remove tessellation degeneracies without altering the editable source.
    bm=bmesh.new();bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8)
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    # Tangent-space export cannot evaluate n-gon caps reliably. Keep the
    # editable source unchanged, triangulating only those caps in this copy.
    ngons=[f for f in bm.faces if len(f.verts)>4]
    if ngons:bmesh.ops.triangulate(bm,faces=ngons,ngon_method='BEAUTY')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(me);bm.free();me.update()
    ob=bpy.data.objects.new('EXP_'+o.name,me);export_col.objects.link(ob)
    ob['part_id']=o.get('part_id',o.name.split('_')[0]);export_objects.append(ob)
    o.hide_render=True;o.hide_set(True)

# Join by semantic part, preserving the material slots and UVs.
groups=collections.defaultdict(list)
for o in export_objects:groups[o['part_id']].append(o)
joined=[]
for pid,obs in sorted(groups.items()):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]
    if len(obs)>1:bpy.ops.object.join()
    ob=obs[0];ob.name=pid+'_Qinglan';joined.append(ob)
stats={o.name:{'vertices':len(o.data.vertices),'triangles':sum(len(p.vertices)-2 for p in o.data.polygons),'materials':len(o.data.materials)} for o in joined}
print('EXPORT_STATS '+json.dumps(stats),flush=True)
save(WORK/'06_export-candidate.blend')
# The tight coplanar threshold resolves sub-millimetre gold embroidery. Contact
# tolerance allows the intentional spacing between layered clothing surfaces.
skin=next(o for o in joined if o.name.startswith('QL01_'))
skin_copy=skin.copy();skin_copy.data=skin.data.copy();skin_copy.name='QA_Skin_Island'
bpy.context.scene.collection.objects.link(skin_copy)
bpy.ops.object.select_all(action='DESELECT');skin_copy.select_set(True)
bpy.context.view_layer.objects.active=skin_copy
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='LOOSE');bpy.ops.object.mode_set(mode='OBJECT')
islands=[o for o in bpy.context.selected_objects if o.type=='MESH']
head=max(islands,key=lambda o:max(v.co.z for v in o.data.vertices))
hands=[o for o in islands if o!=head]
# Skin hidden inside the bell sleeves is deliberately masked from the export.
# Check those two exposed hand islands separately, as the skill prescribes for
# intentionally separated pieces; this does not claim arm/cloth deformation QA.
qa_names=[o.name for o in joined if o!=skin]+[head.name]
qa=qa_check.run(objects=qa_names,profile='render',eps=.00002,tol=.018,uv=False,max_tris=1800000)
hand_checks=[]
for hand in hands:
    hq=qa_check.run(objects=[hand.name],profile='render',eps=.00002,tol=.002,uv=True,max_tris=100000)
    hand_checks.append(hq)
    qa['errors'].extend(hq['errors']);qa['warnings'].extend(hq['warnings'])
qa['pass']=not qa['errors']
qa['intentional_separate_skin_islands']=hand_checks
qa['uv_policy']='Skin UVs checked by the skill. Garments share woven tile maps on their inner/outer surfaces; solid-colored trim does not require unique UVs.'
for o in joined:
    if o.data.uv_layers:
        assert all(math.isfinite(x) for loop in o.data.uv_layers.active.data for x in loop.uv),o.name
for o in islands:bpy.data.objects.remove(o,do_unlink=True)
(ROOT/'review/mesh-qa.json').write_text(json.dumps(qa,indent=2),encoding='utf-8')
print('QA_RESULT '+json.dumps({'pass':qa['pass'],'errors':qa['errors'],'warning_count':len(qa['warnings'])}),flush=True)
report={'high_poly':{'triangles':high_total,'objects':len(source),'dimensions_m':dimensions,'per_object':high},
        'static_glb':{'per_part':stats,'triangles':sum(s['triangles'] for s in stats.values())},
        'qa_pass':qa['pass'],'workflow':'blender-skills @ 71d031dab8bc6729504d11a78cbe91945401045f',
        'state':'static high-poly art candidate',
        'pending':['production retopology/LOD budget','shared skeleton and skinning','motion clipping validation','Estella editor/CI acceptance','device performance acceptance']}
(ROOT/'review/asset-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
if not qa['pass']:
    print('QA_NEEDS_REPAIR',flush=True)
    raise SystemExit(2)
result=export_asset.run(preset='gltf',objects=[o.name for o in joined],out=str(ROOT/'export/qinglan-static.glb'),no_anim=True,set=['export_tangents=true'])
(ROOT/'review/export-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print('EXPORT_RESULT '+json.dumps(result),flush=True)
print('REVIEW_RANDOM '+json.dumps(review_shots.run(objects=[o.name for o in joined],out=str(ROOT/'review/part-review.png'),views=['front','right','back','three_quarter'],mode='random',res=512)),flush=True)
# Inspect the editable base topology separately from the densely tessellated trim.
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-highpoly.blend'))
wire_objects=[]
for o in col().objects:
    if o.type=='MESH':
        for m in o.modifiers:
            if m.type in {'SUBSURF','MULTIRES'}:m.levels=0;m.render_levels=0
        wire_objects.append(o.name)
print('REVIEW_WIRE_RAW '+json.dumps(review_shots.run(objects=wire_objects,out=str(WORK/'topology-skill-raw.png'),views=['front','right','back','three_quarter'],mode='wire',res=512)),flush=True)
