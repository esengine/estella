"""Repair the two severed ribbon spans without changing the generated body or skeleton."""
import bpy,bmesh,json,sys,os
from pathlib import Path

root=Path(__file__).resolve().parents[1]
out=root.parents[1]/'output/windrise/character-review';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'source/tripo/lumine-animated.glb'))
o=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bm=bmesh.new();bm.from_mesh(o.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00002)
seen=set();parts=[]
for start in bm.verts:
 if start in seen:continue
 todo=[start];part=set()
 while todo:
  v=todo.pop()
  if v in seen:continue
  seen.add(v);part.add(v);todo.extend(e.other_vert(v) for e in v.link_edges if e.other_vert(v) not in seen)
 parts.append(part)
uv=bm.loops.layers.uv.active
vuv={v:next(iter(v.link_loops))[uv].uv.copy() for v in bm.verts if v.link_loops}
deform=bm.verts.layers.deform.verify()
spine=o.vertex_groups['mixamorig:Spine2'].index
repairs=[]
for side in [-1,1]:
 lower=next(p for p in parts if 50<=len(p)<=75 and max(v.co.z for v in p)<1 and sum(v.co.y for v in p)/len(p)*side>0)
 upper=next(p for p in parts if 30<=len(p)<=42 and min(v.co.z for v in p)>1 and max(v.co.z for v in p)<1.4 and sum(v.co.y for v in p)/len(p)*side>0)
 # Tripo assigned the detached ribbon tips to nearby hands. Their shoulder attachment must drive the whole ribbon.
 for v in lower|upper:
  weights=v[deform]
  weights.clear();weights[spine]=1.0
 # Open the terminal triangles and bridge the two boundaries, keeping every original vertex's weights and UV.
 lf=max({f for v in lower for f in v.link_faces},key=lambda f:f.calc_center_median().z)
 uf=min({f for v in upper for f in v.link_faces},key=lambda f:f.calc_center_median().z)
 edges=list(lf.edges)+list(uf.edges)
 bmesh.ops.delete(bm,geom=[lf,uf],context='FACES_ONLY')
 added=bmesh.ops.bridge_loops(bm,edges=edges,use_pairs=True)['faces']
 for face in added:
  face.material_index=0
  for loop in face.loops:loop[uv].uv=vuv[loop.vert]
 repairs.append({'side':side,'newFaces':len(added)})
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(o.data);bm.free();o.data.update()
bpy.context.view_layer.update()
sys.path.insert(0,os.environ.get('BLENDER_REVIEW_TOOLS',str(Path.home()/'.codex/skills/scenario-blender-expert/scripts')))
import bx_audit,bx_review
gate=bx_audit.deliverable([o],profile='game')
(out/'final-audit.json').write_text(json.dumps({'repairs':repairs,'gate':gate},indent=2),encoding='utf-8')
if not gate['pass']:raise RuntimeError('Character delivery gate failed: '+str(gate['errors']))
for action in bpy.data.actions:action.use_fake_user=True
source=root/'source';source.mkdir(exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(source/'lumine.blend'))
bpy.ops.export_scene.gltf(filepath=str(root/'assets/character/lumine-final.glb'),export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True,export_yup=True)
sheet=bx_review.review([o],str(out/'final'),views=('front','right','threequarter','back'),modes=('silhouette','matcap'),res=360)
print('RESULT',json.dumps({'gate':gate['pass'],'warnings':gate['warnings'],'repairs':repairs,'actions':[a.name for a in bpy.data.actions],'sheet':sheet}))
