"""Technical comparison of unchanged source images and Blender renders."""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from PIL import Image
import json
ROOT=Path(__file__).resolve().parents[1]
REF=ROOT.parent/'references/qinglan-face-target.png'
font=FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
ref=np.array(Image.open(REF).convert('RGB'))[:828,:592]
v6=np.array(Image.open(ROOT.parent/'face-study-v6/review/after-front.png').convert('RGB'))
model=np.array(Image.open(ROOT/'review/after-front.png').convert('RGB'))
anchors=[((203.5,364.5),(377.5,364.5)),((214.5,347.0),(385.5,347.0)),((214.5,347.0),(385.5,347.0))]
projection=json.loads((ROOT/'review/projected-pupils.json').read_text())
anchors[2]=(projection['Review_front']['R'],projection['Review_front']['L'])
def place(ax,im,pts,alpha=1):
    (x1,y1),(x2,y2)=pts;d=x2-x1;cx=(x1+x2)/2;cy=(y1+y2)/2
    h,w=im.shape[:2];ax.imshow(im,extent=(-cx/d,(w-cx)/d,(h-cy)/d,-cy/d),alpha=alpha)
    ax.set_xlim(-1.25,1.25);ax.set_ylim(1.80,-.50);ax.axis('off')
fig,axes=plt.subplots(1,4,figsize=(16,6.5),dpi=120,facecolor='#edf0f3')
for ax,im,pts,title in zip(axes,(ref,v6,model),anchors,('设计稿','上一版 V6','控制网格调整 V7')):
    place(ax,im,pts);ax.set_title(title,fontproperties=font,fontsize=15)
    ax.axhline(0,color='#35c5e6',lw=.8);ax.axvline(0,color='white',alpha=.3,lw=.5)
place(axes[3],ref,anchors[0]);place(axes[3],model,anchors[2],.40)
axes[3].set_title('设计稿 / V7 叠加',fontproperties=font,fontsize=15)
fig.suptitle('青岚 · 脸部比例检查',fontproperties=font,fontsize=20,y=.97)
fig.text(.5,.03,'统一瞳距与眼线；手动近似锚点。参考未标定，叠加用于发现比例问题，不能作为精确重建证明。',fontproperties=font,ha='center',fontsize=10)
fig.subplots_adjust(left=.01,right=.99,top=.90,bottom=.08,wspace=.03)
fig.savefig(ROOT/'review/reference-overlay.png');plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(12,6),dpi=130,facecolor='#edf0f3')
for ax,name in zip(axes,('front','threequarter','profile')):
    ax.imshow(plt.imread(ROOT/'review'/f'after-{name}.png'));ax.axis('off');ax.set_title(name,fontsize=12)
fig.suptitle('QINGLAN | V7 CONTROL-CAGE STUDY',fontsize=17,y=.98)
fig.text(.5,.025,'Editable proportions and brow proxies. Facial identity remains under review.',ha='center',fontsize=10)
fig.subplots_adjust(left=.02,right=.98,top=.89,bottom=.065,wspace=.02)
fig.savefig(ROOT/'review/face-review.png');plt.close(fig)

sheet=np.array(Image.open(REF).convert('RGB'))
fig,axes=plt.subplots(2,3,figsize=(12,9),dpi=140,facecolor='#edf0f3')
for col,name in enumerate(('front','profile','threequarter')):
    crop=sheet[:828,[0,592,1182][col]:[592,1182,1774][col]]
    render=np.array(Image.open(ROOT/'review'/f'reference-camera-{name}.png').convert('RGB'))
    if name=='profile':
        # Approximate visual eye/chin anchors; the reference camera is unknown.
        transforms=[(461,362,(634-362)/1.6),(projection['Reference_profile']['R'][0],projection['Reference_profile']['R'][1],(606-projection['Reference_profile']['R'][1])/1.6)]
        limits=(-1.65,.67)
    else:
        refpts=anchors[0] if name=='front' else ((101,366),(257,361))
        modpts=(projection['Reference_'+name]['R'],projection['Reference_'+name]['L'])
        transforms=[((a[0]+b[0])/2,(a[1]+b[1])/2,b[0]-a[0]) for a,b in (refpts,modpts)]
        limits=(-1.23,1.23) if name=='front' else (-1.10,1.60)
    for row,(im,(cx,cy,d)) in enumerate(zip((crop,render),transforms)):
        ax=axes[row,col];h,w=im.shape[:2]
        ax.imshow(im,extent=(-cx/d,(w-cx)/d,(h-cy)/d,-cy/d))
        ax.set_xlim(*limits);ax.set_ylim(1.85,-.60);ax.axis('off')
        ax.axhline(0,color='#35c5e6',lw=.6,alpha=.6)
        ax.set_title(('设计稿' if row==0 else 'V7 透视检查')+' · '+name,fontproperties=font,fontsize=12)
fig.suptitle('青岚 · 多角度身份检查',fontproperties=font,fontsize=19,y=.985)
fig.text(.5,.022,'90 mm 透视；侧面约 72°、三分之四约 25°。人工近似对齐，镜头未标定；保留灰模差异供继续修改。',fontproperties=font,ha='center',fontsize=10)
fig.subplots_adjust(left=.025,right=.975,top=.90,bottom=.065,hspace=.16,wspace=.05)
fig.savefig(ROOT/'review/reference-multiview.png');plt.close(fig)
print('COMPARISONS_READY')
