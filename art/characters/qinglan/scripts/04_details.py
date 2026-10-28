"""Groom hair and place Qinglan's lotus/cloud motifs from the design sheet."""
import sys,math,random
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from common import *

bpy.ops.wm.open_mainfile(filepath=str(WORK/'03_costume.blend'))
mats={m.name:m for m in bpy.data.materials}
gold=mats['M_Champagne_Gold'];thread=mats['M_Pale_Gold_Embroidery']
gem=mats['M_Polished_Jade'];hair=mats['M_Obsidian_Hair'];glint=mats['M_Hair_Fine_Strands']
jade=mats['M_Jade_Silk'];dark=mats['M_Deep_Jade_Sash'];ivory=mats['M_Ivory_Silk']
random.seed(23)

def catmull(points,t):
    pts=[Vector(p) for p in points];q=max(0,min(.999999,t))*(len(pts)-1);i=int(q);f=q-i
    a=pts[max(0,i-1)];b=pts[i];c=pts[min(len(pts)-1,i+1)];d=pts[min(len(pts)-1,i+2)]
    return .5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f)

def lock(name,points,width,depth,mat=hair,n=64,nr=12):
    vs=[];uv=[];fs=[]
    for j in range(n+1):
        t=j/n;c=catmull(points,t)
        tangent=(catmull(points,min(1,t+.002))-catmull(points,max(0,t-.002))).normalized()
        axis=Vector((1,0,0));axis=(axis-tangent*axis.dot(tangent)).normalized()
        dep=tangent.cross(axis).normalized()
        taper=max(.025,math.sin(math.pi*(.07+.93*t))**.45)
        for i in range(nr):
            a=TAU*i/nr
            vs.append(c+axis*(width*taper*math.cos(a))+dep*(depth*taper*math.sin(a)))
            uv.append((i/nr,t))
    for j in range(n):
        for i in range(nr):
            a=j*nr+i;b=j*nr+(i+1)%nr;fs.append((a,b,b+nr,a+nr))
    vs.extend([catmull(points,0),catmull(points,1)]);uv.extend([(.5,0),(.5,1)])
    for i in range(nr):
        fs.append((len(vs)-2,(i+1)%nr,i))
        fs.append((len(vs)-1,n*nr+i,n*nr+(i+1)%nr))
    return mesh_object(name,vs,fs,mat,uv,sub=1)

# Scalp boundary: a center part, high forehead, tapered temples, low back hairline.
def scalp(u,v):
    a=u*TAU
    pmax=1.66-.49*math.cos(a)+.055*math.exp(-(math.sin(a)/.20)**2)*max(math.cos(a),0)
    phi=pmax*v
    return Vector((.087*math.sin(phi)*math.sin(a),-.038-.108*math.sin(phi)*math.cos(a),1.618+.116*math.cos(phi)))
vs=[(0,-.038,1.734)];uv=[(.5,0)];fs=[];nu=160;nv=38
for j in range(1,nv+1):
    for i in range(nu):vs.append(scalp(i/nu,j/nv));uv.append((i/nu,j/nv))
for i in range(nu):fs.append((0,1+i,1+(i+1)%nu))
for j in range(nv-1):
    for i in range(nu):
        a=1+j*nu+i;b=1+j*nu+(i+1)%nu;fs.append((a,b,b+nu,a+nu))
mesh_object('QL08_Scalp',vs,fs,hair,uv,sub=1,solid=.001)

for i in range(180):
    u=(i+.3)/180
    pts=[]
    for j in range(26):
        v=.995-.92*j/25
        p=scalp(u+.016*math.sin(v*math.pi),v)
        p+=Vector((p.x,p.y+.038,(p.z-1.618)*.6)).normalized()*.00025
        pts.append(p)
    curve('QL08_Scalp_Strand',pts,.00012,glint if i%7==0 else hair,res=1)

