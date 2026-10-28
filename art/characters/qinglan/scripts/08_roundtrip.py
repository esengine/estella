"""Re-import the delivered GLB in a clean background process and check it."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
bpy.ops.wm.read_factory_settings(use_empty=True)
path=ROOT/'export/qinglan-static.glb'
assert path.exists() and path.stat().st_size>0
assert bpy.ops.import_scene.gltf(filepath=str(path))=={'FINISHED'}
meshes=[o for o in bpy.data.objects if o.type=='MESH']
assert len(meshes)==12, len(meshes)
points=[];triangles=0
for o in meshes:
    assert all(abs(s-1)<1e-5 for s in o.scale),o.name
    assert all(m is not None for m in o.data.materials),o.name
    assert all(math.isfinite(c) for v in o.data.vertices for c in v.co),o.name
    points.extend(o.matrix_world@v.co for v in o.data.vertices)
    triangles+=sum(len(p.vertices)-2 for p in o.data.polygons)
lo=[min(p[i] for p in points) for i in range(3)]
hi=[max(p[i] for p in points) for i in range(3)]
dim=[hi[i]-lo[i] for i in range(3)]
assert 1.78<dim[2]<1.84,dim
assert abs(lo[2])<.002,lo
images=[i for i in bpy.data.images if i.type=='IMAGE']
assert images and all(i.size[0]>0 and i.size[1]>0 for i in images)
report={'pass':True,'file':path.name,'file_bytes':path.stat().st_size,'meshes':len(meshes),
        'triangles':triangles,'materials':len(bpy.data.materials),'images':len(images),
        'dimensions_m':dim,'ground_z':lo[2],
        'skins':0,'animations':0,'scope':'Blender GLB import round-trip; not Estella or device acceptance'}
(ROOT/'review/roundtrip-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
studio();bpy.context.scene.view_settings.exposure=-.25
cam=camera('Roundtrip_Hero',(2.55,-5.8,2.3),(0,-.015,.94),ortho=2.08)
render(cam,ROOT/'review/glb-roundtrip.png',1000,1350,64)
print('ROUNDTRIP '+json.dumps(report),flush=True)
