"""Check the fitted face without hair, jewellery or costume obscuring it."""
import sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.open_mainfile(filepath=str(WORK/'03_costume.blend'))
source=(Path(__file__).parent/'05_materials.py').read_text(encoding='utf-8')
start=source.index("body=bpy.data.objects['QL01_Body']")
end=source.index("print('BAKE_SKIN")
def bsdf(mat):return next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
exec(source[start:end])
bsdf(bpy.data.materials['M_Iris_Hazel']).inputs['Base Color'].default_value=(.032,.017,.012,1)
bsdf(bpy.data.materials['M_Eye_Sclera']).inputs['Base Color'].default_value=(.68,.65,.62,1)
for ob in col().objects:
    if not ob.name.startswith(('QL01_','QL02_')):ob.hide_render=True
for ob in bpy.data.objects:
    if ob.type=='LIGHT':
        ob.data.color=(1,1,1)
        if ob.name=='Rim':ob.data.energy=200
sc=bpy.context.scene;sc.view_settings.look='AgX - Medium High Contrast';sc.view_settings.exposure=-.45
out=ROOT/'review/head';out.mkdir(exist_ok=True)
cams=[('front',(0,-3,1.605),(0,-.03,1.605)),('profile',(3,-.04,1.605),(0,-.04,1.605)),('three-quarter',(2,-3,1.605),(0,-.03,1.605))]
for name,loc,target in cams:
    cam=camera('HEAD_'+name,loc,target,ortho=.315)
    render(cam,out/(name+'.png'),900,1000,64)
    print('HEAD_RENDER '+name,flush=True)
save(WORK/'head-study.blend')
