"""Fit the controlled face mesh to the revised three-view Qinglan face target.

All distances are metres. The original parametric head remains in SOURCE.
The fit deliberately changes proportions, not topology or vertex ordering.
"""
from common import *
from mathutils.bvhtree import BVHTree

def fit_head(body):
    for v in body.data.vertices:
        x,y,z=v.co
        if z<1.455:continue
        front=max(0,min(1,(-y+.035)/.105))
        jaw=math.exp(-((z-1.511)/.035)**2)*front
        chin=math.exp(-((z-1.482)/.019)**2)*front
        v.co.x=x*(1-.12*jaw-.065*chin)
        # Temple/cheek silhouette follows the slender oval of the target.
        outer=max(0,min(1,(abs(x)-.043)/.038))
        headweight=max(0,min(1,(z-1.475)/.09))
        v.co.x*=1-.075*outer*headweight
        v.co.z=z-.0032*chin
        # Softer jaw turn and less protruding mouth/chin transition in profile.
        v.co.y=y+.0018*jaw*math.exp(-(x/.045)**2)
        if y<-.105:
            nose=math.exp(-((z-1.557)/.022)**2-(x/.022)**4)
            v.co.x*=1-.18*nose
            bridge=math.exp(-((z-1.579)/.022)**2-(x/.011)**2)
            v.co.y-=.0024*bridge
            tip=math.exp(-((z-1.553)/.009)**2-(x/.014)**2)
            v.co.z-=.0014*tip
            # Refined mouth width, defined lip volume; corners stay relaxed.
            mouth=math.exp(-((z-1.527)/.021)**4-(x/.032)**6)
            v.co.x*=1-.02*mouth
            v.co.z+=.0013*mouth
            v.co.y+=.0012*mouth
        # Almond aperture: outer canthus elevated, lower lid raised a little.
        for sign in [-1,1]:
            dx=(x-sign*.033)/.032;dz=(z-1.5987)/.023
            f=math.exp(-dx**6-dz**4)
            if y<-.105:
                v.co.x+=(x-sign*.033)*.20*f
                v.co.z+=(z-1.5987)*.08*f+(.0018*((abs(x)-.033)/.018)+.0005)*f
    body.data.update()
    body['face_reference']='references/qinglan-face-target.png'
    body['face_revision']=2

def make_eye_details(body,hairmat,eye_white,iris,black):
    # Evaluate the actual lid surface to seat makeup and hair at skin contact.
    bpy.context.view_layer.update()
    bvh=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
    def skinpoint(x,z,off=.00018):
        hit=bvh.ray_cast(Vector((x,-.5,z)),Vector((0,1,0)))
        return Vector((x,(hit[0].y if hit[0] else -.135)-off,z))
    browmat=material('M_Brow_Soft_Brown',(.105,.065,.051),.65)
    lidmat=material('M_Lid_Warm_Rose',(.43,.21,.19),.38,sss=.05)
    for sign,side in [(-1,'R'),(1,'L')]:
        c=Vector((sign*.0325,-.1245,1.5987))
        ellipsoid('QL02_Sclera_'+side,c,(.0205,.0170,.0155),eye_white,64,40)
        # Iris rises fractionally under the upper lid, avoiding a startled gaze.
        ic=c+Vector((0,0,.0008));radius=.00735;n=96;nr=12
        verts=[];uv=[];faces=[]
        for j in range(nr+1):
            r=.0028+(radius-.0028)*j/nr
            for i in range(n):
                a=TAU*i/n;x=ic.x+r*math.cos(a);z=ic.z+r*math.sin(a)
                q=((x-c.x)/.0205)**2+((z-c.z)/.0155)**2
                y=c.y-.0170*math.sqrt(max(.01,1-q))-.00016
                verts.append((x,y,z));uv.append((.5+.5*(r/radius)*math.cos(a),.5+.5*(r/radius)*math.sin(a)))
        for j in range(nr):
            for i in range(n):
                a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
        mesh_object('QL02_Iris_'+side,verts,faces,iris,uv)
        ellipsoid('QL02_Pupil_'+side,(ic.x,c.y-.01725,ic.z),(.00295,.00045,.00295),black,40,24,0)
        # Find the skin/sclera intersection in a scan of the eye region. This
        # makes liner and lashes follow the real eyelid, including the canthi.
        upper=[];lower=[]
        for k in range(49):
            x=sign*(.009+.049*k/48);hits=[]
            for j in range(181):
                z=1.585+.027*j/180
                q=((x-c.x)/.0205)**2+((z-c.z)/.0155)**2
                if q>=1:continue
                sy=c.y-.017*math.sqrt(1-q)
                p=skinpoint(x,z,0)
                if sy<p.y-.00003:hits.append((z,sy))
            if hits:
                upper.append(Vector((x,hits[-1][1]-.00035,hits[-1][0])))
                lower.append(Vector((x,hits[0][1]-.00010,hits[0][0])))
        if len(upper)>5:
            curve('QL02_UpperLash_'+side,upper,.00042,hairmat,[max(.08,math.sin(math.pi*i/(len(upper)-1))**.5) for i in range(len(upper))],res=2)
            curve('QL02_LowerWaterline_'+side,lower,.00025,lidmat,[max(.1,math.sin(math.pi*i/(len(lower)-1))) for i in range(len(lower))],res=2)
            for j in range(23):
                t=.12+.85*j/22;p=upper[min(len(upper)-1,int(t*(len(upper)-1)))]
                length=.0018+.0023*t
                points=[p,p+Vector((sign*length*.3,-length*.7,length*.22)),p+Vector((sign*length*.75,-length*.8,length*.60))]
                curve('QL02_Lash_'+side,points,.00011,hairmat,[1,.7,.04],res=2)
            for j in range(12):
                t=.25+.70*j/11;p=lower[min(len(lower)-1,int(t*(len(lower)-1)))]
                curve('QL02_LowerLash_'+side,[p,p+Vector((sign*.0004,-.0007,-.0006)),p+Vector((sign*.001,-.001,-.0011))],.000075,hairmat,[.75,.45,.02],res=2)
        # Brows sit close to the socket, with a low quiet arch and hair strokes.
        def brow(t):
            x=.014+.046*t;z=1.6115+.0048*math.sin(math.pi*t*.88)-.0016*t
            return x,z
        verts=[];uv=[];faces=[];segments=64
        for j in range(segments+1):
            t=j/segments;x,z=brow(t);width=.00125*math.sin(math.pi*(.10+.90*t))**.8
            for s in [-1,1]:verts.append(skinpoint(sign*x,z+s*width,.00030));uv.append((t,(s+1)/2))
        for j in range(segments):faces.append((j*2,j*2+1,j*2+3,j*2+2))
        mesh_object('QL02_Brow_Base_'+side,verts,faces,browmat,uv,solid=.00010)
        for j in range(94):
            t=(j+.2)/94;x,z=brow(t);width=.00125*math.sin(math.pi*(.10+.90*t))**.8
            start=skinpoint(sign*x,z-width*.8,.00044)
            mid=skinpoint(sign*(x+.0006),z,.00049)
            end=skinpoint(sign*(x+.0012),z+width*.9,.00044)
            curve('QL02_Brow_Hair_'+side,[start,mid,end],.000085,hairmat,[.7,1,.04],res=1)
