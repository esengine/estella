"""Fit the CC0 MPFB base to Qinglan's locked proportions, in background Blender."""
import bpy, addon_utils, os, sys, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parents[2] / 'output' / 'qinglan'
WORK.mkdir(parents=True, exist_ok=True)
MPFB = Path(os.environ['APPDATA']) / 'Blender Foundation/Blender/5.2/extensions/blender_org/mpfb'
addon_utils.enable('bl_ext.blender_org.mpfb', default_set=True, persistent=False)
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0

macro = TargetService.get_default_macro_info_dict()
macro.update(gender=0.0, age=0.30, muscle=0.42, weight=0.34,
             proportions=0.67, height=0.62, cupsize=0.36, firmness=0.55,
             race={'asian': 0.90, 'caucasian': 0.10, 'african': 0.0})
body = HumanService.create_human(mask_helpers=True, macro_detail_dict=macro)
body.name = 'SRC_Qinglan_Parametric'
targets = {'head/head-oval':0.24, 'head/head-scale-horiz-decr':0.12,
           'chin/chin-width-decr':0.18, 'chin/chin-height-decr':0.08,
           'mouth/mouth-scale-horiz-decr':0.12,
           'nose/nose-nostrils-width-decr':0.20}
for target, value in targets.items():
    path = MPFB / 'data/targets' / (target + '.target.gz')
    if path.exists():
        TargetService.load_target(body, str(path), weight=value, name='Qinglan_' + Path(target).name)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
visible = bpy.data.objects.new('QL01_Body', mesh)
bpy.context.scene.collection.objects.link(visible)
visible.matrix_world = body.matrix_world.copy()
# Retain named anatomical groups when evaluating the helper mask.
for group in body.vertex_groups:
    visible.vertex_groups.new(name=group.name)
for p in visible.data.polygons: p.use_smooth = True
zmin = min(v.co.z for v in visible.data.vertices)
zmax = max(v.co.z for v in visible.data.vertices)
scale = 1.72 / (zmax-zmin)
for v in visible.data.vertices:
    v.co = Vector((v.co.x*scale,v.co.y*scale,(v.co.z-zmin)*scale))
visible.location = (0,0,0)
visible['part_id'] = 'QL01'
visible['source_license'] = 'CC0-1.0 (MakeHuman / MPFB core assets)'
visible['design_height_m'] = 1.72
body.hide_render = True
body.hide_set(True)
source_col = bpy.data.collections.new('SOURCE_Parametric_DoNotExport')
bpy.context.scene.collection.children.link(source_col)
for col in list(body.users_collection): col.objects.unlink(body)
source_col.objects.link(body)
source_col.hide_render = True
export_col = bpy.data.collections.new('QINGLAN_HIGH')
bpy.context.scene.collection.children.link(export_col)
for col in list(visible.users_collection): col.objects.unlink(visible)
export_col.objects.link(visible)

groups = {}
for group in visible.vertex_groups:
    verts=[v.co for v in visible.data.vertices if any(g.group==group.index and g.weight>0.1 for g in v.groups)]
    if verts:
        groups[group.name]={'n':len(verts),'min':[round(min(v[i] for v in verts),5) for i in range(3)],
                            'max':[round(max(v[i] for v in verts),5) for i in range(3)],
                            'center':[round(sum(v[i] for v in verts)/len(verts),5) for i in range(3)]}
report={'height_m':1.72,'vertices':len(visible.data.vertices),'faces':len(mesh.polygons),
        'scale':scale,'groups':groups,'materials':[m.name for m in mesh.materials],
        'macro':macro,'targets':targets}
(WORK/'body-landmarks.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'01_body.blend'),compress=True)
print('QINGLAN_BODY '+json.dumps({k:v for k,v in report.items() if k!='groups'}))
