"""Native brush operations for the already-running Blender MCP session.

Import this module in the GUI session. Rendering and auditing use saved copies.
Brush deltas are kept as independent keys, with complete stroke records.
"""
import bpy, json, sys
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
SCRATCH=ROOT.parents[3]/'output/qinglan/live-v6'
SCRATCH.mkdir(parents=True,exist_ok=True)
SKILLS=Path.home()/'.codex/skills'
sys.path += [str(SKILLS/'scenario-blender-expert/scripts'),str(SKILLS/'scenario-blender-sculpting/scripts')]
import bx_gui as G
import bx_sculpt as S
_old_redraw=getattr(G.redraw,'_qinglan_original',G.redraw)
def refresh_view():
    _old_redraw()
    G.view3d()[3].update()
refresh_view._qinglan_original=_old_redraw
G.redraw=refresh_view

def head():
    return bpy.data.objects['Qinglan_Live_Sculpt']

def coords(key):
    a=np.empty(len(key.data)*3,dtype=np.float32)
    key.data.foreach_get('co',a)
    return a.reshape(-1,3)

def prepare(axis='FRONT'):
    ob=head()
    if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    G.set_view(axis,frame=ob)
    w,a,r,v=G.view3d();v.view_distance=.46
    v.view_location=Vector((0,-.05,1.585));v.view_perspective='ORTHO';v.update()
    a.spaces.active.clip_start=.001
    bpy.ops.object.mode_set(mode='SCULPT')
    ob.data.use_mirror_x=True;ob.data.use_mirror_y=False;ob.data.use_mirror_z=False
    G.redraw()

def brush_pass(label,brush,points,size,strength,axis='FRONT',invert=False,snap=True):
    ob=head()
    if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    before=coords(ob.active_shape_key).copy()
    prepare(axis)
    b=S.expert_brush(brush)
    # Native unified settings override stroke-element size in this session.
    unified=bpy.context.tool_settings.sculpt.unified_paint_settings
    unified.use_unified_size=True;unified.size=int(size)
    unified.use_locked_size='VIEW';unified.use_unified_strength=False
    b.size=int(size);b.use_frontface=True
    result,missed=G.stroke('SCULPT',points,size=size,strength=strength,invert=invert,snap=snap)
    bpy.ops.object.mode_set(mode='OBJECT')
    after=coords(ob.active_shape_key);d=np.linalg.norm(after-before,axis=1)
    moved=d>1e-8
    record={'label':label,'brush':brush,'operator':'bpy.ops.sculpt.brush_stroke',
            'result':sorted(result),'axis':axis,'points_world_m':points,
            'size_px':size,'strength':strength,'invert':invert,'snap':snap,'missed_points':missed,
            'key':ob.active_shape_key.name,'moved_vertices':int(moved.sum()),
            'max_move_mm':float(d.max()*1000),
            'affected_bounds':[[float(after[moved,i].min()),float(after[moved,i].max())] for i in range(3)] if moved.any() else None}
    logpath=ROOT/'review/native-brush-log.json'
    log=json.loads(logpath.read_text()) if logpath.exists() else []
    log.append(record);logpath.write_text(json.dumps(log,indent=2))
    print(json.dumps(record))
    return record

def region_mask(zmin,zmax,feather=.004,ymax=-.12):
    ob=head()
    if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    p=coords(ob.active_shape_key)
    def smooth(t):
        t=np.clip(t,0,1);return t*t*(3-2*t)
    weight=smooth((p[:,2]-zmin)/feather)*smooth((zmax-p[:,2])/feather)
    weight*=smooth((ymax-p[:,1])/.008)
    attr=ob.data.attributes.get('.sculpt_mask')
    if attr is None:attr=ob.data.attributes.new('.sculpt_mask','FLOAT','POINT')
    attr.data.foreach_set('value',(1-weight).astype(np.float32));ob.data.update()

def begin_stage(name):
    ob=head()
    if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    keys=ob.data.shape_keys.key_blocks
    assert name not in keys, 'Use a new stage name; never overwrite an existing sculpt pass.'
    values={k.name:k.value for k in list(keys)[1:]}
    key=ob.shape_key_add(name=name,from_mix=True)
    start=coords(key)
    for k in list(keys)[1:-1]:k.value=0
    key.value=1;ob.active_shape_key_index=len(keys)-1
    np.save(SCRATCH/f'{name}-start.npy',start)
    ob['pending_stage']=json.dumps({'name':name,'previous_values':values})

def finish_stage():
    ob=head()
    if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    pending=json.loads(ob['pending_stage']);keys=ob.data.shape_keys.key_blocks
    key=keys[pending['name']]
    start=np.load(SCRATCH/f'{key.name}-start.npy')
    delta=coords(key)-start
    key.data.foreach_set('co',(coords(keys[0])+delta).astype(np.float32).ravel())
    for name,value in pending['previous_values'].items():keys[name].value=value
    del ob['pending_stage'];ob.data.update()
    print(json.dumps({'finished_stage':key.name,'max_delta_mm':float(np.linalg.norm(delta,axis=1).max()*1000)}))
