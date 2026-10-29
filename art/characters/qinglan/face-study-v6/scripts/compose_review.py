"""Lay out unchanged renders; no painted corrections or synthesized face images."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
fig,axes=plt.subplots(2,3,figsize=(12,10),dpi=140,facecolor='#e7e9ec')
for row,state in enumerate(('before','after')):
    for col,name in enumerate(('front','threequarter','profile')):
        ax=axes[row,col];ax.imshow(plt.imread(ROOT/'review'/f'{state}-{name}.png'));ax.axis('off')
        ax.set_title(('V5 source' if row==0 else 'V6 live revision')+' | '+name,fontsize=11,pad=7)
fig.suptitle('QINGLAN | NATIVE BRUSH REVIEW',fontsize=17,y=.99)
fig.text(.5,.018,'Same cameras, lights and neutral materials. Eye geometry also adjusted. Art acceptance pending.',ha='center',fontsize=10)
fig.subplots_adjust(left=.02,right=.98,top=.945,bottom=.045,hspace=.10,wspace=.02)
fig.savefig(ROOT/'review/before-after.png',facecolor=fig.get_facecolor());plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(12,6),dpi=130,facecolor='#e7e9ec')
for ax,name in zip(axes,('front','threequarter','profile')):
    ax.imshow(plt.imread(ROOT/'review'/f'after-{name}.png'));ax.axis('off');ax.set_title(name,fontsize=12)
fig.suptitle('QINGLAN | V6 FACE CANDIDATE',fontsize=17,y=.98)
fig.text(.5,.025,'Native sculpt revision - still needs facial identity refinement',ha='center',fontsize=11)
fig.subplots_adjust(left=.02,right=.98,top=.89,bottom=.065,wspace=.02)
fig.savefig(ROOT/'review/face-review.png',facecolor=fig.get_facecolor());plt.close(fig)
print('FACE_COMPARISON_READY')