ellipsoid('QL08_High_Bun',(0,.018,1.760),(.044,.046,.050),hair,64,40,2)
for i in range(38):
    phase=i*TAU/38;pts=[]
    for j in range(41):
        t=j/40;ang=-1.49+2.98*t
        pts.append((.0445*math.cos(ang)*math.cos(phase),.018+.047*math.cos(ang)*math.sin(phase),1.760+.051*math.sin(ang)))
    curve('QL08_Bun_Filament',pts,.00018,glint if i%5==0 else hair,res=1)

for i in range(19):
    x=(i-9)*.0102;phase=i*.7;variation=random.uniform(-.025,.025)
    pts=[(x*.72,.043,1.665),
         (x,.077+abs(x)*.06,1.54),
         (x*1.12+.006*math.sin(phase),.099,1.38),
         (x*1.17+.012*math.sin(phase+1),.113,1.20),
         (x*1.20+.009*math.sin(phase+2),.131,1.02+variation)]
    lock('QL08_Long_Back_Lock',pts,.0125,.0075,n=78)
    for k in [-.6,0,.6]:
        strand=[]
        for j in range(40):
            t=j/39;p=catmull(pts,t)
            p.x+=k*.012*max(.05,math.sin(math.pi*(.06+.94*t))**.4);p.y+=.0075
            strand.append(p)
        curve('QL08_Back_Fine_Strand',strand,.0003,glint,res=1)
for sign in [-1,1]:
    for i in range(3):
        pts=[(sign*(.019+i*.004),-.091,1.715-i*.002),
             (sign*(.060+i*.005),-.133,1.673-i*.005),
             (sign*(.079+i*.004),-.111,1.584),
             (sign*(.083+i*.006),-.081,1.481),
             (sign*(.104+i*.005),-.092,1.365-i*.025)]
        lock('QL08_Face_Frame',pts,.0051,.0023,n=72)
        curve('QL08_Face_Flyaway',[Vector(p)+Vector((sign*.002,-.003,0)) for p in pts],.00025,glint,[.5,1,1,.7,.02],res=1)

def leaf(name,start,direction,length,width,mat,thickness=.0025):
    start=Vector(start);direction=Vector(direction).normalized();across=Vector((direction.z,0,-direction.x)).normalized()
    vs=[start];uv=[(.5,0)];fs=[];ns=16;nr=12
    for j in range(1,ns):
        t=j/ns;c=start+direction*(length*t);r=math.sin(math.pi*t)**.8
        for i in range(nr):
            a=i*TAU/nr
            vs.append(c+across*(width*r*math.cos(a))+Vector((0,thickness*r*math.sin(a),0)))
            uv.append((i/nr,t))
    end=len(vs);vs.append(start+direction*length);uv.append((.5,1))
    for i in range(nr):fs.append((0,1+(i+1)%nr,1+i))
    for j in range(ns-2):
        for i in range(nr):
            a=1+j*nr+i;b=1+j*nr+(i+1)%nr;fs.append((a,b,b+nr,a+nr))
    for i in range(nr):fs.append((end,1+(ns-2)*nr+i,1+(ns-2)*nr+(i+1)%nr))
    ob=mesh_object(name,vs,fs,mat,uv,sub=1)
    points=[]
    for j in range(41):
        t=j/40;points.append(start+direction*(length*t)+across*(width*math.sin(math.pi*t)**.8)+Vector((0,-thickness*.5,0)))
    for j in range(40,-1,-1):
        t=j/40;points.append(start+direction*(length*t)-across*(width*math.sin(math.pi*t)**.8)+Vector((0,-thickness*.5,0)))
    curve(name+'_Gold_Rim',points,.0006,gold,res=2,cyclic=True)
    return ob

def lotus(name,center,scale=1):
    x,y,z=center
    for i in range(7):
        a=(i-3)*.33
        leaf(name+'_Petal',(x,y+(i-3)*.0014,z),
             (math.sin(a),0,math.cos(a)),(.028+.012*(1-abs(i-3)/3))*scale,.0075*scale,gem,.002*scale)
    ellipsoid(name+'_Heart',(x,y-.003,z+.009*scale),(.009*scale,.005*scale,.007*scale),gem,32,20,1)

