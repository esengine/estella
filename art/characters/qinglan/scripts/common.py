"""Geometry, material and review helpers for the Qinglan reference model."""
import bpy, bmesh, math, json, os
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT.parents[2]/'output/qinglan'
TAU=math.tau

def srgb(c):
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4

def material(name, color, rough=.45, metal=0, sss=0, sheen=0):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_fake_user=True
    mat.diffuse_color=(*color,1)
    bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=tuple(srgb(c) for c in color)+(1,)
    bs.inputs['Roughness'].default_value=rough
    bs.inputs['Metallic'].default_value=metal
    bs.inputs['Subsurface Weight'].default_value=sss
    bs.inputs['Subsurface Radius'].default_value=(1,.45,.28)
    bs.inputs['Subsurface Scale'].default_value=.008
    bs.inputs['Sheen Weight'].default_value=sheen
    return mat

def col(name='QINGLAN_HIGH'):
    co=bpy.data.collections.get(name)
    if not co:
        co=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(co)
    return co

def move_to(ob, collection='QINGLAN_HIGH'):
    for c in list(ob.users_collection): c.objects.unlink(ob)
    col(collection).objects.link(ob)
    return ob

def mesh_object(name, verts, faces, mat, uv=None, sub=0, solid=0):
    me=bpy.data.meshes.new(name+'_mesh'); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); col().objects.link(ob)
    if mat: me.materials.append(mat)
    if uv:
        layer=me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices: layer.data[li].uv=uv[me.loops[li].vertex_index]
    for p in me.polygons: p.use_smooth=True
    bm=bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(me); bm.free()
    if sub:
        m=ob.modifiers.new('Surface subdivision','SUBSURF'); m.levels=min(2,sub); m.render_levels=sub
    if solid:
        m=ob.modifiers.new('Tailored fabric thickness','SOLIDIFY'); m.thickness=solid; m.offset=0
    ob['part_id']=name.split('_')[0]
    return ob

def surface(name, fn, nu, nv, mat, sub=1, solid=.0015, wrap=False):
    verts=[]; uv=[]; faces=[]
    for j in range(nv+1):
        for i in range(nu if wrap else nu+1):
            u=i/nu; v=j/nv; verts.append(tuple(fn(u,v))); uv.append((u,v))
    stride=nu if wrap else nu+1
    for j in range(nv):
        for i in range(nu):
            a=j*stride+i; b=j*stride+(i+1)%stride
            faces.append((a,b,b+stride,a+stride))
    ob=mesh_object(name,verts,faces,mat,uv,sub,solid)
    if wrap:
        layer=ob.data.uv_layers.active
        for p in ob.data.polygons:
            vals=[layer.data[li].uv.x for li in p.loop_indices]
            if max(vals)-min(vals)>.5:
                for li in p.loop_indices:
                    if layer.data[li].uv.x<.5:layer.data[li].uv.x+=1
    return ob

def offset_surface(fn,u,v,distance):
    p=Vector(fn(u,v));du=Vector(fn(u+.0001,v))-Vector(fn(u-.0001,v))
    dv=Vector(fn(u,v+.0001))-Vector(fn(u,v-.0001))
    n=du.cross(dv).normalized()
    center=sum((Vector(fn(q,v)) for q in [0,.25,.5,.75]),Vector())/4
    if n.dot(p-center)<0:n=-n
    return p+n*distance

