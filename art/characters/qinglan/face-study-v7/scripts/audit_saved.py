"""Compare actual evaluated cage and Multires geometry against the V5 source.

New self-crossings are distinguished from inherited contacts. This is a local
face test; it does not approve likeness, expression deformation or a game asset.
"""
import bpy,json,sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
ROOT=Path(__file__).resolve().parents[1]
sys.path.extend([str(ROOT/'scripts'),str(Path.home()/'.codex/skills/scenario-blender-expert/scripts')])
import identity_cage as I
import bx_audit as A
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-identity-cage.blend'))
head=bpy.data.objects['Qinglan_Identity_Cage'];multi=next(m for m in head.modifiers if m.type=='MULTIRES')
keys=head.data.shape_keys.key_blocks;new_keys=[k for k in keys if k.name.startswith('V7_')]
enabled_values={k.name:(0 if k.mute else k.value) for k in new_keys}
source=I.world_coords(head,I.mixed_coords(head))
current=I.world_coords(head,I.mixed_coords(head,exclude_prefix='NONE'))
protected=source[:,2]<1.47
protected_delta=float(np.linalg.norm(current-source,axis=1)[protected].max(initial=0))
assert protected_delta<2e-7
assert np.isfinite(current).all()
report={'scope':'Editable face proportion study; no rig, engine or visual acceptance implied.',
        'protected_body_delta_m':protected_delta,'source_topology_vertices':len(source),
        'new_key_count':len(new_keys),'levels':{},'delivery_profile':'render only'}
def evaluate(level,enabled):
    multi.levels=level
    for key in new_keys:key.value=enabled_values[key.name] if enabled else 0
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    mesh=bpy.data.meshes.new_from_object(head.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
    mesh.transform(head.matrix_world)
    return mesh
def bvh_candidates(co,polys,face_ids):
    tree=BVHTree.FromPolygons([Vector(p) for p in co],polys)
    return {(face_ids[a],face_ids[b]) for a,b in tree.overlap(tree) if a<b and not set(polys[a])&set(polys[b])}
def narrow(co,pairs,triangles):
    points=[Vector((p-np.array((0,-.12,1.60)))*1000) for p in co]
    def cross(ta,tb):
        a=[points[i] for i in ta];b=[points[i] for i in tb]
        for edges,face in ((a,b),(b,a)):
            for i in range(3):
                origin=edges[i];direction=edges[(i+1)%3]-origin
                if direction.length_squared<1e-20:continue
                hit=intersect_ray_tri(*face,direction.normalized(),origin,True)
                if hit is not None:
                    t=(hit-origin).dot(direction)/direction.length_squared
                    if 1e-6<t<1-1e-6:return True
        return False
    return {p for p in pairs if any(cross(a,b) for a in triangles[p[0]] for b in triangles[p[1]])}
probe=intersect_ray_tri(Vector((0,0,0)),Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)),Vector((.25,.25,-1)),True)
assert probe is not None and probe.length<1
failed=[]
for level in (0,2):
    before=evaluate(level,False);after=evaluate(level,True)
    base=I.coords(before.vertices);actual=I.coords(after.vertices)
    assert len(base)==len(actual) and len(before.polygons)==len(after.polygons)
    polys=[];face_ids=[]
    for p in after.polygons:
        idx=list(p.vertices);v=base[idx]
        if np.any((np.abs(v[:,0])<.082)&(v[:,1]<-.065)&(v[:,2]>1.47)&(v[:,2]<1.65)):
            polys.append(idx);face_ids.append(p.index)
    bp=bvh_candidates(base,polys,face_ids);ap=bvh_candidates(actual,polys,face_ids)
    after.calc_loop_triangles();triangles={}
    for tri in after.loop_triangles:triangles.setdefault(tri.polygon_index,[]).append(tuple(tri.vertices))
    bc=narrow(base,bp,triangles);ac=narrow(actual,ap,triangles);new=ac-bc
    snapshot=bpy.data.objects.new('Audit_Only_V7',after)
    audit=A.audit(snapshot)
    gate=A.deliverable([snapshot],profile='render')
    deltas=np.linalg.norm(actual-base,axis=1)
    result={'vertices':len(actual),'faces':len(after.polygons),'audit':audit,'render_gate':gate,
            'max_total_delta_mm':float(deltas.max()*1000),'face_patch_faces':len(polys),
            'source_bvh_candidates':len(bp),'current_bvh_candidates':len(ap),
            'source_confirmed_crossings':len(bc),'current_confirmed_crossings':len(ac),
            'new_confirmed_crossings':len(new),
            'new_crossing_pairs':[list(p) for p in sorted(new)],
            'new_crossing_centers':[actual[list(after.polygons[a].vertices)+list(after.polygons[b].vertices)].mean(0).tolist() for a,b in sorted(new)],
            'limits':'Local face patch, millimetre-scale segment/triangle tests; inherited crossings retained, tangencies and coplanar overlaps not certified.'}
    report['levels'][str(level)]=result
    if new or not gate['pass']:failed.append(level)
    bpy.data.objects.remove(snapshot,do_unlink=True);bpy.data.meshes.remove(after);bpy.data.meshes.remove(before)
    print('LEVEL_AUDIT '+json.dumps({'level':level,'faces':result['faces'],'source_crossings':len(bc),'current_crossings':len(ac),'new_crossings':len(new),'render_gate':gate['pass']}),flush=True)
report['checks_passed']=not failed
report['key_values']=enabled_values
report['status']='passed_local_geometry_checks' if not failed else 'needs_revision_contact_pairs_remain'
(ROOT/'review/verification.json').write_text(json.dumps(report,indent=2))
if '--report-only' not in sys.argv:
    assert not failed,'New intersections or a render gate error require correction: '+str(failed)
print('V7_AUDIT_COMPLETE',flush=True)
