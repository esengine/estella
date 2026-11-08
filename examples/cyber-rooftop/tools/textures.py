"""Deterministic original surface maps and signage for the rooftop scene."""
from pathlib import Path
import random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/textures'
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(2207)
FONT = 'C:/Windows/Fonts/msyh.ttc'

def surface(name, base, size=512, seams=False):
    image = Image.new('RGB', (size, size))
    px = image.load()
    for y in range(size):
        for x in range(size):
            n = rng.gauss(0, 5) + math.sin(x*.12)*1.5
            px[x,y] = tuple(max(0, min(255, int(c+n))) for c in base)
    d = ImageDraw.Draw(image)
    for _ in range(650):
        x,y = rng.randrange(size),rng.randrange(size)
        c = tuple(max(0, v-rng.randrange(5,28)) for v in base)
        d.line((x,y,x+rng.randrange(2,35),y+rng.randrange(-1,2)), fill=c)
    if seams:
        for y in range(0,size,128):
            d.line((0,y,size,y), fill=(8,13,19),width=3)
            d.line((0,y+3,size,y+3), fill=(62,70,76),width=1)
        for x in range(0,size,128):
            d.line((x,0,x,size), fill=(8,13,19),width=3)
        for x in range(7,size,128):
            for y in range(7,size,128):
                d.ellipse((x,y,x+3,y+3),fill=(106,116,125))
    image.save(OUT/f'{name}.png')

surface('steel',(85,91,93))
surface('paint',(129,125,107))
surface('roof',(44,53,62),seams=True)
surface('rubber',(57,66,77))
surface('tarp',(39,43,39))
surface('tool-metal',(40,46,49))
surface('ochre',(163,104,35))

# Multiscale aggregate and rain pits, without regular sine-wave ridges.
height=Image.new('L',(512,512));hp=height.load()
for y in range(512):
    for x in range(512):hp[x,y]=max(0,min(255,int(rng.gauss(128,42))))
coarse=height.filter(ImageFilter.GaussianBlur(5));fine=height.filter(ImageFilter.GaussianBlur(.65))
hp=fine.load();cp=coarse.load()
normal=Image.new('RGB',(512,512)); np=normal.load()
orm=Image.new('RGB',(512,512)); op=orm.load()
for y in range(512):
    for x in range(512):
        dx=(hp[(x+1)%512,y]-hp[(x-1)%512,y])*1.8
        dy=(hp[x,(y+1)%512]-hp[x,(y-1)%512])*1.8
        np[x,y]=(int(max(4,min(251,128-dx))),int(max(4,min(251,128-dy))),226)
        op[x,y]=(255,max(65,min(220,int(150+(cp[x,y]-128)*5+(hp[x,y]-128)*.5))),160)
normal.save(OUT/'roof-normal.png');orm.save(OUT/'roof-orm.png')
ImageOps.autocontrast(coarse).filter(ImageFilter.GaussianBlur(1.5)).save(OUT/'roof-wetness.png')

for i, (label,col) in enumerate([
    ('自由港',(255,45,162)), ('未来医疗',(48,217,255)),
    ('夜市',(255,114,34)), ('义体改造',(86,177,255)),
    ('新生活',(255,61,178)), ('旅館',(49,235,221)),
]):
    im=Image.new('RGB',(256,1024),(6,12,25)); d=ImageDraw.Draw(im)
    d.rectangle((8,8,247,1015),outline=col,width=5)
    d.line((22,32,22,992),fill=col,width=2)
    font=ImageFont.truetype(FONT,161)
    for j,c in enumerate(label):
        d.text((46,90+j*190),c,font=font,fill=col,stroke_width=1)
    d.text((43,910),'24 / 7',font=ImageFont.truetype(FONT,39),fill=(180,215,231))
    im.save(OUT/f'sign-{i}.png')

# A luminous equipment display; all marks remain original and editable.
im=Image.new('RGB',(256,256),(2,22,30)); d=ImageDraw.Draw(im)
d.rounded_rectangle((8,8,248,248),20,outline=(35,237,255),width=6)
d.polygon([(42,118),(128,76),(218,115),(132,161)],outline=(60,255,255),width=6)
d.line([(42,118),(42,141),(132,186),(218,141),(218,115)],fill=(60,255,255),width=5)
d.line((132,161,132,186),fill=(60,255,255),width=5)
d.text((32,208),'BUILD / 04',font=ImageFont.truetype(FONT,23),fill=(74,224,241))
im.save(OUT/'tool-display.png')
print('Surface textures and signage written.')

