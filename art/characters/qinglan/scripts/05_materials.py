"""Bake complexion, iris fibres and woven silk with blender-skills."""
import sys,math,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.open_mainfile(filepath=str(WORK/'04_details.blend'))
skillroot=Path(os.environ.get('BLENDER_SKILLS_ROOT',r'D:\tmp\estella-blender-skills-20261028'))/'skills'
sys.path.insert(0,str(skillroot/'blender-texture-baking/scripts'))
import bake_maps

def bsdf(mat):return next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
def tex_link(mat,img,socket):
    nt=mat.node_tree;n=nt.nodes.new('ShaderNodeTexImage');n.image=img
    if socket=='Normal':
        nn=nt.nodes.new('ShaderNodeNormalMap');nn.inputs['Strength'].default_value=.32
        nt.links.new(n.outputs['Color'],nn.inputs['Color']);nt.links.new(nn.outputs['Normal'],bsdf(mat).inputs['Normal'])
    else:nt.links.new(n.outputs['Color'],bsdf(mat).inputs[socket])

body=bpy.data.objects['QL01_Body'];skin=bpy.data.materials['M_Skin']
lipgroup=body.vertex_groups.get('lips')
lipverts={v.index for v in body.data.vertices if any(g.group==lipgroup.index for g in v.groups)}
for v in body.data.vertices:
    if v.index in lipverts:
        v.co.z=1.5286+(v.co.z-1.5286)*.55
for p in body.data.polygons:
    if p.material_index==1:p.material_index=0
colors=body.data.color_attributes.new(name='Complexion',type='FLOAT_COLOR',domain='POINT')
base=np.array([.79,.645,.59])
for v in body.data.vertices:
    x,y,z=v.co;c=base.copy()
    if z>1.46 and y<-.07:
        cheek=math.exp(-((abs(x)-.045)/.021)**2-((z-1.570)/.016)**2)*.25
        c=c*(1-cheek)+np.array([.76,.43,.43])*cheek
        shadow=math.exp(-((abs(x)-.035)/.023)**4-((z-1.606)/.007)**2)*.27
        c=c*(1-shadow)+np.array([.48,.29,.30])*shadow
    colors.data[v.index].color=tuple(srgb(float(a)) for a in c)+(1,)
nt=skin.node_tree;attr=nt.nodes.new('ShaderNodeVertexColor');attr.layer_name=colors.name
from face_material import add_lip_shader
add_lip_shader(skin,attr.outputs['Color'])
bsdf(skin).inputs['Roughness'].default_value=.49
bsdf(skin).inputs['Specular IOR Level'].default_value=.3
bsdf(skin).inputs['Subsurface Weight'].default_value=.10
noise=nt.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=540
noise.inputs['Detail'].default_value=2
bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00009;bump.inputs['Strength'].default_value=.16
nt.links.new(noise.outputs['Fac'],bump.inputs['Height']);nt.links.new(bump.outputs['Normal'],bsdf(skin).inputs['Normal'])
print('BAKE_SKIN '+json.dumps(bake_maps.run(low=body.name,maps=['basecolor','normal'],res=2048,samples=16,out=str(ROOT/'textures'),name='Qinglan_Skin')))
tex_link(skin,bpy.data.images['T_Qinglan_Skin_BC'],'Base Color')
tex_link(skin,bpy.data.images['T_Qinglan_Skin_N'],'Normal')
body.data.color_attributes.remove(colors)

# Brown/jade iris fibres in polar space, baked once and shared by both eyes.
mat=bpy.data.materials['M_Iris_Hazel'];nt=mat.node_tree;nodes=nt.nodes;links=nt.links
uv=nodes.new('ShaderNodeTexCoord');sub=nodes.new('ShaderNodeVectorMath');sub.operation='SUBTRACT';sub.inputs[1].default_value=(.5,.5,0)
links.new(uv.outputs['UV'],sub.inputs[0])
sep=nodes.new('ShaderNodeSeparateXYZ');links.new(sub.outputs[0],sep.inputs[0])
ang=nodes.new('ShaderNodeMath');ang.operation='ARCTAN2';links.new(sep.outputs['Y'],ang.inputs[0]);links.new(sep.outputs['X'],ang.inputs[1])
mul=nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=85;links.new(ang.outputs[0],mul.inputs[0])
radius=nodes.new('ShaderNodeVectorMath');radius.operation='LENGTH';links.new(sub.outputs[0],radius.inputs[0])
comb=nodes.new('ShaderNodeCombineXYZ');links.new(mul.outputs[0],comb.inputs['X']);links.new(radius.outputs['Value'],comb.inputs['Y'])
noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=3
links.new(comb.outputs[0],noise.inputs[0])
ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.22;ramp.color_ramp.elements[0].color=(.021,.014,.008,1)
ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(.055,.029,.021,1)
links.new(noise.outputs['Fac'],ramp.inputs[0])
rim=nodes.new('ShaderNodeValToRGB');rim.color_ramp.elements[0].position=.40;rim.color_ramp.elements[0].color=(1,1,1,1)
rim.color_ramp.elements[1].position=.49;rim.color_ramp.elements[1].color=(.18,.18,.18,1);links.new(radius.outputs['Value'],rim.inputs[0])
mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
links.new(ramp.outputs[0],mix.inputs[1]);links.new(rim.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],bsdf(mat).inputs['Base Color'])
print('BAKE_IRIS '+json.dumps(bake_maps.run(low='QL02_Iris_L',maps=['basecolor'],res=1024,samples=16,out=str(ROOT/'textures'),name='Qinglan_Iris')))
tex_link(mat,bpy.data.images['T_Qinglan_Iris_BC'],'Base Color')

