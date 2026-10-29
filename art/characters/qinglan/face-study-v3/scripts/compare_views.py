"""Scientific review figures: fixed-scale renders, reference projections.

Requires numpy/matplotlib. The reference stays separate from the rendered asset.
"""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.image as mi

ROOT=Path(__file__).resolve().parents[1]
REVIEW=ROOT/'review'
ref=mi.imread(ROOT.parent/'references/qinglan-face-target.png')
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.titleweight':'bold'})
bg=(.49,.52,.56)

def show(ax,img,title):
    ax.set_facecolor(bg);ax.imshow(img);ax.set_xlim(0,592);ax.set_ylim(828,0)
    ax.set_xticks([]);ax.set_yticks([]);ax.set_title(title,pad=10)
    for s in ax.spines.values():s.set_visible(False)

fig,axes=plt.subplots(2,3,figsize=(12,11.7),dpi=150,facecolor='#e9ebee')
for row,(view,x) in enumerate([('front',0),('reference-side',592)]):
    show(axes[row,0],ref[:828,x:x+592],view.title()+' / reference')
    show(axes[row,1],mi.imread(REVIEW/f'before-{view}-clay.png'),'Preserved previous cage')
    show(axes[row,2],mi.imread(REVIEW/f'after-{view}-eyes.png'),'Current mesh / neutral clay')
fig.suptitle('QINGLAN | FACE CAGE STUDY\nSame scale and vertical alignment; no hair or skin texture on mesh',fontsize=15,y=.99)
fig.subplots_adjust(left=.02,right=.98,bottom=.02,top=.90,wspace=.03,hspace=.10)
fig.savefig(REVIEW/'reference-before-after.png');plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(15,7.3),dpi=160,facecolor='#e9ebee')
for col,(view,x) in enumerate([('front',0),('reference-side',592),('three-quarter',1184)]):
    show(axes[col],ref[:828,x:x+592],view.title()+' / 48% mesh overlay')
    axes[col].imshow(mi.imread(REVIEW/f'after-{view}-clay.png'),alpha=.48)
fig.suptitle('Reference overlay | camera calibration is fixed',fontsize=15)
fig.subplots_adjust(left=.02,right=.98,bottom=.02,top=.91,wspace=.025)
fig.savefig(REVIEW/'reference-overlay.png');plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(12,5.9),dpi=150,facecolor='#e9ebee')
for ax,view in zip(axes,['front','three-quarter','profile']):
    show(ax,mi.imread(REVIEW/f'after-{view}-eyes.png'),view.replace('-',' ').title())
fig.suptitle('QINGLAN | Editable head study',fontsize=16,y=.99)
fig.subplots_adjust(left=.02,right=.98,bottom=.025,top=.90,wspace=.03)
fig.savefig(REVIEW/'face-clay-review.png');plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(12,5.9),dpi=150,facecolor='#e9ebee')
for ax,view in zip(axes,['front','three-quarter','profile']):
    show(ax,mi.imread(REVIEW/f'cage-{view}-wire.png'),view.replace('-',' ').title())
fig.suptitle('QINGLAN | Actual base-cage edges',fontsize=16,y=.99)
fig.subplots_adjust(left=.02,right=.98,bottom=.025,top=.90,wspace=.03)
fig.savefig(REVIEW/'face-wire-review.png');plt.close(fig)
print('REVIEW_FIGURES_WRITTEN')
