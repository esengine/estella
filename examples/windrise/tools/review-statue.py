"""Headless static prop inspection; the original Tripo geometry stays intact."""
import bpy,json,sys,os
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root.parents[1]/'output/windrise/statue-review';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'assets/shrine/anemo-statue.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
 bpy.context.view_layer.objects.active=o;o.select_set(True)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.select_set(False)
toolkit=Path(os.environ.get('BLENDER_REVIEW_TOOLS',str(Path.home()/'.codex/skills/scenario-blender-expert/scripts')))
sys.path.insert(0,str(toolkit))
import bx_audit,bx_review
gate=bx_audit.deliverable(meshes,profile='game')
(out/'audit.json').write_text(json.dumps(gate,indent=2),encoding='utf-8')
sheet=bx_review.review(meshes,str(out),views=('front','right','threequarter','back'),modes=('silhouette','matcap'),res=360)
print('RESULT',json.dumps({'gate':gate,'sheet':sheet}))
