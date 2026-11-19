"""Project the three registered paint plates onto the existing skinned UV atlas in Blender."""
import json
import math
import os
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

project = Path(__file__).resolve().parents[1]
art = project / "source/paint"
review = project.parents[1] / "output/windrise/polish/art"
review.mkdir(parents=True, exist_ok=True)
base_file = Path(os.environ.get("WINDRISE_BIND_SOURCE", project / "source/lumine.blend"))
bpy.ops.wm.open_mainfile(filepath=str(base_file))
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
mesh = next(o for o in scene.objects if o.type == "MESH")
rig = next(o for o in scene.objects if o.type == "ARMATURE")
if mesh.get("windrise_paint") is not None:
    raise RuntimeError("Use the repaired bind mesh from finish-character.py as the projection source")
rig.data.pose_position = "REST"
bpy.context.view_layer.update()
mat = mesh.data.materials[0]
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
surface = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
base = bsdf.inputs["Base Color"].links[0].from_node
atlas_uv = mesh.data.uv_layers.active.name
# The six bridge faces of the old narrow ribbons cross unrelated UV islands.
# Replace the pair with their own continuous fabric and texture coordinates.
bm = bmesh.new()
bm.from_mesh(mesh.data)
unseen = set(bm.verts)
old_ribbons = set()
while unseen:
    stack = [unseen.pop()]
    island = {stack[0]}
    while stack:
        v = stack.pop()
        group = {e.other_vert(v) for e in v.link_edges} & unseen
        island.update(group)
        unseen.difference_update(group)
        stack.extend(group)
    if 85 <= len(island) <= 110 and min(v.co.z for v in island) < .54 and max(v.co.z for v in island) > 1.3:
        old_ribbons.update(island)
assert len(old_ribbons) == 198, "Expected both repaired shoulder ribbons in the bind source"
bmesh.ops.delete(bm,geom=list(old_ribbons),context="VERTS")
bm.to_mesh(mesh.data)
bm.free()
mesh.data.update()
positions = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
bvh = BVHTree.FromPolygons(positions, [list(p.vertices) for p in mesh.data.polygons])


def smooth(a, b, value):
    t = max(0, min(1, (value-a)/(b-a)))
    return t*t*(3-2*t)


def visible(p, side):
    # At silhouette vertices use the neighbouring rays as well. A hidden back layer
    # under the fringe or dress should keep the original UV island colour.
    gaps = []
    for shift in (0, .00019, -.00019):
        hit, _, _, _ = bvh.ray_cast(Vector((side*3, p.y+shift, p.z)), Vector((-side, 0, 0)))
        if hit is not None:
            gaps.append(max(0, (hit.x-p.x)*side))
    return 1 - smooth(.002, .013, min(gaps, default=1))


temporary = []
def node(kind):
    item = nodes.new(kind)
    temporary.append(item)
    return item


original_uv = node("ShaderNodeUVMap")
original_uv.uv_map = atlas_uv
links.new(original_uv.outputs["UV"], base.inputs["Vector"])
color = base.outputs["Color"]
layers = []
masks = []
plates = []
report = {}
# Paint broad clothing before the overlapping head and neck crop.
for name, side, center_z, span, height_range in [
    ("dress", 1, .89, 1.04, (.38, .44, 1.29, 1.39)),
    ("back", -1, .91, 1.12, (.36, .43, 1.36, 1.445)),
    ("face", 1, 1.47, .54, (1.209, 1.266, 1.72, 1.74)),
]:
    layer = mesh.data.uv_layers.new(name="Paint " + name, do_init=False)
    layers.append(layer.name)
    uv = np.array([(.5+side*positions[loop.vertex_index].y/span,
                    .5+(positions[loop.vertex_index].z-center_z)/span)
                   for loop in mesh.data.loops], dtype=np.float32)
    layer.data.foreach_set("uv", uv.ravel())
    weights = []
    z0, z1, z2, z3 = height_range
    for vertex, p in zip(mesh.data.vertices, positions):
        h = smooth(z0,z1,p.z)*(1-smooth(z2,z3,p.z))
        facing = smooth(-.10, .41, vertex.normal.x*side)
        weights.append(h*facing*visible(p,side) if h*facing > 0 else 0)
    mask = mesh.data.attributes.new("Visible " + name, "FLOAT", "POINT")
    mask.data.foreach_set("value", np.asarray(weights, dtype=np.float32))
    masks.append(mask.name)
    mapping = node("ShaderNodeUVMap")
    mapping.uv_map = layer.name
    plate = node("ShaderNodeTexImage")
    plate.image = bpy.data.images.load(str(art / ("back-body.png" if name=="back" else name+".png")))
    plates.append(plate.image)
    plate.extension = "CLIP"
    links.new(mapping.outputs["UV"], plate.inputs["Vector"])
    amount = node("ShaderNodeAttribute")
    amount.attribute_name = mask.name
    mix = node("ShaderNodeMixRGB")
    links.new(amount.outputs["Fac"], mix.inputs[0])
    links.new(color, mix.inputs[1])
    links.new(plate.outputs["Color"], mix.inputs[2])
    color = mix.outputs["Color"]
    report[name] = sum(w > .5 for w in weights)

