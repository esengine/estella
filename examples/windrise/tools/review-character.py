"""Inspect the Tripo candidate in background Blender; keep the editable source and fixed views."""
import bpy, json, sys, math, os
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parents[1]
out=root.parents[1]/'output/windrise/character-review'
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
print('BLENDER',bpy.app.version_string)
source=root/'source/tripo/lumine.glb'
bpy.ops.import_scene.gltf(filepath=str(source))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.context.view_layer.update()
lo=[min((o.matrix_world@Vector(c))[k] for o in meshes for c in o.bound_box) for k in range(3)]
hi=[max((o.matrix_world@Vector(c))[k] for o in meshes for c in o.bound_box) for k in range(3)]
report={'version':bpy.app.version_string,'bounds':[lo,hi],'objects':[]}
for obj in meshes:
 bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 obj.data.calc_loop_triangles()
 report['objects'].append({'name':obj.name,'vertices':len(obj.data.vertices),'triangles':len(obj.data.loop_triangles),'uvMaps':len(obj.data.uv_layers),'materials':len(obj.data.materials)})
 obj.select_set(False)
sys.path.insert(0,os.environ.get('BLENDER_REVIEW_TOOLS',str(Path.home()/'.codex/skills/scenario-blender-expert/scripts')))
import bx_audit, bx_review
report['deliveryGate']=bx_audit.deliverable(meshes,profile='game')
sourceDir=root/'source';sourceDir.mkdir(exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(sourceDir/'lumine-candidate.blend'))
sheet=bx_review.review(meshes,str(out),views=('front','right','threequarter','back'),modes=('silhouette','matcap','wire'),res=360)
report['reviewSheet']=sheet
(out/'audit.json').write_text(json.dumps(report,indent=2,default=str),encoding='utf-8')
print('RESULT',json.dumps({'sheet':sheet,'audit':str(out/'audit.json'),'triangles':sum(o['triangles'] for o in report['objects']),'gate':report['deliveryGate'].get('pass')}))