def curve(name, points, radius, mat, radii=None, collection='QINGLAN_HIGH', res=3, cyclic=False):
    clean=[];clean_r=[]
    for i,p in enumerate(points):
        if not clean or (Vector(p)-Vector(clean[-1])).length>1e-7:
            clean.append(p)
            if radii is not None:clean_r.append(radii[i])
    if len(clean)>2 and (Vector(clean[0])-Vector(clean[-1])).length<1e-7:
        clean.pop();cyclic=True
        if radii is not None:clean_r.pop()
    points=clean
    if radii is not None:radii=clean_r
    data=bpy.data.curves.new(name+'_curve','CURVE'); data.dimensions='3D'
    data.resolution_u=12; data.bevel_depth=radius; data.bevel_resolution=res
    data.use_fill_caps=True
    sp=data.splines.new('BEZIER'); sp.bezier_points.add(len(points)-1)
    sp.use_cyclic_u=cyclic
    for i,(bp,p) in enumerate(zip(sp.bezier_points,points)):
        bp.co=p; bp.handle_left_type='AUTO'; bp.handle_right_type='AUTO'
        if radii is not None: bp.radius=max(radii[i],.00006/radius)
    ob=bpy.data.objects.new(name,data); col(collection).objects.link(ob)
    data.materials.append(mat); ob['part_id']=name.split('_')[0]
    return ob

def ellipsoid(name, center, scale, mat, segments=40, rings=24, sub=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=center)
    ob=bpy.context.object; ob.name=name; ob.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(mat)
    for p in ob.data.polygons:p.use_smooth=True
    if sub:
        m=ob.modifiers.new('Polished surface','SUBSURF');m.levels=sub;m.render_levels=sub
    move_to(ob); ob['part_id']=name.split('_')[0];return ob

def camera(name, location, target, ortho=None, lens=85):
    data=bpy.data.cameras.new(name); ob=bpy.data.objects.new(name,data);col('STUDIO').objects.link(ob)
    ob.location=location; ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    data.lens=lens
    if ortho:data.type='ORTHO';data.ortho_scale=ortho
    data.clip_start=.01;data.clip_end=100
    return ob

def studio():
    sc=bpy.context.scene
    sc.render.engine='CYCLES';sc.cycles.samples=48;sc.cycles.use_denoising=True
    sc.cycles.adaptive_threshold=.04; sc.cycles.max_bounces=8
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='OPTIX';prefs.get_devices()
        for d in prefs.devices:d.use=(d.type=='OPTIX')
        sc.cycles.device='GPU'
    except Exception:sc.cycles.device='CPU'
    sc.world=bpy.data.worlds.new('StudioWorld')
    sc.world.use_nodes=True
    bg=next(n for n in sc.world.node_tree.nodes if n.type=='BACKGROUND')
    bg.inputs[0].default_value=(.22,.26,.30,1);bg.inputs[1].default_value=.35
    for name,loc,power,size,color in [
        ('Key',(-2.3,-3,3.4),380,2.4,(1,.91,.82)),
        ('Fill',(2,-1.5,2),230,2,(.83,.92,1)),
        ('Rim',(.7,1.7,2.8),480,1.8,(.75,.91,1))]:
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
        o=bpy.data.objects.new(name,d);col('STUDIO').objects.link(o);o.location=loc
        o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
    floor=mesh_object('StudioFloor',[(-200,-200,-.0005),(200,-200,-.0005),(200,200,-.0005),(-200,200,-.0005)],[(0,1,2,3)],material('M_Studio',(.24,.29,.31),.8))
    move_to(floor,'STUDIO')
    sc.view_settings.view_transform='AgX'
    sc.view_settings.look='AgX - Medium High Contrast'
    sc.render.image_settings.file_format='PNG'
    sc.render.film_transparent=False
    sc.render.resolution_percentage=100

def render(cam, path, width=900, height=1100, samples=48):
    if os.environ.get('QINGLAN_SKIP_PREVIEW')=='1' and Path(path).parent==WORK:return
    sc=bpy.context.scene;sc.camera=cam;sc.render.resolution_x=width;sc.render.resolution_y=height
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='OPTIX';prefs.get_devices()
        for device in prefs.devices:device.use=(device.type=='OPTIX')
        sc.cycles.device='GPU'
    except Exception:sc.cycles.device='CPU'
    sc.cycles.samples=samples;sc.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)

def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
