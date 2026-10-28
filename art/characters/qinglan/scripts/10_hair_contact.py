"""Seat the scalp and fine groom on the fitted head; bake portable hair detail."""
import sys,os,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
from mathutils.bvhtree import BVHTree
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qinglan-highpoly.blend'))
body=bpy.data.objects['QL01_Body'];scalp=bpy.data.objects['QL08_Scalp']
center=Vector((0,-.038,1.618))
bpy.context.view_layer.update();bvh=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
adjusted=0
for v in scalp.data.vertices:
    direction=(v.co-center).normalized();hit=bvh.ray_cast(center,direction)
    if hit[0] and (v.co-center).length<(hit[0]-center).length+.0014:
        v.co=hit[0]+direction*.0014;adjusted+=1
scalp.data.update();bpy.context.view_layer.update()
bvh=BVHTree.FromObject(scalp,bpy.context.evaluated_depsgraph_get())
for ob in bpy.data.objects:
    if not ob.name.startswith('QL08_Scalp_Strand'):continue
    for spline in ob.data.splines:
        for p in spline.bezier_points:
            direction=(p.co-center).normalized()
            # Enter from outside: an inside-out ray would hit Solidify's inner
            # shell and bury the fine strands below the visible scalp surface.
            hit=bvh.ray_cast(center+direction*.5,-direction)
            if hit[0]:p.co=hit[0]+direction*.00055

root=Path(os.environ.get('BLENDER_SKILLS_ROOT',r'D:\tmp\estella-blender-skills-20261028'))/'skills/blender-texture-baking/scripts'
sys.path.insert(0,str(root));import bake_maps
mat=material('M_Hair_Flow_Bake',(.04,.03,.025),.5)
nt=mat.node_tree;nodes=nt.nodes;links=nt.links
bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
uv=nodes.new('ShaderNodeTexCoord');wave=nodes.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction='X'
wave.inputs['Scale'].default_value=135;wave.inputs['Distortion'].default_value=.18;wave.inputs['Detail Scale'].default_value=7
links.new(uv.outputs['UV'],wave.inputs['Vector'])
bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0003;bump.inputs['Strength'].default_value=.5
links.new(wave.outputs['Color'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bs.inputs['Normal'])
plane=mesh_object('TEMP_Hair_Bake',[(0,0,-3),(1,0,-3),(1,1,-3),(0,1,-3)],[(0,1,2,3)],mat,[(0,0),(1,0),(1,1),(0,1)])
print('BAKE_HAIR '+json.dumps(bake_maps.run(low=plane.name,maps=['normal'],res=1024,samples=16,out=str(ROOT/'textures'),name='Qinglan_Hair_Flow')),flush=True)
bpy.data.objects.remove(plane,do_unlink=True)
img=bpy.data.images['T_Qinglan_Hair_Flow_N'];img.pack();img.filepath='//textures/T_Qinglan_Hair_Flow_N.png'
for name in ['M_Obsidian_Hair','M_Hair_Fine_Strands']:
    mat=bpy.data.materials[name];nt=mat.node_tree
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=img
    normal=nt.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.45
    bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    nt.links.new(tex.outputs['Color'],normal.inputs['Color']);nt.links.new(normal.outputs['Normal'],bs.inputs['Normal'])
    bs.inputs['Anisotropic'].default_value=.45;bs.inputs['Roughness'].default_value=.52
save(ROOT/'qinglan-highpoly.blend')
print('HAIR_CONTACT '+json.dumps({'adjusted_scalp_vertices':adjusted}),flush=True)
