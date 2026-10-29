"""Headless review of a saved native-brush revision; never replays GUI brushes."""
import bpy,bmesh,json,sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
ROOT=Path(__file__).resolve().parents[1]
SKILLS=Path.home()/'.codex/skills'
sys.path.append(str(SKILLS/'scenario-blender-expert/scripts'))
import bx_audit as A
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-live-face.blend'))
head=bpy.data.objects['Qinglan_Live_Sculpt']
keys=head.data.shape_keys.key_blocks
def coordinates(data):
    a=np.empty(len(data)*3,dtype=np.float32);data.foreach_get('co',a);return a.reshape(-1,3)
base=coordinates(keys[0].data);mixed=base.copy()
per_key=[]
for k in list(keys)[1:]:
    co=coordinates(k.data);assert np.isfinite(co).all()
    delta=co-base;mixed+=delta*k.value
    d=np.linalg.norm(delta,axis=1)
    per_key.append({'name':k.name,'value':k.value,'affected_vertices':int((d>1e-8).sum()),'max_delta_mm':float(d.max()*1000)})
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
mesh=bpy.data.meshes.new_from_object(head.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
actual=coordinates(mesh.vertices)
mix_error=float(np.linalg.norm(actual-mixed,axis=1).max());assert mix_error<2e-6
snapshot=bpy.data.objects.new('Audit_Only',mesh)
audit=A.audit(snapshot);gate=A.deliverable([snapshot],profile='render')

# The selected patch extends at least 10 mm past the brush regions. Compare
# identical face indices in source and revision, excluding adjacent faces.
face_ids=[];polys=[]
for p in mesh.polygons:
    idx=list(p.vertices);v=base[idx]
    if np.any((np.abs(v[:,0])<.075)&(v[:,1]<-.075)&(v[:,2]>1.50)&(v[:,2]<1.65)):
        face_ids.append(p.index);polys.append(idx)
def overlaps(co):
    tree=BVHTree.FromPolygons([Vector(p) for p in co],polys)
    return {(face_ids[a],face_ids[b]) for a,b in tree.overlap(tree)
            if a<b and not set(polys[a])&set(polys[b])}
before_pairs=overlaps(base);after_pairs=overlaps(actual)
new=after_pairs-before_pairs
mesh.calc_loop_triangles()
triangles={}
for tri in mesh.loop_triangles:
    triangles.setdefault(tri.polygon_index,[]).append(tuple(tri.vertices))
def confirmed_pairs(co,pairs):
    # Work in millimetres near the origin so dense facial triangles do not
    # fall below absolute tolerances in Blender's ray/triangle primitive.
    points=[Vector((p-np.array((0,-.12,1.60)))*1000) for p in co]
    def crosses(ta,tb):
        a=[points[i] for i in ta];b=[points[i] for i in tb]
        for edges,face in ((a,b),(b,a)):
            for i in range(3):
                origin=edges[i];direction=edges[(i+1)%3]-origin
                if direction.length_squared<=1e-20:continue
                hit=intersect_ray_tri(*face,direction.normalized(),origin,True)
                if hit is not None and direction.length_squared>1e-20:
                    t=(hit-origin).dot(direction)/direction.length_squared
                    if 1e-6<t<1-1e-6:return True
        return False
    return {pair for pair in pairs if any(crosses(ta,tb) for ta in triangles[pair[0]] for tb in triangles[pair[1]])}
probe=intersect_ray_tri(Vector((0,0,0)),Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)),Vector((.25,.25,-1)),True)
assert probe is not None and (probe-Vector((.25,.25,0))).length<1e-6
source_crossings=confirmed_pairs(base,before_pairs)
current_crossings=confirmed_pairs(actual,after_pairs)
new_crossings=current_crossings-source_crossings
delta=np.linalg.norm(actual-base,axis=1)
report={'scope':'Saved head and local facial self-intersection comparison; not facial likeness, rig or game acceptance.',
        'vertices':len(mesh.vertices),'faces':len(mesh.polygons),'keys':per_key,
        'shape_key_mix_error_m':mix_error,'max_total_delta_mm':float(delta.max()*1000),
        'unchanged_vertices':int((delta<=1e-8).sum()),
        'source_control_mesh':'Preserved hidden V5 Multires source; live brush edits are high-resolution shape keys.',
        'audit':audit,'head_render_gate':gate,
        'face_patch_intersections':{'faces_checked':len(polys),'source_bvh_candidates':len(before_pairs),
           'current_bvh_candidates':len(after_pairs),'new_bvh_candidates':len(new),
           'source_confirmed_crossings':len(source_crossings),'current_confirmed_crossings':len(current_crossings),
           'new_confirmed_crossings':len(new_crossings),
           'new_face_pairs':[list(p) for p in sorted(new_crossings)],
           'new_crossing_centers':[actual[list(mesh.polygons[a].vertices)+list(mesh.polygons[b].vertices)].mean(0).tolist() for a,b in sorted(new_crossings)],
           'limits':'Local face patch only. BVH candidates narrowed by segment/triangle intersections in millimetres near the origin; tangencies and coplanar overlap are not confirmed by this test. Full dense-mesh intersection test remains outside scope.'},
        'art_acceptance':'needs review; not implied by gate or native operator completion'}
(ROOT/'review/verification.json').write_text(json.dumps(report,indent=2))
bpy.data.objects.remove(snapshot,do_unlink=True)
print('AUDIT_RESULT '+json.dumps({'max_total_delta_mm':report['max_total_delta_mm'],
      'shape_key_mix_error_m':mix_error,'source_crossings':len(source_crossings),
      'current_crossings':len(current_crossings),'new_crossings':len(new_crossings)}),flush=True)
assert not new_crossings, 'Native revision introduced local face intersections; revise before delivery.'
if '--audit-only' in sys.argv:sys.exit(0)

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.cycles.device='GPU'
visible_keys=[]
for ob in bpy.data.objects:
    if ob.type=='MESH' and not ob.hide_render and ob.data.shape_keys:
        visible_keys.extend((k,k.value) for k in list(ob.data.shape_keys.key_blocks)[1:])
for state in (('after',) if '--after-only' in sys.argv else ('before','after')):
    for key,value in visible_keys:key.value=0 if state=='before' else value
    bpy.context.view_layer.update()
    for name in ('front','profile','threequarter','low'):
        scene.camera=bpy.data.objects['Review_'+name]
        scene.render.filepath=str(ROOT/'review'/f'{state}-{name}.png')
        bpy.ops.render.render(write_still=True)
for key,value in visible_keys:key.value=value
print('SAVED_FACE_REVIEW_READY',flush=True)