# A reusable, tileable technical weave map; no lighting is baked into albedo.
weave=material('M_Weave_Bake',(.7,.7,.7),.46)
nt=weave.node_tree;nodes=nt.nodes;links=nt.links
uv=nodes.new('ShaderNodeTexCoord')
waves=[]
for direction in ['X','Y']:
    w=nodes.new('ShaderNodeTexWave');w.wave_type='BANDS';w.bands_direction=direction
    w.inputs['Scale'].default_value=96;w.inputs['Distortion'].default_value=.06;links.new(uv.outputs['UV'],w.inputs['Vector']);waves.append(w)
mul=nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';links.new(waves[0].outputs['Fac'],mul.inputs[0]);links.new(waves[1].outputs['Fac'],mul.inputs[1])
bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00035;bump.inputs['Strength'].default_value=.25
links.new(mul.outputs[0],bump.inputs['Height']);links.new(bump.outputs[0],bsdf(weave).inputs['Normal'])
rough=nodes.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=0;rough.inputs['From Max'].default_value=1
rough.inputs['To Min'].default_value=.39;rough.inputs['To Max'].default_value=.52
links.new(mul.outputs[0],rough.inputs['Value']);links.new(rough.outputs[0],bsdf(weave).inputs['Roughness'])
plane=mesh_object('TEMP_Weave_Bake',[(0,0,-3),(1,0,-3),(1,1,-3),(0,1,-3)],[(0,1,2,3)],weave,[(0,0),(1,0),(1,1),(0,1)])
print('BAKE_WEAVE '+json.dumps(bake_maps.run(low=plane.name,maps=['normal','roughness'],res=1024,samples=16,out=str(ROOT/'textures'),name='Qinglan_Weave')))
bpy.data.objects.remove(plane,do_unlink=True)
for name in ['M_Ivory_Silk','M_Jade_Silk','M_Deep_Jade_Sash']:
    mat=bpy.data.materials[name]
    tex_link(mat,bpy.data.images['T_Qinglan_Weave_N'],'Normal')
    tex_link(mat,bpy.data.images['T_Qinglan_Weave_R'],'Roughness')
    bsdf(mat).inputs['Specular IOR Level'].default_value=.32
for name in ['M_Obsidian_Hair','M_Hair_Fine_Strands']:
    bsdf(bpy.data.materials[name]).inputs['Specular IOR Level'].default_value=.22
    bsdf(bpy.data.materials[name]).inputs['Anisotropic'].default_value=.3

# References are packed but excluded from renders and GLB selection.
for name,filename in [('REF_Qinglan_Design_Lock','qinglan-design.png'),('REF_Qinglan_Face_Revision2','qinglan-face-target.png')]:
    ref=bpy.data.objects.new(name,None);ref.empty_display_type='IMAGE'
    ref.data=bpy.data.images.load(str(ROOT/'references'/filename));ref.data.pack()
    col('REFERENCES_DoNotExport').objects.link(ref);ref.hide_render=True;ref.hide_set(True)
sc=bpy.context.scene;sc.camera=bpy.data.objects['CAM_Hero'];sc.cycles.use_denoising=True
sc.view_settings.exposure=-.25
sc['asset_status']='High-poly static art candidate; rig, motion and Estella acceptance pending'
sc['priority']='Human and face first; neutral head and complete-body studies are in review/head.'
sc['face_identity_approval']='Approximate original fit to working reference; exact identity approval pending.'
sc['blender_skills_commit']='71d031dab8bc6729504d11a78cbe91945401045f'
for img in bpy.data.images:
    if img.source=='FILE' and img.filepath and img.name.startswith('T_Qinglan'):
        img.pack()
save(ROOT/'qinglan-highpoly.blend')
# Relativize after saving in the final asset folder.
for img in bpy.data.images:
    if img.filepath and img.source=='FILE':img.filepath=bpy.path.relpath(bpy.path.abspath(img.filepath))
save(ROOT/'qinglan-highpoly.blend')
render(bpy.data.objects['CAM_Face'],WORK/'face-final-preview.png',900,1000,64)
render(bpy.data.objects['CAM_Hero'],WORK/'final-preview.png',1024,1400,64)
print('QINGLAN_MATERIALS_SAVED')
