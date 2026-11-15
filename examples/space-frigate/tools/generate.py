from pathlib import Path
import json
import math
import random
import subprocess
import sys
import uuid

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
MODELS = ROOT / 'assets/models'
ENV = ROOT / 'assets/env'
TEX = ROOT / 'assets/textures'
MAT = ROOT / 'assets/materials'
SCENE = ROOT / 'assets/scenes/main.esscene'
CLI = REPO / 'pipeline/bin/estella.mjs'
MAP = int(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 4096
ONLY = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else ['sky', 'planet', 'grain', 'models', 'materials', 'scene']
MODELS_ONLY = sys.argv[sys.argv.index('--models') + 1].split(',') if '--models' in sys.argv else None
SUN = (0.62, -0.5, -0.6)
PLANET_AT = (-6000, -5760, -3500)
PLANET_RADIUS = 4300
SHIP_DETAIL = {'texture': 'assets/textures/hull-grain.png', 'size': 1.1, 'strength': 0.1, 'bump': 0.1}


def run(*args):
    subprocess.run(['node', str(CLI), *[str(a) for a in args]], check=True, cwd=REPO)


def stamp(path, kind=None, importer=None):
    meta_path = Path(str(path) + '.meta')
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {'version': '2.0', 'type': kind, 'importer': importer or {}}
    meta['uuid'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'estella/examples/space-frigate/' + str(Path(path).relative_to(ROOT))))
    if importer:
        meta['importer'] = {**meta.get('importer', {}), **importer}
    meta_path.write_text(json.dumps(meta, indent=2) + '\n')


def hash3(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 362437) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffffff) / float(0xffffff)


