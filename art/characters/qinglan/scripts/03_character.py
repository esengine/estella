"""Construct Qinglan's reference-driven garment patterns and surface details."""
import sys, math, json, os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *
from mathutils.bvhtree import BVHTree

bpy.ops.wm.open_mainfile(filepath=str(WORK/'01_body.blend'))
body=bpy.data.objects['QL01_Body']
joints=json.loads((WORK/'joints.json').read_text())

ivory=material('M_Ivory_Silk',(.90,.875,.81),.39,sheen=.32)
jade=material('M_Jade_Silk',(.13,.315,.34),.47,sheen=.18)
dark=material('M_Deep_Jade_Sash',(.12,.245,.26),.33,sheen=.22)
gold=material('M_Champagne_Gold',(.80,.69,.46),.27,metal=1)
thread=material('M_Pale_Gold_Embroidery',(.77,.66,.46),.48,metal=.0,sheen=.35)
gem=material('M_Polished_Jade',(.39,.66,.57),.20,sss=.12)
hairmat=material('M_Obsidian_Hair',(.060,.049,.047),.46)
hairglint=material('M_Hair_Fine_Strands',(.085,.066,.059),.48)
skin=material('M_Skin',(.82,.65,.56),.47,sss=.13)
lip=material('M_Rose_Lips',(.62,.32,.30),.39,sss=.06)
nail=material('M_Natural_Nails',(.81,.62,.57),.28)
eye_white=material('M_Eye_Sclera',(.83,.81,.75),.16)
iris=material('M_Iris_Hazel',(.28,.22,.15),.20)
black=material('M_Pupil',(.012,.009,.008),.13)

# Pose the fitted base to the reference's relaxed sleeves. Distance-weighted
# blending preserves the original MakeHuman topology and named source mesh.
for sign,label in [(1,'l'),(-1,'r')]:
    s=Vector(joints[f'joint-{label}-shoulder']['center'])
    e=Vector(joints[f'joint-{label}-elbow']['center'])
    w=Vector(joints[f'joint-{label}-hand']['center'])
    td=Vector((sign*.39,0,-.921)).normalized()
    et=s+td*(e-s).length
    wt=et+Vector((sign*.33,-.065,-.942)).normalized()*(w-e).length
    r1=(e-s).rotation_difference(et-s)
    wr=s+r1@(w-s)
    r2=(wr-et).rotation_difference(wt-et)
    for v in body.data.vertices:
        p=v.co.copy()
        if sign*p.x<.135 or p.z<.78: continue
        # Below the chest, only the outboard arm/hand corridor may rotate.
        # The original broad shoulder falloff must never capture the thighs.
        if p.z<1.12 and sign*p.x<.25:continue
        shoulder_weight=max(0,min(1,(sign*p.x-.135)/.085))
        # Upper-arm / forearm junction only; the wrist and all finger loops move rigidly.
        t=(p-e).dot(w-e)/(w-e).length_squared
        fore_weight=max(0,min(1,(t+.16)/.32))
        p1=s+r1@(p-s)
        p2=et+r2@(p1-et)
        v.co=p.lerp(p1.lerp(p2,fore_weight),shoulder_weight)
    joints[f'posed-{label}-elbow']=list(et)
    joints[f'posed-{label}-wrist']=list(wt)

from face_fit import fit_head,make_eye_details
fit_head(body)

# Save the complete fitted base in the source collection; show only skin that
# can be seen through the neckline and cuffs in the dressed version.
source=body.copy();source.data=body.data.copy();source.name='SRC_Qinglan_Fitted_Complete'
col('SOURCE_Parametric_DoNotExport').objects.link(source);source.hide_render=True;source.hide_set(True)
visible=body.vertex_groups.new(name='Visible_Head_Neck_Hands')
for v in body.data.vertices:
    x,y,z=v.co
    half_open=.064*math.sqrt(max(0,1-(max(0,(1.455-z)/.182)**(2/7))))+.009
    neckline=(z>1.268 and abs(x)<max(half_open,.082 if z>1.36 else .047) and (y<0 or z>1.455))
    if z>1.48 or neckline or (abs(x)>.27 and z<1.04):visible.add([v.index],1,'REPLACE')
