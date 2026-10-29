"""Reopen, audit actual evaluated geometry, and render cage/clay evidence."""
import bpy,bmesh,json,sys,hashlib,os
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
SKILLS=Path(os.environ.get('SCENARIO_SKILLS_ROOT',str(Path.home()/'.codex/skills')))
sys.path += [str(SKILLS/'scenario-blender-expert/scripts'),str(SKILLS/'scenario-blender-sculpting/scripts'),str(SKILLS/'scenario-blender-retopology/scripts')]
import bx_audit as A, bx_review, bx_retopo as R, bx_sculpt as S
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-face-candidate.blend'))
head=bpy.data.objects['Qinglan_Head_Multires']
for name in ('Inspection_Cage','Inspection_High'):
    col=bpy.data.collections.get(name)
    if col:
        for ob in list(col.objects):bpy.data.objects.remove(ob,do_unlink=True)
        bpy.data.collections.remove(col)
keys=head.data.shape_keys.key_blocks
base=np.array([v.co[:] for v in keys[0].data]);mixed=base.copy()
protected=base[:,2]<1.39
for k in list(keys)[1:]:
    co=np.array([v.co[:] for v in k.data]);delta=co-base
    assert np.isfinite(co).all()
    assert np.max(np.abs(delta[protected]),initial=0)==0, k.name
    mixed+=delta*k.value

def snapshot(ob,name):
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    mesh=bpy.data.meshes.new_from_object(ob.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
    mesh.transform(ob.matrix_world);mesh.update()
    copy=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(copy)
    return copy

def intersection_pairs(ob):
    bm=bmesh.new();bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table();bm.verts.ensure_lookup_table()
    tree=BVHTree.FromBMesh(bm)
    pairs={(a,b) for a,b in tree.overlap(tree)
           if a<b and not set(bm.faces[a].verts)&set(bm.faces[b].verts)}
    bm.free();return pairs

multi=next(m for m in head.modifiers if m.type=='MULTIRES')
levels=multi.levels;multi.levels=0
cage=snapshot(head,'Qinglan_Control_Cage')
assert cage.data.attributes.get('source_vertex_id') is not None
ids=np.array([v.value for v in cage.data.attributes['source_vertex_id'].data])
mw=np.array(head.matrix_world)
expected=mixed[ids]@mw[:3,:3].T+mw[:3,3]
actual=np.array([v.co[:] for v in cage.data.vertices])
face_region=base[ids,2]>1.39
mix_error=float(np.max(np.linalg.norm(actual[face_region]-expected[face_region],axis=1)))
assert mix_error<2e-6,mix_error
multi.levels=levels
high=snapshot(head,'Qinglan_High_Inspection')
topology=R.topology_report(cage)
for k in list(keys)[1:]:k.value=0
multi.levels=0
baseline_cage=snapshot(head,'Baseline_Audit_Only')
baseline_audit=A.audit(baseline_cage)
source_pairs=intersection_pairs(baseline_cage)
candidate_pairs=intersection_pairs(cage)
new_pairs=candidate_pairs-source_pairs
assert not new_pairs, f'Local edits introduced {len(new_pairs)} cage intersections'
intersections={'source_pairs':len(source_pairs),'candidate_pairs':len(candidate_pairs),
               'new_pairs':len(new_pairs),'removed_pairs':len(source_pairs-candidate_pairs),
               'all_remaining_pairs_also_in_source':not new_pairs,
               'note':'Pair overlap test on the control cage; source contacts still need correction for production. Dense surface self-intersections are not covered.'}
bpy.data.objects.remove(baseline_cage,do_unlink=True)
for k in list(keys)[1:]:k.value=1
multi.levels=levels
mesh_audit=A.audit(high)
delivery=A.deliverable([high],profile='render')
report={'scope':'Head mesh only. Eye shading, rig deformation, game export and art acceptance are separate.',
        'shape_keys':len(keys)-1,'protected_body_vertices':int(protected.sum()),
        'protected_body_delta_m':0,'shape_key_mix_error_m':mix_error,
        'multires_level':levels,'topology':topology,'source_cage_audit':baseline_audit,'surface_audit':mesh_audit,
        'control_cage_intersection_comparison':intersections,
        'head_render_gate':delivery,'art_acceptance':'pending; not implied by numerical checks'}
(ROOT/'review/verification.json').write_text(json.dumps(report,indent=2))

# The wire sheet shows the artist's real control edges, not triangulated shading.
bx_review.review([cage],str(ROOT/'review/topology'),views=('front','right','threequarter','low'),modes=('wire',),res=400)
bx_review.review([high],str(ROOT/'review/clay'),views=('front','right','threequarter','low'),modes=('silhouette','matcap'),res=400)
S.final_render([high],str(ROOT/'review/clay/threequarter-90mm.png'),direction=(.7,-1,0),res=800,cavity=False)

for ob,colname in [(cage,'Inspection_Cage'),(high,'Inspection_High')]:
    col=bpy.data.collections.new(colname);bpy.context.scene.collection.children.link(col)
    for c in list(ob.users_collection):c.objects.unlink(ob)
    col.objects.link(ob);col.hide_render=True;ob.hide_set(True)
    ob['purpose']='Read-only evaluation snapshot for inspection; edit source Multires keys to revise the face'
head['technical_report']='review/verification.json'
head['art_status']='Review candidate; reference likeness and game readiness not approved'
bpy.context.scene.camera=bpy.data.objects['Review_threequarter']
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qinglan-face-candidate.blend'),compress=True)
print('VERIFY_RESULT '+json.dumps({'cage_vertices':topology['verts'],'cage_faces':topology['faces'],
      'quads_pct':topology['quads_pct'],'high_faces':mesh_audit['faces'],
      'head_render_pass':delivery['pass'],'errors':delivery['errors'],'warnings':delivery['warnings'],
      'shape_key_mix_error_m':mix_error,'intersections':intersections}),flush=True)