mesh.data.uv_layers.active = mesh.data.uv_layers[atlas_uv]
mesh.data.uv_layers[atlas_uv].active_render = True
emission = node("ShaderNodeEmission")
links.new(color, emission.inputs["Color"])
links.new(emission.outputs[0], surface.inputs["Surface"])
width, height = base.image.size
baked = bpy.data.images.new("Windrise paint bake", width, height, alpha=False)
target = node("ShaderNodeTexImage")
target.image = baked
nodes.active = target
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
bpy.ops.object.bake(type="EMIT", margin=16, margin_type="EXTEND", use_clear=True)
atlas_path = review / "lumine-painted.jpg"
baked.filepath_raw = str(atlas_path)
baked.file_format = "JPEG"
scene.render.image_settings.quality = 95
baked.save()
previous = base.image
base.image = bpy.data.images.load(str(atlas_path))
base.image.pack()
base.image.filepath_raw = "//lumine-painted.jpg"
base.image.name = "Lumine painted albedo"
for item in reversed(temporary):
    nodes.remove(item)
links.new(bsdf.outputs["BSDF"], surface.inputs["Surface"])
for name in layers:
    mesh.data.uv_layers.remove(mesh.data.uv_layers[name])
for name in masks:
    mesh.data.attributes.remove(mesh.data.attributes[name])
for image in [baked, previous, *plates]:
    if image.users == 0:
        bpy.data.images.remove(image)

for v,p in zip(mesh.data.vertices,positions):
    x,y,z = p
    hem = smooth(.485,.558,z)*(1-smooth(.62,.91,z))*(1-smooth(-.119,-.064,x))
    v.co.z -= .064*hem
    v.co.y += .064*y*hem
    # Develop the nose bridge and chin in profile by millimetres, keeping the
    # reference eye spacing, temples and hairline at their original anchors.
    face = smooth(.060,.108,x)
    nose = math.exp(-(y/.019)**2-((z-1.480)/.027)**2)
    chin = math.exp(-(y/.055)**2-((z-1.419)/.021)**2)
    v.co.x += face*(.0033*nose+.0014*chin)
    v.co.y *= 1-.034*face*math.exp(-((z-1.438)/.035)**2)
mesh.data.update()
mesh["windrise_paint"] = 1