# Crescent arms and lotus are one readable ornament rather than a full metal helmet.
lotus('QL09_Hair_Lotus',(0,-.033,1.745),1.0)
for sign in [-1,1]:
    curve('QL09_Crescent_Crown',[(0,-.030,1.752),(sign*.025,-.027,1.747),(sign*.047,-.024,1.757),(sign*.059,-.018,1.781)],.0015,gold,[1,1,.8,.05],res=3)
    for i in range(3):
        x=sign*(.032+.012*i)
        leaf('QL09_Hairpin_Leaf',(x,-.018,1.750+i*.006),(sign*.8,0,.6),.019,.0038,gold,.0012)
    curve('QL09_Hairpin_Drop',[(sign*.055,-.012,1.762),(sign*.078,-.015,1.725),(sign*.083,-.017,1.688)],.00065,gold,res=2)
    ellipsoid('QL09_Hairpin_Pearl',(sign*.083,-.017,1.685),(.0032,.0032,.004),gem,24,16,1)
    # Earring anchors follow actual earlobe landmarks.
    curve('QL09_Earring_Chain',[(sign*.082,-.045,1.560),(sign*.085,-.052,1.540),(sign*.085,-.055,1.522)],.00065,gold,res=2)
    leaf('QL09_Earring_Jade',(sign*.085,-.055,1.494),(0,0,1),.028,.0057,gem,.0036)
    ellipsoid('QL09_Earring_Stud',(sign*.083,-.047,1.553),(.003,.002,.003),gold,24,16,1)

lotus('QL07_Lotus_Clasp',(0,-.131,1.115),1.15)
for sign in [-1,1]:
    curve('QL07_Waist_Chain',[(0,-.136,1.127),(sign*.065,-.129,1.115),(sign*.123,-.090,1.133)],.0012,gold,res=3)
    for i in range(5):
        x=sign*(.027+i*.017);y=-.135+.04*(abs(x)/.12)**2
        leaf('QL07_Chain_Leaf',(x,y,1.119),(sign*.6,0,.8),.013,.0027,gold,.0008)
curve('QL11_Pendant_Chain',[(0,-.139,1.122),(0,-.146,1.085),(0,-.153,1.047)],.0011,gold,res=2)
leaf('QL11_Jade_Pendant',(0,-.161,1.005),(0,0,1),.042,.011,gem,.005)

def tassel(name,start,length=.14,radius=.009):
    x,y,z=start
    ellipsoid(name+'_Cap',(x,y,z),(radius*1.05,radius*.7,.013),gold,32,20,1)
    for i in range(34):
        a=i*TAU/34;r=radius*.9
        curve(name+'_Silk',[(x+r*.5*math.cos(a),y+r*.4*math.sin(a),z-.006),
                            (x+r*math.cos(a),y+r*.65*math.sin(a),z-length*.5),
                            (x+r*1.15*math.cos(a),y+r*.7*math.sin(a),z-length*(.97+.03*random.random()))],.00022,jade,[.8,1,.35],res=2)
for sign in [-1,1]:
    curve('QL11_Tassel_Cord',[(sign*.017,-.142,1.12),(sign*.032,-.158,1.0),(sign*.032,-.183,.85)],.0012,gold,res=2)
    ellipsoid('QL11_Tassel_Bead',(sign*.032,-.185,.85),(.005,.004,.007),gem,24,16,1)
    tassel('QL11_Waist_Tassel',(sign*.032,-.187,.832),.16,.007)

