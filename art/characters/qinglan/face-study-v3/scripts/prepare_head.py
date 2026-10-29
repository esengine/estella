"""Extract a small editable head cage; retain original per-vertex identity."""
import bpy,bmesh,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'review';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT.parent/'qinglan-human-study.blend'))
src=bpy.data.objects['QL01_Complete_Human_Study']
me=src.data.copy();me.name='Qinglan_Head_Cage'
bm=bmesh.new();bm.from_mesh(me);bm.verts.ensure_lookup_table()
sid=bm.verts.layers.int.new('source_vertex_id')
for v in bm.verts:v[sid]=v.index
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<1.435],context='VERTS')
for v in bm.verts:
    if v.co.z<1.47 and any(e.is_boundary for e in v.link_edges):v.co.z=1.435
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
original_ids=[v.value for v in me.attributes['source_vertex_id'].data]
groups={g.index:g.name for g in src.vertex_groups}
out={'source':'../qinglan-human-study.blend','vertices':[],
     'faces':[list(p.vertices) for p in me.polygons],
     'edges':[list(e.vertices) for e in me.edges]}
for v in me.vertices:
    out['vertices'].append({'id':v.index,'source_id':original_ids[v.index],'co':list(v.co),
       'groups':[groups.get(g.group,'') for g in v.groups if g.weight>.5]})
(ROOT/'head-cage.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
# Body group names are recorded above; strip their index-only weights before
# adding new, head-specific edit groups to the independent object.
bm=bmesh.new();bm.from_mesh(me)
deform=bm.verts.layers.deform.active
if deform:
    for v in bm.verts:v[deform].clear()
bm.to_mesh(me);bm.free()
for ob in list(bpy.data.objects):bpy.data.objects.remove(ob,do_unlink=True)
for co in list(bpy.data.collections):bpy.data.collections.remove(co)
col=bpy.data.collections.new('HEAD_STUDY');bpy.context.scene.collection.children.link(col)
head=bpy.data.objects.new('Qinglan_Head_Base',me);col.objects.link(head)
head.vertex_groups.clear()
head.data.materials.clear()
for p in me.polygons:p.material_index=0;p.use_smooth=True
bpy.context.view_layer.objects.active=head;head.select_set(True)
head['source_license']='CC0-1.0 MakeHuman core mesh; original data retained by source_vertex_id'
head['status']='Face cage study; not aesthetic acceptance'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'head-base.blend'),compress=True)
print('HEAD_BASE '+json.dumps({'vertices':len(me.vertices),'faces':len(me.polygons),'boundary':'open neck cut'}),flush=True)