mask=body.modifiers.new('Hidden skin under complete costume','MASK');mask.vertex_group=visible.name
body.data.materials.clear()
for m in [skin,lip,nail]:body.data.materials.append(m)
lipgroup=body.vertex_groups.get('lips');nailgroup=body.vertex_groups.get('fingernails')
lipverts=set();nailverts=set()
for v in body.data.vertices:
    for g in v.groups:
        if lipgroup and g.group==lipgroup.index:lipverts.add(v.index)
        if nailgroup and g.group==nailgroup.index:nailverts.add(v.index)
for p in body.data.polygons:
    if all(i in lipverts for i in p.vertices):p.material_index=1
    if nailverts and all(i in nailverts for i in p.vertices):p.material_index=2
mod=body.modifiers.new('Anatomical surface','SUBSURF');mod.levels=2;mod.render_levels=3

make_eye_details(body,hairmat,eye_white,iris,black)

# Torso loft: the top boundary opens into a V; the back and shoulders stay covered.
def bodice(u,v):
    a=u*TAU;ct=math.cos(a);st=math.sin(a)
    top=1.455-.182*max(ct,0)**7
    z=1.105+(top-1.105)*v
    keys=[1.105,1.16,1.23,1.30,1.36,1.40,1.455]
    rx=float(np.interp(z,keys,[.140,.145,.166,.18,.196,.198,.061]))
    ry=float(np.interp(z,keys,[.094,.098,.145,.145,.095,.075,.052]))
    if ct<0:ry*=.65
    t=max(0,(v-.92)/.08)**2
    rx=rx*(1-t)+.064*t
    ry=ry*(1-t)+(.055+.075*max(ct,0)**3)*t
    wrinkle=.0016*math.sin(6*a+v*9)*math.sin(v*math.pi)**2
    return ((rx+wrinkle)*st,-.019-(ry+wrinkle)*ct,z)
robe=surface('QL03_Wrap_Bodice',bodice,128,48,ivory,sub=2,solid=.002,wrap=True)
# Sample the loft directly for the lapels so they remain outside the white fabric.
dg=bpy.context.evaluated_depsgraph_get();bpy.context.view_layer.update()
bvh=BVHTree.FromObject(robe,dg)
def front_y(x,z,offset=.004):
    hit=bvh.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))
    return hit[0].y-offset if hit[0] else -.09-offset

def collar(u,v):
    a=u*TAU;p=Vector(bodice(u,.895+.105*v))
    return p+Vector((math.sin(a),-math.cos(a),.15))*.0035
surface('QL03_Jade_Collar',collar,160,10,jade,sub=1,solid=.001,wrap=True)
for edge in [0,1]:curve('QL03_Collar_Piping',[collar(i/180,edge) for i in range(180)],.0008,gold,res=2,cyclic=True)
def crossing(u,v):
    x=.112*v+(u-.5)*.031;z=1.275-.168*v
    return (x,front_y(x,z,.006),z)
surface('QL03_Crossed_Lapel',crossing,8,36,jade,sub=1,solid=.001)
for edge in [0,1]:curve('QL03_Lapel_Seam',[Vector(crossing(edge,i/70))+Vector((0,-.0016,0)) for i in range(71)],.0008,gold,res=2)

# Pleated white under-skirt and independent split jade overskirt patterns.
def skirt_radius(t):
    t=max(0,t)
    return .141+.205*(t**.75), .103+.168*(t**.80)
def underskirt(u,v):
    a=u*TAU;rx,ry=skirt_radius(v)
    pleat=(.003+.010*v)*math.cos(56*a+0.35*math.sin(v*4))
    z=1.112-1.065*v+.006*(v**5)*math.cos(14*a)
    return ((rx+pleat)*math.sin(a),-.008-(ry+pleat)*math.cos(a),z)
surface('QL05_Pleated_Underskirt',underskirt,224,54,ivory,sub=2,solid=.0016,wrap=True)
for vv in [.962,.984]:
    curve('QL05_Underskirt_Hem',[offset_surface(underskirt,i/224,vv,.0023) for i in range(224)],.00065,thread,cyclic=True,res=2)