# Sample the editable garment grids for embroidery, keeping it above the cloth.
stitch_patterns={}
def sampler(name,nu,nv,wrap=False):
    ob=bpy.data.objects[name];verts=[v.co.copy() for v in ob.data.vertices];stride=nu if wrap else nu+1
    def raw(u,v):
        u=max(.00001,min(.99999,u));v=max(.00001,min(.99999,v));x=u*nu;y=v*nv;i=int(x);j=int(y);a=x-i;b=y-j
        k=j*stride+i;kn=j*stride+(i+1)%stride
        return verts[k].lerp(verts[kn],a).lerp(verts[k+stride].lerp(verts[kn+stride],a),b)
    def normal(u,v):
        p=raw(u,v);du=raw(min(.99999,u+.0001),v)-raw(max(.00001,u-.0001),v)
        dv=raw(u,min(.99999,v+.0001))-raw(u,max(.00001,v-.0001))
        n=du.cross(dv).normalized()
        if n.dot(Vector((p.x,p.y+.015,0)))<0:n=-n
        return n
    def fn(u,v):return raw(u,v)+normal(u,v)*.0026
    fn.normal=normal;fn.source_name=name
    fn.uv_scale=(sum((raw((i+1)/32,.75)-raw(i/32,.75)).length for i in range(32)),sum((raw(.25,(i+1)/32)-raw(.25,i/32)).length for i in range(32)))
    return fn

def stitch_path(name,fn,uvs,radius=.0006):
    stitch_patterns.setdefault(fn,[]).append((uvs,radius))
    return curve(name,[fn(u,v) for u,v in uvs],radius,thread,res=2)

def embroidered_lotus(fn,u,v,su,sv):
    for i in range(7):
        angle=(i-3)*.26
        points=[]
        for t in np.linspace(0,TAU,45):
            h=(1-math.cos(t))*.5
            xx=math.sin(t)*.19*(.25+.75*h);yy=h*(1-.14*abs(i-3))
            x=xx*math.cos(angle)+yy*math.sin(angle)
            y=-xx*math.sin(angle)+yy*math.cos(angle)
            points.append((u+su*x,v-sv*y))
        stitch_path('QL06_Lotus_Embroidery',fn,points)
    stitch_path('QL06_Lotus_Stem',fn,[(u,v),(u+su*.12,v+sv*.23),(u-su*.05,v+sv*.44)])
    for sign in [-1,1]:
        pts=[]
        for t in np.linspace(0,math.pi,32):
            pts.append((u+sign*su*.5*math.sin(t),v+sv*.15*(1-math.cos(t))))
        stitch_path('QL06_Lotus_Leafwork',fn,pts)

def embroidered_cloud(fn,u,v,su,sv):
    outline=[(-1,0),(-.86,.17),(-.83,.44),(-.58,.55),(-.36,.48),(-.23,.73),(.05,.82),(.31,.69),(.34,.51),(.60,.48),(.78,.28),(.63,.08),(.22,.05),(.07,-.09),(.32,-.20),(.75,-.18),(1,-.27)]
    for shrink in [1,.67]:
        stitch_path('QL06_Ruyi_Cloud',fn,[(u+x*su*shrink,v-y*sv*shrink) for x,y in outline],.00052)
    curl=[(-.52,.17),(-.46,.34),(-.20,.36),(-.05,.21),(-.10,.08),(-.29,.08)]
    stitch_path('QL06_Cloud_Curl',fn,[(u+x*su,v-y*sv) for x,y in curl],.00048)

for sign in [-1,1]:
    fn=sampler('QL06_Jade_Overpanel_'+str(sign),64,44)
    for u,v,su,sv in [(.11,.86,.14,.13),(.44,.92,.17,.12),(.78,.90,.17,.12),(.10,.56,.10,.09)]:
        embroidered_lotus(fn,u,v,su,sv)
    for k in range(10):
        u=.055+k*.094
        embroidered_cloud(fn,u,.954,.036,.029)
    for k in range(7):
        v=.2+k*.09
        embroidered_cloud(fn,.044,v,.020,.031)
for label in ['l','r']:
    fn=sampler('QL04_Bell_Sleeve_'+label,112,40,True)
    for u in [.15,.26,.37]:embroidered_lotus(fn,u,.86,.13,.15)
    for u in [.12,.24,.36]:embroidered_lotus(fn,u,.60,.07,.08)

# Resolve stitch crossings in the garment pattern, before projecting into 3D.
# Keep the original curves for artistic editing and the closed relief for export.
stitches=[o for o in col().objects if o.type=='CURVE' and o.name.startswith('QL06_') and any(k in o.name for k in ['Embroidery','Stem','Leafwork','Cloud'])]
for ob in stitches:
    move_to(ob,'SOURCE_Embroidery_Patterns');ob.hide_render=True;ob.hide_set(True)