# Crisp pictograms authored as editable paths, with supersampling for the native HUD.
for name in ['city','rain','health','cyber','water','energy','steel','chip']:
    im=Image.new('RGBA',(96,96));d=ImageDraw.Draw(im);col=(137,221,244,255)
    if name=='city':
        for x,h in [(15,45),(31,65),(49,80),(67,55)]:
            d.rectangle((x,88-h,x+12,83),outline=col,width=3)
            for y in range(91-h,80,9):d.line((x+4,y,x+8,y),fill=col,width=2)
        d.line((7,88,89,88),fill=col,width=3)
    elif name=='rain':
        d.ellipse((24,17,62,50),fill=col);d.ellipse((47,27,78,53),fill=col);d.rounded_rectangle((13,35,80,57),10,fill=col)
        for x in [29,47,65]:d.line((x,64,x-9,80),fill=col,width=5)
    elif name=='health':d.polygon([(38,12),(59,12),(59,38),(84,38),(84,59),(59,59),(59,85),(38,85),(38,59),(12,59),(12,38),(38,38)],fill=(188,236,248))
    elif name=='cyber':
        d.arc((13,13,80,80),30,330,fill=col,width=8);d.polygon([(76,21),(90,34),(70,37)],fill=col)
        d.ellipse((34,27,61,52),fill=col);d.polygon([(35,45),(61,45),(67,69),(27,69)],fill=col)
    elif name=='water':
        d.polygon([(48,7),(17,59),(19,75),(31,87),(61,87),(77,72),(78,59)],fill=(25,190,239))
        d.arc((24,43,68,80),60,180,fill=(186,245,255),width=4)
    elif name=='energy':d.polygon([(58,4),(15,55),(43,55),(34,93),(80,37),(51,37)],fill=(255,222,23))
    elif name=='steel':
        d.polygon([(12,49),(57,19),(86,34),(43,68)],fill=(157,177,188),outline=col,width=3)
        d.polygon([(12,49),(43,68),(43,81),(12,64)],fill=(48,68,82),outline=col,width=2)
        d.polygon([(43,68),(86,34),(86,48),(43,81)],fill=(86,114,128),outline=col,width=2)
    else:
        d.polygon([(15,43),(58,16),(83,48),(40,80)],fill=(40,128,155),outline=col,width=3)
        d.polygon([(34,42),(52,31),(65,49),(48,61)],fill=(23,41,48),outline=col,width=2)
        for j in range(5):d.line((24+j*8,39-j*5,17+j*8,29-j*5),fill=col,width=3)
    im.save(OUT/f'hud-symbol-{name}.png')

def iso(d,x,y,w,h,depth,color):
    a=(x,y); b=(x+w,y-h*.45); c=(x+w+depth,y-h*.45+depth*.4); e=(x+depth,y+depth*.4)
    d.polygon([a,b,c,e],fill=color,outline=(167,193,203,255),width=2)
    d.polygon([e,c,(c[0],c[1]+h),(e[0],e[1]+h)],fill=tuple(int(v*.65) for v in color[:3])+(255,),outline=(98,131,151,255),width=2)
    d.polygon([a,e,(e[0],e[1]+h),(x,y+h)],fill=tuple(int(v*.40) for v in color[:3])+(255,),outline=(98,131,151,255),width=2)
for k in range(8):
    im=Image.new('RGBA',(128,100)); d=ImageDraw.Draw(im)
    if k==0:
        iso(d,23,38,58,21,23,(181,123,40,255)); iso(d,56,63,15,28,12,(70,90,107,255)); d.rectangle((76,40,95,58),fill=(8,37,46),outline=(33,226,243),width=3)
    elif k==1:
        iso(d,49,45,16,38,15,(168,44,53,255)); d.ellipse((24,9,77,56),fill=(56,68,78),outline=(177,198,204),width=5); d.ellipse((41,26,61,42),fill=(151,42,41))
    elif k==2:
        iso(d,32,29,43,48,15,(97,121,136,255)); d.polygon([(47,36),(76,23),(76,59),(47,72)],fill=(5,43,54),outline=(36,211,239),width=3)
    elif k==3:
        iso(d,14,43,64,7,35,(157,183,198,255));
        for x,y in [(17,47),(79,22),(110,38),(49,60)]: d.rectangle((x,y,x+5,y+10),fill=(204,226,235))
    elif k==4:
        iso(d,32,25,51,52,14,(125,140,146,255)); d.line((62,24,62,73),fill=(44,62,73),width=4)
    elif k==5:
        iso(d,32,24,45,51,20,(50,67,82,255)); d.line((49,31,49,78),fill=(255,165,30),width=7); d.line((79,19,79,65),fill=(255,165,30),width=7)
    elif k==6:
        iso(d,27,35,48,40,20,(183,32,48,255)); d.rectangle((60,40,67,68),fill='white'); d.rectangle((51,49,76,57),fill='white')
    else:
        iso(d,42,26,33,51,17,(180,151,98,255)); d.ellipse((51,37,80,65),fill=(220,224,190),outline=(124,66,40),width=3)
    im.save(OUT/f'hud-item-{k+1}.png')
print('HUD pictograms and fallback inventory icons written.')

# Border sources are independent of the inventory and minimap artwork.
import runpy
runpy.run_path(str(ROOT/'tools/hud.py'))