def vnoise(p, seed):
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * hash3(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out.astype(np.float32)


def fbm(p, seed, oct=6, gain=0.5, lac=2.03, ridged=False):
    s = 0
    a = 1
    t = 0
    for o in range(oct):
        n = vnoise(p, seed + o * 17)
        if ridged:
            n = 1 - np.abs(n * 2 - 1)
        s = s + a * n
        t += a
        a *= gain
        p = p * lac + 11.3
    return s / t


def warp(p, seed, amt, freq=1.0):
    q = np.stack([fbm(p * freq + 3.1, seed, 4), fbm(p * freq + 7.7, seed + 5, 4), fbm(p * freq + 13.9, seed + 9, 4)], -1) - 0.5
    return p + q * amt


def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def directions(W, H, sky):
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    th = v * np.pi
    st = np.sin(th)[:, None]
    if sky:
        phi = (u * 2 - 1) * np.pi
        return np.stack([st * np.sin(phi)[None, :], np.cos(th)[:, None] * np.ones((1, W)), -st * np.cos(phi)[None, :]], -1).astype(np.float32)
    phi = u * 2 * np.pi
    return np.stack([st * np.cos(phi)[None, :], np.cos(th)[:, None] * np.ones((1, W)), st * np.sin(phi)[None, :]], -1).astype(np.float32)


def write_hdr(path,img):
    h,w,_=img.shape
    m=np.maximum(img.max(-1),1e-32); e=np.ceil(np.log2(m)); 
    e=np.where(m*np.power(2.0,-e)>=1.0,e+1,e)
    sc=np.power(2.0,-e)*256.0
    rgbe=np.zeros((h,w,4),np.uint8); rgbe[...,:3]=np.clip(img*sc[...,None],0,255).astype(np.uint8); rgbe[...,3]=np.clip(e+128,0,255).astype(np.uint8)
    rgbe[m<=1e-30]=0
    with open(path,'wb') as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n"); f.write(f"-Y {h} +X {w}\n".encode()); f.write(rgbe.tobytes())



def make_sky():
    W = 4096
    H = W // 2
    D = directions(W, H, True)
    P=D*1.35
    focus=np.array([-0.62,0.22,-0.75],np.float32); focus/=np.linalg.norm(focus)
    near=D@focus
    region=sm(-0.35,0.75,near)
    axis=np.array([0.35,0.25,0.9],np.float32); axis/=np.linalg.norm(axis)
    band=np.exp(-((D@axis)/0.38)**2)
    W1=warp(P,1,1.1,0.8); W2=warp(W1*1.7,31,0.7,1.3)
    base=fbm(W2,20,8,0.55)
    wisps=fbm(warp(P*3.1,40,0.8,1.5)*2.2,60,8,0.55,ridged=True)
    fine=fbm(W2*6.0,70,5,0.6)
    dust=fbm(warp(P*1.9,80,1.3)*2.1,90,8,0.55)
    gas=sm(0.50,0.80,base+0.10*(fine-0.5))*(0.10+0.90*region)
    glow=sm(0.60,0.95,wisps)**1.5*sm(0.45,0.70,base)*region
    lanes=1-0.92*sm(0.50,0.66,dust)
    hue=sm(0.35,0.65,fbm(P*0.7+5,120,4))[...,None]
    deep=np.array([0.015,0.060,0.16],np.float32); cyan=np.array([0.03,0.26,0.36],np.float32)
    rose=np.array([0.85,0.10,0.16],np.float32); amber=np.array([1.0,0.50,0.16],np.float32)
    neb=gas[...,None]*(deep*(1-hue)+cyan*hue)*1.5
    neb=neb+glow[...,None]*(rose*(1-hue)+amber*hue)*2.2
    neb=neb*lanes[...,None]
    neb=neb+(band*sm(0.4,0.7,fbm(P*2.5,150,6)))[...,None]*np.array([0.030,0.026,0.034],np.float32)
    neb=neb*1.5
    neb=neb/(1+neb*0.35)+np.array([0.0015,0.002,0.004],np.float32)
    img=neb.astype(np.float32)
    hdr = ENV / 'nebula.hdr'
    write_hdr(hdr, img)
    for old in ('nebula.esenv', 'nebula_env.png', 'nebula_sky.png'):
        (ENV / old).unlink(missing_ok=True)
    run('import-hdr', hdr, '--face-size', 256, '--sky-width', 4096)
    hdr.unlink()
    for name in ('nebula.esenv', 'nebula_env.png', 'nebula_sky.png'):
        stamp(ENV / name)


def make_planet():
    W = 4096
    H = W // 2
    D = directions(W, H, False)
    lat=D[...,1]
    P=D*np.array([2.2,7.0,2.2],np.float32)
    turb=fbm(D*np.array([3,9,3],np.float32)+2.0,5,6)-0.5
    turb2=fbm(D*np.array([7,22,7],np.float32)+9.0,31,6)-0.5
    band=lat*9.0+turb*1.6+turb2*0.5
    stripe=0.5+0.5*np.sin(band*np.pi)
    fine=fbm(np.stack([D[...,0]*5,band*3.0,D[...,2]*5],-1),77,7,0.55)
    swirl=fbm(np.stack([D[...,0]*14+turb*6,band*8.0,D[...,2]*14+turb2*6],-1),99,6,0.55)
    pal=np.array([[0.78,0.62,0.44],[0.52,0.33,0.20],[0.86,0.78,0.64],[0.36,0.24,0.18],[0.70,0.48,0.30],[0.90,0.84,0.74]],np.float32)
    sel=(np.sin(band*0.9+1.3)*0.5+0.5)*(len(pal)-1.001)
    i0=np.floor(sel).astype(int); f=(sel-i0)[...,None]
    col=pal[i0]*(1-f)+pal[np.minimum(i0+1,len(pal)-1)]*f
    col=col*(0.72+0.5*stripe[...,None]*0.5)
    col=col*(0.8+0.45*(fine[...,None]-0.5)*2*0.6)
    col=col*(0.9+0.3*(swirl[...,None]-0.5))
    c=np.array([np.cos(0.9)*np.cos(-0.32),np.sin(-0.32),np.sin(0.9)*np.cos(-0.32)],np.float32)
    d=np.arccos(np.clip(D@c,-1,1)); storm=sm(0.16,0.03,d*np.sqrt(1+3*(D[...,1]-c[1])**2/ (0.02+d*d)))
    col=col*(1-storm[...,None])+np.array([0.72,0.30,0.16],np.float32)*storm[...,None]*(0.8+0.4*swirl[...,None])
    pole=sm(0.74,0.98,np.abs(lat))[...,None]
    col=col*(1-pole)+np.array([0.34,0.38,0.44],np.float32)*pole*(0.8+0.3*fine[...,None])
    grey=col.mean(-1,keepdims=True)
    col=np.clip((grey+(col-grey)*1.35)*0.62,0,1)
    path = TEX / 'giant.png'
    Image.fromarray((col ** (1 / 2.2) * 255).astype(np.uint8)).save(path, optimize=True)
    stamp(path, 'texture', {'sRGB': True, 'maxSize': 4096, 'filterMode': 'linear', 'wrapMode': 'repeat'})


def make_grain():
    n = 1024
    rng = np.random.default_rng(31)
    def tile(freq, seed):
        u = (np.arange(n) + 0.5) / n
        x, y = np.meshgrid(u, u)
        def at(ox, oy):
            return fbm(np.stack([(x + ox) * freq, (y + oy) * freq, np.full_like(x, seed * 1.37)], -1).astype(np.float32), seed, 5, 0.55)
        wx, wy = sm(0, 1, x), sm(0, 1, y)
        mixed = (at(0, 0) * (1 - wx) + at(-1, 0) * wx) * (1 - wy) + (at(0, -1) * (1 - wx) + at(-1, -1) * wx) * wy
        return ((mixed - 0.5) / np.sqrt((1 - wx) ** 2 + wx ** 2) / np.sqrt((1 - wy) ** 2 + wy ** 2) + 0.5).astype(np.float32)
    cloud = tile(6, 3)
    fine = tile(40, 17)
    speck = rng.random((n, n)).astype(np.float32)
    brushed = np.cumsum(rng.normal(0, 1, (n, n)).astype(np.float32), axis=1)
    brushed = brushed - brushed.mean(axis=1, keepdims=True)
    brushed = brushed / (np.abs(brushed).max() + 1e-6)
    grey = 0.5 + (cloud - 0.5) * 0.5 + (fine - 0.5) * 0.45 + brushed * 0.05 + (speck - 0.5) * 0.08
    grey = grey - (speck > 0.9985) * 0.35
    grey = np.clip(grey, 0, 1)
    path = TEX / 'hull-grain.png'
    Image.fromarray((np.stack([grey] * 3, -1) * 255).astype(np.uint8)).save(path, optimize=True)
    stamp(path, 'texture', {'sRGB': False, 'maxSize': 1024, 'filterMode': 'linear', 'wrapMode': 'repeat'})


def ship_source():
    rnd = random.Random(11)
    S=[]
    def step(**k): S.append(k); return k
    def oct(w,h,c): return [[-w+c,-h],[w-c,-h],[w,-h+c],[w,h-c],[w-c,h],[-w+c,h],[-w,h-c],[-w,-h+c]]
    def loft(tag,color,rows,x=0.0,**k):
        step(op='loft',sections=[{'at':[x,y,z],'points':oct(w,h,c)} for (z,w,h,c,y) in rows],curve=1,tag=tag,color=color,**k)
    def nozzle(x,y,z,r):
        step(op='lathe',axis='z',at=[x,y,z],profile=[[0,0.3],[r*0.72,0.3],[r,-r*1.15],[r*0.88,-r*1.15],[r*0.45,-r*0.3],[0,-r*0.3]],sides=24,tag='nozzle',color=[0.06,0.055,0.05])
        step(op='lathe',axis='z',at=[x,y,z-r*0.34],profile=[[0,0],[r*0.5,0],[r*0.5,-0.08],[0,-0.08]],sides=24,tag='thrust',color=[0.5,0.78,1.0])
        step(op='lathe',axis='z',at=[x,y,z+0.6],profile=[[r*1.02,0.9],[r*1.2,0.9],[r*1.2,-0.9],[r*1.02,-0.9]],sides=24,tag='cowl',color=[0.1,0.105,0.115])

    HULL=[0.33,0.34,0.35]; UPPER=[0.24,0.26,0.29]; DARK=[0.095,0.1,0.11]; WARM=[1.0,0.8,0.5]; ACCENT=[0.6,0.15,0.03]
    H=[(-44,9,5.5,2.2,0),(-30,10.5,6,2.5,0),(-8,10,5.5,2.5,0),(6,7.5,4.5,2.0,-0.3),(20,6,3.6,1.6,-0.6),(34,4.2,2.6,1.2,-1.0),(45,2.9,1.8,0.8,-1.3)]
    def at(z):
        for a,b in zip(H,H[1:]):
            if a[0]<=z<=b[0]:
                t=(z-a[0])/(b[0]-a[0]); return [a[i]+(b[i]-a[i])*t for i in range(5)]
        return list(H[0] if z<H[0][0] else H[-1])
    loft('hull',HULL,H)
    loft('upper',UPPER,[(-36,5,2.2,1,6.8),(-20,5.6,2.7,1.2,7.3),(-6,4.5,2.2,1.0,6.6),(5,3,1.2,0.6,5.1)])
    step(op='box',size=[6.2,2.2,9],at=[0,10.2,-23],tag='bridge',color=UPPER)
    step(op='box',size=[4.6,1.8,6.4],at=[0,12.2,-22.6],tag='bridge',color=UPPER)
    step(op='box',size=[3.0,1.0,3.6],at=[0,13.6,-23.4],tag='bridge',color=UPPER)
    step(op='box',size=[4.0,0.42,0.12],at=[0,12.5,-19.36],tag='window',color=WARM)
    step(op='box',size=[0.12,0.42,4.6],at=[2.32,12.5,-22.0],tag='window',color=WARM)
    step(op='box',size=[0.12,0.42,4.6],at=[-2.32,12.5,-22.0],tag='window',color=WARM)
    step(op='box',size=[5.4,0.3,0.12],at=[0,10.5,-18.46],tag='window',color=WARM)
    for (x,y,z,h,r) in [(0,14.1,-23.8,8.5,0.14),(1.0,14.1,-24.6,4.6,0.09),(-1.2,13.1,-25.4,5.5,0.08)]:
        step(op='loft',path=[[x,y,z],[x,y+h,z-0.5]],section={'radius':r},sides=8,tag='mast',color=DARK)
    step(op='box',size=[1.8,0.22,1.1],at=[0,18.4,-24.2],tag='mast',color=DARK)
    step(op='cylinder',radius=1.1,height=0.25,sides=16,at=[1.9,11.5,-26.5],tag='mast',color=DARK)
    step(op='box',size=[1.4,4.2,24],at=[0,-7.2,-16],tag='keel',color=DARK)
    step(op='box',size=[2.8,1.4,14],at=[0,-9.8,-18],tag='keel',color=DARK)
    loft('strake',UPPER,[(-42,1.3,1.5,0.5,-0.4),(-28,1.5,1.9,0.6,-0.4),(-4,1.4,1.7,0.6,-0.6),(10,0.8,1.0,0.35,-0.9)],x=0)
    S[-1]['sections']=[{'at':[at(z)[1]+w*0.55,y,z],'points':oct(w,h,c)} for (z,w,h,c,y) in [(-42,1.3,1.5,0.5,-0.4),(-28,1.5,1.9,0.6,-0.4),(-4,1.4,1.7,0.6,-0.6),(10,0.8,1.0,0.35,-0.9)]]
    loft('nacelle',DARK,[(-46,3.2,3.2,1.0,-1),(-36,3.8,3.6,1.2,-1),(-18,3.2,3.0,1.0,-1),(-8,1.8,1.6,0.6,-1)],x=17)
    step(op='box',size=[6.5,1.4,11],at=[12.4,-0.9,-30],tag='pylon',color=DARK)
    step(op='box',size=[1.3,1.7,15],at=[3.3,-1.4,46],tag='prong',color=UPPER)
    step(op='box',size=[0.7,0.9,6],at=[3.3,-1.4,56],tag='prong',color=DARK)
    step(op='box',size=[0.55,6.5,8.5],at=[7.2,8.4,-38.5],tag='fin',color=UPPER)
    step(op='transform',faces='fin',rotate=[0,0,-24],pivot=[7.2,5.4,-38.5])
    nozzle(17,-1,-46,2.4)
    step(op='mirror',faces={'tag':['strake','nacelle','pylon','prong','fin','nozzle','thrust','cowl']},axis='x',at=0)
    nozzle(4.5,0,-44,3.2); nozzle(-4.5,0,-44,3.2)
    for (x,z,s) in [(0,13,1),(0,27,1),(0,10,-1),(5.8,-12,1),(-5.8,-12,1)]:
        a=at(z); y=a[4]+s*a[2] if abs(x)<a[1]-a[3] else a[4]+s*(a[2]-a[3]*0.5)
        step(op='cylinder',radius=1.6,height=0.5,sides=20,at=[x,y+0.25*s,z],tag='turret',color=DARK)
        step(op='cylinder',radius=1.25,height=0.4,sides=20,at=[x,y+0.7*s,z],tag='turret',color=DARK)
        step(op='loft',sections=[{'at':[x,y+1.45*s,zz],'points':oct(w,h,c)} for (zz,w,h,c) in [(z-1.5,0.95,0.5,0.18),(z-0.4,1.2,0.62,0.22),(z+0.9,1.1,0.58,0.22),(z+1.9,0.7,0.4,0.15)]],curve=1,tag='turret',color=UPPER)
        step(op='box',size=[1.7,0.5,0.5],at=[x,y+1.4*s,z+1.95],tag='turret',color=DARK)
        for bx in (-0.5,0.5):
            step(op='loft',path=[[x+bx,y+1.4*s,z+1.9],[x+bx,y+1.4*s,z+6.6]],section={'radius':0.14},sides=10,tag='barrel',color=DARK)
            step(op='loft',path=[[x+bx,y+1.4*s,z+2.1],[x+bx,y+1.4*s,z+3.3]],section={'radius':0.21},sides=10,tag='barrel',color=DARK)
            step(op='loft',path=[[x+bx,y+1.4*s,z+6.3],[x+bx,y+1.4*s,z+6.95]],section={'radius':0.2},sides=10,tag='barrel',color=DARK)
    S[-1]['id']='blockout'

    src={'version':1,'smoothAngle':28,'material':{'roughness':0.5,'metallic':0,'emissive':[16,16,16],'detail':SHIP_DETAIL},'steps':S}
    if True:
        step(op='paint',faces={'tag':['nacelle','pylon','keel','mast','turret','barrel','cowl']},roughness=0.42,metallic=0.7)
        step(op='paint',faces='nozzle',roughness=0.34,metallic=1)
        step(op='paint',faces='window',glow=0.3,roughness=0.15)
        step(op='paint',faces='thrust',glow=1)
        step(op='panels',faces='hull',size=4.4,uneven=0.85,gap=0.1,height=[0.05,0.2],bevel=0.06,tones=0.2,along=[0,0,1],seed=5,tag='plate')
        step(op='panels',faces={'tag':['upper','bridge','strake','fin']},size=2.3,uneven=0.8,gap=0.08,height=[0.04,0.13],bevel=0.045,tones=0.18,along=[0,0,1],seed=9,tag='plate')
        step(op='panels',faces={'tag':['nacelle','pylon','keel','prong']},size=2.8,uneven=0.8,gap=0.09,height=[0.04,0.14],bevel=0.05,tones=0.22,along=[0,0,1],seed=14,tag='trim')
        P={'tag':['plate','plateSide']}
        step(op='paint',faces={**P,'facing':'-y','tolerance':52},color=[0.11,0.115,0.125],roughness=0.48)
        step(op='paint',faces={**P,'within':{'min':[None,-3,-3.4],'max':[None,None,0.2]}},color=ACCENT,roughness=0.44)
        step(op='paint',faces={**P,'within':{'min':[None,-3,0.2],'max':[None,None,1.4]}},color=[0.62,0.62,0.6],roughness=0.44)
        step(op='paint',faces={'tag':['trim','trimSide'],'within':{'min':[None,None,-14],'max':[None,None,-9]}},color=ACCENT,roughness=0.44)
        step(op='paint',faces={**P,'within':{'min':[None,5,-41.5],'max':[None,None,-39.5]}},color=ACCENT,roughness=0.44)
        for side in (1,-1):
            for row,(y0,z0,z1,dz) in enumerate([(1.5,-34,2,1.5),(2.7,-34,-2,1.5)]):
                z=z0
                while z<z1:
                    if rnd.random()<0.72:
                        a=at(z); x=a[1]+0.01
                        lit=rnd.random()<0.8
                        step(op='box',size=[0.16,0.34,0.62],at=[side*x,a[4]+y0,z],tag='port' if lit else 'portDark',color=WARM if lit else [0.03,0.035,0.04])
                    z+=dz*(1 if rnd.random()<0.8 else 2)
            z=-33
            while z<0:
                if rnd.random()<0.7:
                    step(op='box',size=[0.16,0.3,0.55],at=[side*(5.25 if z<-8 else 4.3),7.6,z],tag='port',color=WARM)
                z+=1.4
        step(op='paint',faces='port',glow=0.22,roughness=0.15)
        step(op='paint',faces='portDark',roughness=0.1,metallic=0.2)
        for i in range(46):
            z=rnd.uniform(-2,40) if i<30 else rnd.uniform(-42,-28)
            a=at(z); top=a[4]+a[2]; half=a[1]-a[3]-0.5
            if z<5 and z>-37: top=None
            x=rnd.uniform(-half,half)
            if top is None or half<0.6: continue
            w,l,h=rnd.uniform(0.4,1.6),rnd.uniform(0.5,2.6),rnd.uniform(0.12,0.45)
            step(op='box',size=[w,h,l],at=[x,top+h/2-0.02,z],tag='gear',color=[rnd.uniform(0.09,0.22)]*3)
        for (x,z0,z1) in [(1.6,2,38),(-1.6,2,38),(2.2,-43,-37),(-2.2,-43,-37)]:
            pts=[[x*(at(z)[1]/at(z0)[1]) if z0>0 else x,at(z)[4]+at(z)[2]+0.1,z] for z in [z0+(z1-z0)*k/6 for k in range(7)]]
            step(op='loft',path=pts,section={'radius':0.11},sides=8,tag='pipe',color=[0.16,0.15,0.14])
        step(op='paint',faces={'tag':['gear','pipe']},roughness=0.4,metallic=0.75)
        for (x,y,z,c) in [(17,2.75,-20,[1,0.05,0.03]),(-17,2.75,-20,[0.05,1,0.2]),(0,22.75,-24.3,[1,1,1]),(3.3,-0.4,58.9,[1,1,1]),(-3.3,-0.4,58.9,[1,1,1]),(0,-10.6,-12,[1,0.05,0.03])]:
            step(op='box',size=[0.28,0.2,0.28],at=[x,y,z],tag='lamp',color=c)
        step(op='paint',faces='lamp',glow=1)
        S[-1]['id']='dense'
        A={'tag':['plate','plateSide','trim','trimSide']}; G={'tag':['plate','plateSide','trim','trimSide','gear','pipe','turret','cowl']}
        T=dict(op='stain',texel=True)
        step(**T,faces={'tag':['plate']},line={'points':[[3.0,at(30)[4]+at(30)[2]+0.12,30],[4.2,at(8)[4]+at(8)[2]+0.12,8]],'width':0.16},hard=True,color=[0.66,0.66,0.64])
        step(**T,faces={'tag':['plate']},line={'points':[[-3.0,at(30)[4]+at(30)[2]+0.12,30],[-4.2,at(8)[4]+at(8)[2]+0.12,8]],'width':0.16},hard=True,color=[0.66,0.66,0.64])
        step(**T,faces=A,pattern='bumps',scale=6,octaves=5,threshold=0.5,softness=0.4,roughness=0.68,amount=0.75,seed=21)
        step(**T,faces=A,pattern='bumps',scale=1.3,octaves=4,threshold=0.5,softness=0.45,roughness=0.34,amount=0.5,seed=27)
        step(**T,faces=A,pattern='bumps',scale=19,octaves=5,threshold=0.56,softness=0.22,color=[0.1,0.097,0.092],roughness=0.78,amount=0.5,seed=9)
        step(**T,faces=A,pattern='bumps',scale=2.4,octaves=5,stretch=[1,1,9],threshold=0.6,softness=0.14,color=[0.07,0.065,0.06],roughness=0.82,amount=0.5,seed=41)
        step(**T,faces=A,pattern='bumps',scale=1.6,octaves=4,stretch=[1,1,12],threshold=0.66,softness=0.1,color=[0.6,0.6,0.59],roughness=0.6,amount=0.3,seed=47)
        step(**T,faces=A,where='edges',reach=0.5,pattern='bumps',scale=0.9,octaves=5,fray=0.8,threshold=0.5,softness=0.14,color=[0.62,0.62,0.6],roughness=0.62,amount=0.6,seed=2)
        step(**T,faces=G,where='edges',reach=0.16,pattern='bumps',scale=0.3,octaves=4,fray=1,threshold=0.8,softness=0.04,color=[0.3,0.3,0.31],roughness=0.3,metallic=0.9,seed=4)
        step(**T,faces='plate',pattern='scratches',scale=3.2,width=0.012,threshold=0.5,softness=0.3,color=[0.6,0.6,0.6],roughness=0.3,amount=0.6,seed=3)
        step(**T,faces={'tag':['plate','trim']},pattern='scratches',scale=1.1,width=0.012,threshold=0.5,softness=0.3,roughness=0.28,amount=0.45,seed=13)
        step(**T,faces={'tag':['plate','trim']},pattern='pores',scale=0.5,width=0.18,threshold=0.5,softness=0.2,color=[0.045,0.04,0.036],roughness=0.9,amount=0.6,seed=8)
        step(**T,faces={'not':{'tag':['window','port','lamp','thrust']}},where='cavity',reach=0.35,threshold=0.3,softness=0.12,color=[0.016,0.014,0.012],roughness=0.95,metallic=0,amount=0.9)
        for (x,y,z,r) in [(4.5,0,-47,12),(-4.5,0,-47,12),(17,-1,-49,8.5),(-17,-1,-49,8.5)]:
            step(**T,faces={'not':{'tag':['thrust','lamp','window','port']}},near={'at':[x,y,z],'radius':r},pattern='bumps',scale=2.5,octaves=4,threshold=0.3,softness=0.3,color=[0.018,0.016,0.014],roughness=0.86,amount=0.82,seed=30)
            step(**T,faces='nozzle',near={'at':[x,y,z+2.5],'radius':3.4},color=[0.35,0.6,1.0],glow=0.35,amount=0.9)
        step(op='decimate',**{'from':'blockout'},ratio=1)
        src['normalBake']={'from':'dense','size':MAP,'distance':0.7,'color':True,'surface':True,'occlusion':{'samples':36,'size':min(1024,MAP//2),'reach':3.0}}
    return src


SMALL = {
    'planet': {'version': 1, 'smoothAngle': 80, 'material': {'roughness': 0.92, 'metallic': 0, 'texture': 'assets/textures/giant.png'},
               'steps': [{'op': 'sphere', 'radius': 1, 'rings': 64, 'sides': 128, 'tag': 'planet', 'color': [1, 1, 1]}, {'op': 'uv', 'mode': 'sphere'}]},
    'shell': {'version': 1, 'smoothAngle': 80, 'steps': [{'op': 'sphere', 'radius': 1, 'rings': 48, 'sides': 96, 'tag': 'shell', 'color': [1, 1, 1]}]},
    **{name: {'version': 1, 'smoothAngle': 60, 'material': {'roughness': 0.92, 'metallic': 0},
              'normalBake': {'from': 'dense', 'size': 1024, 'color': True, 'surface': True, 'occlusion': {'samples': 36, 'size': 512, 'reach': 0.35}},
              'steps': [
                  {'op': 'sphere', 'radius': 1, 'rings': 48, 'sides': 96, 'tag': 'rock', 'color': tone},
                  {'op': 'transform', 'scale': squash},
                  {'op': 'displace', 'pattern': 'bumps', 'amplitude': 0.42, 'scale': 1.6, 'octaves': 3, 'seed': seed, 'detail': 0.06},
                  {'op': 'displace', 'pattern': 'bumps', 'amplitude': 0.12, 'scale': 0.45, 'octaves': 4, 'seed': seed + 6, 'detail': 0.04},
                  {'op': 'displace', 'pattern': 'pores', 'amplitude': -0.09, 'scale': 0.7, 'width': 0.5, 'seed': seed + 2, 'detail': 0.035, 'id': 'dense'},
                  {'op': 'stain', 'texel': True, 'pattern': 'bumps', 'scale': 0.9, 'octaves': 5, 'threshold': 0.5, 'softness': 0.3, 'color': [0.3, 0.27, 0.24], 'roughness': 0.85, 'amount': 0.4, 'seed': seed + 3},
                  {'op': 'stain', 'texel': True, 'pattern': 'bumps', 'scale': 0.25, 'octaves': 4, 'threshold': 0.58, 'softness': 0.15, 'color': [0.11, 0.1, 0.095], 'amount': 0.35, 'seed': seed + 9},
                  {'op': 'stain', 'texel': True, 'where': 'edges', 'reach': 0.1, 'threshold': 0.4, 'softness': 0.2, 'color': [0.42, 0.39, 0.35], 'amount': 0.5},
                  {'op': 'stain', 'texel': True, 'where': 'cavity', 'reach': 0.12, 'threshold': 0.3, 'softness': 0.15, 'color': [0.03, 0.028, 0.026], 'amount': 0.8},
                  {'op': 'decimate', 'from': 'dense', 'triangles': 2400, 'error': 0.2},
              ]}
       for name, seed, squash, tone in [('rock-a', 3, [1.35, 0.85, 1.0], [0.2, 0.185, 0.17]), ('rock-b', 17, [0.9, 1.1, 1.3], [0.17, 0.165, 0.16]), ('rock-c', 29, [1.1, 0.7, 0.8], [0.23, 0.2, 0.17])]},
    'plume': {'version': 1, 'smoothAngle': 80,
              'steps': [{'op': 'lathe', 'axis': 'z', 'profile': [[0.0, 0.0], [0.62, 0.0], [0.78, -0.6], [0.5, -3.2], [0.16, -7.5], [0.0, -11.0]], 'sides': 32, 'curve': 3, 'tag': 'plume', 'color': [1, 1, 1]}]},
}


def make_models():
    sources = {'frigate': ship_source(), **SMALL}
    for name, source in sources.items():
        if MODELS_ONLY and name not in MODELS_ONLY:
            continue
        path = MODELS / f'{name}.esmodel'
        path.write_text(json.dumps(source, indent=1) + '\n')
        run('bake-model', path)
    for path in sorted(MODELS.iterdir()):
        if path.suffix != '.meta':
            stamp(path)


def make_materials():
    docs = {
        'atmosphere': {'version': '1.0', 'type': 'material', 'shader': 'atmosphere.esshader', 'blendMode': 5, 'depthTest': True, 'depthWrite': False, 'cull': 1,
                       'properties': {'u_rim': {'r': 0.45, 'g': 0.68, 'b': 1.0, 'a': 1}, 'u_power': 5.0, 'u_strength': 1.6, 'u_sun': [-SUN[0], -SUN[1], -SUN[2]]}},
        'plume': {'version': '1.0', 'type': 'material', 'shader': 'plume.esshader', 'blendMode': 5, 'depthTest': True, 'depthWrite': False, 'cull': 0,
                  'properties': {'u_core': {'r': 0.8, 'g': 0.93, 'b': 1.0, 'a': 1}, 'u_edge': {'r': 0.08, 'g': 0.32, 'b': 1.0, 'a': 1}, 'u_strength': 4, 'u_length': 11, 'u_flicker': 0.12}},
    }
    for name, doc in docs.items():
        path = MAT / f'{name}.esmaterial'
        path.write_text(json.dumps(doc, indent=2) + '\n')
        stamp(path, 'material')
        stamp(MAT / f'{name}.esshader', 'shader')
    hull = MODELS / 'frigate.esmaterial'
    if hull.exists():
        doc = json.loads(hull.read_text())
        doc['properties'].update({'u_detailMap': SHIP_DETAIL['texture'], 'u_detailSize': SHIP_DETAIL['size'], 'u_detailStrength': SHIP_DETAIL['strength'], 'u_detailBump': SHIP_DETAIL['bump']})
        hull.write_text(json.dumps(doc, indent=2) + '\n')


def look(eye, target):
    f = [t - e for e, t in zip(eye, target)]
    l = math.sqrt(sum(x * x for x in f))
    f = [x / l for x in f]
    up = (0, 0, 1) if abs(f[1]) > 0.99 else (0, 1, 0)
    r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]
    l = math.sqrt(sum(x * x for x in r))
    r = [x / l for x in r]
    u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
    m = [[r[0], u[0], -f[0]], [r[1], u[1], -f[1]], [r[2], u[2], -f[2]]]
    t = m[0][0] + m[1][1] + m[2][2]
    if t > 0:
        s = math.sqrt(t + 1) * 2
        return {'x': (m[2][1] - m[1][2]) / s, 'y': (m[0][2] - m[2][0]) / s, 'z': (m[1][0] - m[0][1]) / s, 'w': s / 4}
    if m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2
        return {'x': s / 4, 'y': (m[0][1] + m[1][0]) / s, 'z': (m[0][2] + m[2][0]) / s, 'w': (m[2][1] - m[1][2]) / s}
    if m[1][1] > m[2][2]:
        s = math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2
        return {'x': (m[0][1] + m[1][0]) / s, 'y': s / 4, 'z': (m[1][2] + m[2][1]) / s, 'w': (m[0][2] - m[2][0]) / s}
    s = math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2
    return {'x': (m[0][2] + m[2][0]) / s, 'y': (m[1][2] + m[2][1]) / s, 'z': s / 4, 'w': (m[1][0] - m[0][1]) / s}


def make_scene():
    entities = []

    def v3(p):
        return {'x': p[0], 'y': p[1], 'z': p[2]}

    def add(name, components, parent=None):
        entity = {'id': len(entities), 'name': name, 'parent': parent, 'children': [], 'visible': True, 'components': components}
        entities.append(entity)
        if parent is not None:
            entities[parent]['children'].append(entity['id'])
        return entity['id']

    def transform(at=(0, 0, 0), rotation=None, scale=None):
        data = {'position': v3(at)}
        if rotation:
            data['rotation'] = rotation
        if scale:
            data['scale'] = v3(scale)
        return {'type': 'Transform', 'data': data}

    def mesh(mesh, material=None, texture=None, lit=True, opaque=True, cull=True, shadows=True):
        data = {'mesh': f'assets/models/{mesh}.esmesh', 'color': {'r': 1, 'g': 1, 'b': 1, 'a': 1}, 'enabled': True, 'lit': lit, 'opaque': opaque, 'cullBackfaces': cull, 'castShadows': shadows}
        if material:
            data['material'] = material
        if texture:
            data['texture'] = texture
        return {'type': 'MeshRenderer', 'data': data}

    eye, target = (70, 14, 80), (0, 1, -6)
    effects = [
        {'type': 'starfield', 'enabled': True, 'uniforms': {'u_intensity': 1.0, 'u_density': 0.7, 'u_size': 1.0, 'u_band': 0.6, 'u_bandTilt': 25, 'u_bandTurn': 40, 'u_sunSize': 1.3, 'u_sunGlow': 1.0}},
        {'type': 'ssao', 'enabled': True, 'uniforms': {'u_radius': 4, 'u_intensity': 1.2, 'u_bias': 0.05, 'u_power': 1.6}},
        {'type': 'bloom', 'enabled': True, 'uniforms': {'u_threshold': 1.0, 'u_intensity': 0.8, 'u_radius': 1}},
        {'type': 'colorGrade', 'enabled': True, 'uniforms': {'u_exposure': -0.15, 'u_contrast': 1.1, 'u_saturation': 1.08}},
        {'type': 'sharpen', 'enabled': True, 'uniforms': {'u_intensity': 0.3, 'u_limit': 0.25}},
        {'type': 'filmGrain', 'enabled': True, 'uniforms': {'u_intensity': 0.06, 'u_size': 1.4, 'u_response': 0.8}},
        {'type': 'vignette', 'enabled': True, 'uniforms': {'u_intensity': 0.4, 'u_softness': 0.6}},
    ]
    add('Camera', [
        transform(eye, look(eye, target)),
        {'type': 'Camera', 'data': {'projectionType': 0, 'fov': 34, 'nearPlane': 1, 'farPlane': 30000, 'isActive': True, 'priority': 0, 'clearFlags': 3}},
        {'type': 'PostProcessVolume', 'data': {'isGlobal': True, 'weight': 1, 'priority': 0, 'effects': effects}},
    ])
    add('Sun', [transform((0, 0, 0), look((0, 0, 0), SUN)),
                {'type': 'Light', 'data': {'type': 1, 'color': {'r': 1, 'g': 0.94, 'b': 0.86, 'a': 1}, 'intensity': 1.5, 'enabled': True, 'meshShadows': True, 'shadowDistance': 260, 'sourceAngle': 0}}])
    add('Sky', [transform(), {'type': 'Light', 'data': {'type': 2, 'color': {'r': 1, 'g': 1, 'b': 1, 'a': 1}, 'intensity': 1.5, 'enabled': True, 'environment': 'assets/env/nebula.esenv', 'drawEnvironment': True}}])
    shine = [-c / math.sqrt(sum(x * x for x in PLANET_AT)) for c in PLANET_AT]
    add('PlanetShine', [transform((0, 0, 0), look((0, 0, 0), shine)),
                        {'type': 'Light', 'data': {'type': 1, 'color': {'r': 1, 'g': 0.72, 'b': 0.45, 'a': 1}, 'intensity': 0.4, 'enabled': True, 'meshShadows': False}}])
    add('Rim', [transform((0, 0, 0), look((0, 0, 0), (0.55, 0.2, 0.8))),
                {'type': 'Light', 'data': {'type': 1, 'color': {'r': 0.62, 'g': 0.74, 'b': 1.0, 'a': 1}, 'intensity': 0.26, 'enabled': True, 'meshShadows': False}}])
    ship = add('Ship', [transform()])
    add('Hull', [transform(), mesh('frigate', 'assets/models/frigate.esmaterial', 'assets/models/frigate_color.png')], ship)
    for name, at, wide, long in [('PlumeL', (4.5, 0, -47.6), 4.0, 2.3), ('PlumeR', (-4.5, 0, -47.6), 4.0, 2.3), ('PlumeNL', (17, -1, -48.7), 3.0, 1.7), ('PlumeNR', (-17, -1, -48.7), 3.0, 1.7)]:
        add(name, [transform(at, None, (wide, wide, long)), mesh('plume', 'assets/materials/plume.esmaterial', None, False, False, False, False)], ship)
    for name, at in [('EngineGlowL', (4.5, 0, -52)), ('EngineGlowR', (-4.5, 0, -52)), ('EngineGlowNL', (17, -1, -52)), ('EngineGlowNR', (-17, -1, -52))]:
        add(name, [transform(at), {'type': 'Light', 'data': {'type': 0, 'color': {'r': 0.6, 'g': 0.75, 'b': 1.0, 'a': 1}, 'intensity': 0.4, 'radius': 14, 'enabled': True, 'meshShadows': False}}], ship)
    rocks = random.Random(47)
    for placed in range(46):
        far = placed >= 40
        size = rocks.uniform(90, 240) if far else rocks.uniform(4, 11) * (1 + 3 * rocks.random() ** 4)
        clear = 600 if far else 300 + size * 9
        at = (0, 0, 0)
        while math.hypot(at[0], at[1]) < clear:
            reach = rocks.uniform(1500, 2600) if far else rocks.uniform(clear, clear + 800)
            turn, lift = rocks.uniform(0, 2 * math.pi), rocks.uniform(-0.5, 0.22)
            at = (math.cos(turn) * math.cos(lift) * reach, math.sin(lift) * reach - 40, math.sin(turn) * math.cos(lift) * reach)
        spin = [rocks.gauss(0, 1) for _ in range(4)]
        norm = math.sqrt(sum(q * q for q in spin))
        kind = 'rock-' + 'abc'[placed % 3]
        add(f'Rock{placed}', [transform(at, {'x': spin[0] / norm, 'y': spin[1] / norm, 'z': spin[2] / norm, 'w': spin[3] / norm}, (size,) * 3),
                              mesh(kind, f'assets/models/{kind}.esmaterial', f'assets/models/{kind}_color.png', True, True, True, False)])
    add('Planet', [transform(PLANET_AT, None, (PLANET_RADIUS,) * 3), mesh('planet', 'assets/models/planet.esmaterial', 'assets/textures/giant.png', True, True, True, False)])
    add('Atmosphere', [transform(PLANET_AT, None, (PLANET_RADIUS * 1.022,) * 3), mesh('shell', 'assets/materials/atmosphere.esmaterial', None, False, False, True, False)])
    SCENE.write_text(json.dumps({'version': 4, 'name': 'SpaceFrigate', 'entities': entities}, indent=1) + '\n')
    stamp(SCENE, 'scene')


for part, make in (('sky', make_sky), ('planet', make_planet), ('grain', make_grain), ('models', make_models), ('materials', make_materials), ('scene', make_scene)):
    if part in ONLY:
        make()
        print(part, 'done')
