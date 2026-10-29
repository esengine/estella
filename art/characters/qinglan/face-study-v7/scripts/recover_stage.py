"""Validate and recover the last stage copy after a lost live session."""
import bpy,sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT/'scripts'))
import identity_cage as I
source=I.OUT/'02-cheek-continuity.blend'
bpy.ops.wm.open_mainfile(filepath=str(source))
head=bpy.data.objects['Qinglan_Identity_Cage']
keys=[(k.name,k.value) for k in head.data.shape_keys.key_blocks if k.name.startswith('V7_')]
assert len(keys)==6 and all(v==1 for _,v in keys)
assert all(bpy.data.objects.get('Qinglan_Brow_Proxy_'+side) for side in ('L','R'))
print('RECOVERED_STATE '+json.dumps(keys),flush=True)
# V5/V6 remain in their original files. Drop only redundant hidden objects
# from this candidate, reducing the saved dependency graph and file size.
for name in ('Qinglan_Head_Multires','Qinglan_Live_Sculpt','Inspection_Cage','Inspection_High'):
    ob=bpy.data.objects.get(name)
    if ob and ob.hide_render:
        mesh=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
        if mesh.users==0:bpy.data.meshes.remove(mesh)
I.save_main()
print('RECOVERY_SAVED',flush=True)
