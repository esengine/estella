"""Save the complete fitted human and review the head without costume/hair."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-highpoly.blend'))
original=bpy.data.objects['QL01_Body']
for ob in col().objects:
    if not ob.name.startswith('QL02_'):ob.hide_render=True
body=original.copy();body.data=original.data.copy();body.name='QL01_Complete_Human_Study'
col('HUMAN_STUDY').objects.link(body);body.hide_render=False;body.hide_set(False)
for mod in list(body.modifiers):
    if mod.type=='MASK':body.modifiers.remove(mod)
study_skin=body.data.materials[0].copy();study_skin.name='M_Human_Study_Surface';body.data.materials[0]=study_skin
nt=study_skin.node_tree;nodes=nt.nodes;links=nt.links
bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
original_color=bs.inputs['Base Color'].links[0].from_socket
geom=nodes.new('ShaderNodeNewGeometry');sep=nodes.new('ShaderNodeSeparateXYZ');links.new(geom.outputs['Position'],sep.inputs[0])
def math_op(operation,a,b=0):
    node=nodes.new('ShaderNodeMath');node.operation=operation
    for i,arg in enumerate([a,b]):
        if isinstance(arg,(int,float)):node.inputs[i].default_value=arg
        else:links.new(arg,node.inputs[i])
    return node.outputs[0]
below_neck=math_op('LESS_THAN',sep.outputs['Z'],1.465)
hand=math_op('MULTIPLY',math_op('GREATER_THAN',math_op('ABSOLUTE',sep.outputs['X']),.27),math_op('LESS_THAN',sep.outputs['Z'],1.04))
mask=math_op('MULTIPLY',below_neck,math_op('SUBTRACT',1,hand))
mix=nodes.new('ShaderNodeMixRGB');links.new(mask,mix.inputs[0]);links.new(original_color,mix.inputs[1])
mix.inputs[2].default_value=tuple(srgb(a) for a in (.22,.28,.30))+(1,);links.new(mix.outputs[0],bs.inputs['Base Color'])
links.new(math_op('ADD',.49,math_op('MULTIPLY',mask,.19)),bs.inputs['Roughness'])
for ob in bpy.data.objects:
    if ob.type=='LIGHT':
        ob.data.color=(1,1,1)
        if ob.name=='Rim':ob.data.energy=200
sc=bpy.context.scene;sc.view_settings.exposure=-.45
out=ROOT/'review/head';out.mkdir(exist_ok=True)
cams=[('front',(0,-3,1.605),(0,-.03,1.605)),('profile',(3,-.04,1.605),(0,-.04,1.605)),('three-quarter',(2,-3,1.605),(0,-.03,1.605))]
for name,loc,target in cams:
    cam=camera('HUMAN_HEAD_'+name,loc,target,ortho=.315)
    render(cam,out/(name+'.png'),1000,1100,96)
body_cam=camera('HUMAN_BODY_Front',(0,-4,.87),(0,0,.87),ortho=1.90)
side_cam=camera('HUMAN_BODY_Side',(4,0,.87),(0,0,.87),ortho=1.90)
render(body_cam,out/'body-front.png',850,1300,64)
render(side_cam,out/'body-side.png',850,1300,64)
sc.camera=bpy.data.objects['HUMAN_HEAD_three-quarter']
sc['study_purpose']='Human/face first: complete fitted CC0 body, neutral light, no hair masking the head. A matte neutral material identifies the body study; this is not a separate garment mesh.'
save(ROOT/'qinglan-human-study.blend')
clay=material('M_Head_Clay',(.52,.55,.56),.62)
sc.view_layers[0].material_override=clay
render(sc.camera,out/'clay-three-quarter.png',1000,1100,64)
print('HUMAN_STUDY_SAVED',flush=True)