from embroidery import build_relief
build_relief(stitch_patterns,thread)
col('SOURCE_Embroidery_Patterns').hide_render=True

# A sheathed jian with a hidden editable blade, pommel, wrap and lotus guard.
base=Vector((.205,.107,1.135));axis=Vector((-.24,-.02,.971)).normalized()
across=Vector((axis.z,0,-axis.x)).normalized();depth=Vector((0,1,0))
def sword_point(t,x=0,y=0):return base+axis*t+across*x+depth*y
def section(name,t0,t1,wx,wy,mat):
    n=12;vs=[];uv=[];fs=[]
    for j,t in enumerate([t0,t0+.003,t1-.003,t1]):
        taper=.80 if j in [0,3] else 1
        for i in range(n):
            a=i*TAU/n;vs.append(sword_point(t,wx*taper*math.cos(a),wy*taper*math.sin(a)));uv.append((i/n,j/3))
    for j in range(3):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;fs.append((a,b,b+n,a+n))
    fs.extend([tuple(reversed(range(n))),tuple(3*n+i for i in range(n))])
    return mesh_object(name,vs,fs,mat,uv,sub=1)
section('QL10_Jade_Scabbard',-.72,-.015,.018,.011,dark)
for t in [-.705,-.53,-.28,-.032]:section('QL10_Scabbard_Gold_Band',t-.009,t+.009,.0198,.0125,gold)
section('QL10_Jian_Grip',.018,.148,.012,.009,jade)
section('QL10_Pommel',.145,.174,.016,.012,gold)
for i in range(12):
    t=.025+i*.010
    curve('QL10_Grip_Wrap',[sword_point(t,.0125*math.cos(a),.010*math.sin(a)) for a in np.linspace(0,TAU,40)],.0008,gold,res=2,cyclic=True)
for sign in [-1,1]:
    curve('QL10_Lotus_Guard',[sword_point(0),sword_point(.003,sign*.026),sword_point(.020,sign*.047),sword_point(.033,sign*.045)],.003,gold,[1,1,.7,.1],res=3)
curve('QL10_Suspension_Cord',[(.132,.026,1.139),(.17,.08,1.12),sword_point(-.08)],.002,gold,res=3)
blade=section('SRC_Jian_Blade',-.68,0,.015,.0025,material('M_Steel',(.70,.75,.78),.23,metal=1))
move_to(blade,'SOURCE_Parametric_DoNotExport');blade.hide_render=True;blade.hide_set(True)
curve('QL10_Sword_Tassel_Cord',[sword_point(.169),sword_point(.12,.045),sword_point(.0,.058)],.001,jade,res=2)
tassel('QL10_Sword_Tassel',sword_point(-.01,.058),.12,.006)

# Use the requested skill's sculpt preparation on the visible skin source.
skillroot=Path(os.environ.get('BLENDER_SKILLS_ROOT',r'D:\tmp\estella-blender-skills-20261028'))/'skills'
sys.path.insert(0,str(skillroot/'blender-sculpting/scripts'))
import sculpt_ops
body=bpy.data.objects['QL01_Body']
for mod in list(body.modifiers):
    if mod.type=='SUBSURF':body.modifiers.remove(mod)
# Multires is evaluated before the visibility mask; the original base remains editable.
mr=body.modifiers.new('Highpoly_Multires','MULTIRES')
bpy.context.view_layer.objects.active=body
with bpy.context.temp_override(object=body,active_object=body,selected_objects=[body]):
    bpy.ops.object.modifier_move_up(modifier=mr.name)
print('SCULPT_SKILL '+json.dumps(sculpt_ops.run(objects=[body.name],ops=['multires=3'])))
save(WORK/'04_details.blend')
render(bpy.data.objects['CAM_Hero'],WORK/'details-preview.png',1024,1400,48)
render(bpy.data.objects['CAM_Face'],WORK/'face-details.png',900,1000,48)
print('QINGLAN_DETAILS_SAVED')