# Rear-view pixel landmarks on the 1024-square guide and the measured cloth
# depth in metres. Each row runs from the outer edge to the inner piping.
rows = np.array([
    (67,495,511,-.066),(74,487,506,-.066),(87,470,496,-.081),(106,457,489,-.095),
    (151,439,476,-.113),(190,418,454,-.125),(220,405,438,-.133),
    (260,393,419,-.143),(300,380,409,-.154),(345,365,401,-.166),
    (405,341,392,-.179),(470,311,381,-.195),(540,279,363,-.214),
    (600,254,343,-.229),(660,232,319,-.244),(715,215,288,-.251),
    (765,208,250,-.251),(800,210,231,-.246),(819,216,223,-.242),
    (830,212,228,-.243),(846,200,234,-.247),(871,218,220,-.248),
], dtype=float)
cloth_pos, cloth_faces, cloth_uv = [], [], []
for side in [1,-1]:
    previous_row = None
    for level in sorted(set(rows[:,0]).union(range(75,871,9))):
        lo,hi,depth = [np.interp(level, rows[:,0], rows[:,axis]) for axis in [1,2,3]]
        z = .91+(.5-level/1024)*1.12
        # Trace the mantle over the shoulders, then let the weighted tip hang below the skirt.
        z -= .076*(1-smooth(.52,1.01,z))
        row = []
        for back in [0,1]:
            for col in [0,.5,1]:
                px=(lo+(hi-lo)*col)/1024
                py=(.5-px)*1.12*side
                fold=smooth(193,530,level)*(1-smooth(756,862,level))
                x=depth-.0045*math.sin(col*math.pi)+((col-.5)*.091-.036)*fold
                if level < 154:
                    hit,_,_,_=bvh.ray_cast(Vector((-2,py,z)),Vector((1,0,0)))
                    if hit is not None:
                        follow=1-smooth(91,154,level)
                        x=x*(1-follow)+(hit.x-.001)*follow
                x+=.0031*back
                row.append(len(cloth_pos))
                cloth_pos.append((x,py,z))
                cloth_uv.append((px if side==1 else 1-px,1-level/1024))
        if previous_row is None:
            for c in [0,1]:
                cloth_faces.append((row[c],row[c+1],row[c+4],row[c+3]))
        else:
            for c,d in [(0,1),(1,2),(2,5),(5,4),(4,3),(3,0)]:
                cloth_faces.append((previous_row[c],previous_row[d],row[d],row[c]))
        previous_row=row
    for c in [0,1]:
        cloth_faces.append((row[c+3],row[c+4],row[c+1],row[c]))
cloth_data=bpy.data.meshes.new("Split shoulder ribbons")
cloth_data.from_pydata(cloth_pos,[],cloth_faces)
cloth_data.update()
cloth=bpy.data.objects.new("Lumine shoulder ribbons",cloth_data)
scene.collection.objects.link(cloth)
cloth.parent=mesh.parent
cloth.matrix_parent_inverse=mesh.matrix_parent_inverse.copy()
cloth.matrix_basis=mesh.matrix_basis.copy()
weight=cloth.vertex_groups.new(name="mixamorig:Spine2")
weight.add(list(range(len(cloth_pos))),1,"REPLACE")
armature=cloth.modifiers.new("Traveler armature","ARMATURE")
armature.object=rig
uv=cloth_data.uv_layers.new(name="Ribbon paint")
for loop in cloth_data.loops:
    uv.data[loop.index].uv=cloth_uv[loop.vertex_index]
bm=bmesh.new()
bm.from_mesh(cloth_data)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(cloth_data)
bm.free()
for poly in cloth_data.polygons:
    poly.use_smooth=True
silk=bpy.data.materials.new("Ivory silk and gold")
silk.use_nodes=True
silk_image=silk.node_tree.nodes.new("ShaderNodeTexImage")
silk_image.image=bpy.data.images.load(str(art/"back.png"))
silk_image.image.pack()
silk_image.image.filepath_raw="//paint/back.png"
silk_shader=silk.node_tree.nodes.get("Principled BSDF")
silk_shader.inputs["Roughness"].default_value=.83
silk.node_tree.links.new(silk_image.outputs["Color"],silk_shader.inputs["Base Color"])
cloth_data.materials.append(silk)
rig.data.pose_position = "POSE"
bpy.context.view_layer.update()
sys.path.insert(0,os.environ.get("BLENDER_REVIEW_TOOLS",str(Path.home()/".codex/skills/scenario-blender-expert/scripts")))
import bx_audit
gate = bx_audit.deliverable([mesh,cloth],profile="game")
if not gate["pass"]:
    raise RuntimeError(str(gate["errors"]))
audit = json.loads((project/"source/character-audit.json").read_text(encoding="utf8"))
audit.update(gate=gate, paintedVisibleVertices=report, ribbonVertices=len(cloth_pos))
(project/"source/character-audit.json").write_text(json.dumps(audit,indent=2)+"\n", encoding="utf8")
bpy.ops.wm.save_as_mainfile(filepath=str(project/"source/lumine.blend"))
bpy.ops.export_scene.gltf(filepath=str(project/"assets/character/lumine-final.glb"), export_format="GLB",
                          export_animation_mode="NLA_TRACKS",export_animations=True,export_skins=True,export_yup=True)
print("PAINT",json.dumps({"gates":gate["pass"],"warnings":gate["warnings"],"covered":report,"actions":len(bpy.data.actions)}))