panel_functions=[]
for sign in [-1,1]:
    def panel(u,v,sign=sign):
        a=sign*(.48+(math.pi-.53)*u)
        end=.085+.145*(1-u)**2
        z=1.115-(1.115-end)*v
        t=(1.112-z)/1.065
        rx,ry=skirt_radius(t)
        fold=.0055*math.sin(9*a+2*v)*math.sin(v*math.pi/2)
        return ((rx+.013+fold)*math.sin(a),-.008-(ry+.013+fold)*math.cos(a),z)
    panel_functions.append(panel)
    surface('QL06_Jade_Overpanel_'+str(sign),panel,64,44,jade,sub=2,solid=.002)
    def panel_trim(u,v):
        p=Vector(panel(u,v));d=.0001
        du=Vector(panel(min(1,u+d),v))-Vector(panel(max(0,u-d),v))
        dv=Vector(panel(u,min(1,v+d)))-Vector(panel(u,max(0,v-d)))
        normal=du.cross(dv).normalized()
        if normal.dot(Vector((p.x,p.y+.008,0)))<0:normal=-normal
        return p+normal*.0025
    for edge in [0,1]:
        curve('QL06_Gold_Vertical_Edge',[panel_trim(edge,j/100) for j in range(101)],.0008,gold,res=3)
    for vv in [1,.97]:curve('QL06_Gold_Hem',[panel_trim(i/130,vv) for i in range(131)],.0008,gold,res=2)

# Tailored bell sleeves: elliptical section hangs below the arm line.
sleeve_functions=[]
for sign,label in [(1,'l'),(-1,'r')]:
    s=Vector((sign*.127,-.017,1.374));w=Vector(joints[f'posed-{label}-wrist'])
    end=s+(w-s)*.91
    d=(end-s).normalized();up=Vector((sign*.918,0,.396));front=Vector((0,-1,0))
    def sleeve(u,v,s=s,end=end,up=up,front=front,sign=sign):
        a=u*TAU;c=s.lerp(end,v)
        c.z-=.067*(v**2)
        width=.050+.123*(v**1.35);depth=.052+.075*v
        fold=(.002+.003*v)*math.cos(12*a+v*5)
        return c+up*((width+fold)*math.cos(a))+front*((depth+fold)*math.sin(a))
    sleeve_functions.append(sleeve)
    surface('QL04_Bell_Sleeve_'+label,sleeve,112,40,ivory,sub=2,solid=.0017,wrap=True)
    def cuff(u,v,fn=sleeve,up=up,front=front):
        a=u*TAU;p=Vector(fn(u,.875+.115*v))
        return p+(up*math.cos(a)+front*math.sin(a))*.0035
    surface('QL04_Jade_Cuff_'+label,cuff,112,10,jade,sub=1,solid=.001,wrap=True)
    for vv in [.875,.99]:curve('QL04_Cuff_Gold_Edge',[offset_surface(sleeve,i/140,vv,.0047) for i in range(140)],.0008,gold,res=2,cyclic=True)

def sash(u,v):
    a=u*TAU;rx=.146+.004*math.sin(v*math.pi);ry=.102+.004*math.sin(v*math.pi)
    return (rx*math.sin(a),-.018-ry*math.cos(a),1.088+.087*v)
surface('QL07_Waist_Sash',sash,128,14,dark,sub=2,solid=.003,wrap=True)
for vv in [0,.08,.92,1]:curve('QL07_Sash_Raised_Seam',[sash(i/140,vv) for i in range(140)],.0009,gold,res=2,cyclic=True)

# Fitted ivory boots mostly hidden by the skirt, with small soles touching Z=0.
for sign in [-1,1]:
    ellipsoid('QL12_Embroidered_Boot_'+str(sign),(sign*.169,-.103,.057),(.062,.143,.055),ivory,48,24,2)
    sole=ellipsoid('QL12_Boot_Sole_'+str(sign),(sign*.169,-.102,.014),(.064,.143,.014),dark,48,16,1)
    for vert in sole.data.vertices:
        if vert.co.z+sole.location.z<.011:vert.co.z=-sole.location.z

studio()
camera('CAM_Front',(0,-4,1.1),(0,0,.92),ortho=2.08)
camera('CAM_Side',(4,0,1.1),(0,0,.92),ortho=2.08)
camera('CAM_Back',(0,4,1.1),(0,0,.92),ortho=2.08)
hero=camera('CAM_Hero',(2.55,-5.8,2.3),(0,-.015,.94),ortho=2.08,lens=85)
camera('CAM_Face',(0,-2,1.62),(0,-.04,1.62),ortho=.47)
camera('CAM_Face34',(.40,-.85,1.64),(0,-.03,1.60),lens=100)
save(WORK/'03_costume.blend')
render(hero,WORK/'costume-preview.png',900,1250,32)
print('QINGLAN_COSTUME_SAVED')
