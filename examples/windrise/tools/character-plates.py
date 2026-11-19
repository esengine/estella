"""Make texture-only orthographic guides aligned to the bind mesh for projection painting."""
import bpy, json, os
from mathutils import Vector
from pathlib import Path

project=Path(__file__).resolve().parents[1]
output=Path(os.environ.get('WINDRISE_PLATE_OUTPUT',project.parents[1]/'output/windrise/polish/art'))
output.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(project/'source/lumine.blend'))
scene=bpy.context.scene
meshes=[o for o in scene.objects if o.type=='MESH']
rig=next(o for o in scene.objects if o.type=='ARMATURE')
rig.data.pose_position='REST'
for mat in {material for mesh in meshes for material in mesh.data.materials}:
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    base=bsdf.inputs['Base Color'].links[0].from_node
    shader=mat.node_tree.nodes.new('ShaderNodeEmission')
    surface=next(n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL')
    mat.node_tree.links.new(base.outputs['Color'],shader.inputs['Color'])
    mat.node_tree.links.new(shader.outputs[0],surface.inputs['Surface'])
scene.render.engine='CYCLES';scene.cycles.samples=2
scene.world=bpy.data.worlds.new('Neutral guide');scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.15,.16,.17,1)
scene.view_settings.view_transform='Standard'
camera=bpy.data.objects.new('Projection Camera',bpy.data.cameras.new('Orthographic guides'));scene.collection.objects.link(camera);scene.camera=camera
camera.data.type='ORTHO';camera.data.clip_start=.01
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
targets=[('face',1,1.47,.54,1024,1024),('dress',1,.89,1.04,1024,1024),('back',-1,.91,1.12,1024,1024)]
for name,side,z,span,width,height in targets:
    camera.location=(side*4,0,z);camera.rotation_euler=Vector((-side,0,0)).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale=span;scene.render.resolution_x=width;scene.render.resolution_y=height
    scene.render.filepath=str(output/(name+'-guide.png'));bpy.ops.render.render(write_still=True)
print('GUIDES',json.dumps({'meshes':[o.name for o in meshes],'targets':targets}))
