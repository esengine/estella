"""Technical contact sheets of unaltered Blender renders and the working reference."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
fig,axes=plt.subplots(1,3,figsize=(15,7),dpi=120,facecolor='#e7e9ec')
for ax,name,label in zip(axes,['front','threequarter','profile'],['Front / orthographic','Three-quarter / 90 mm','Profile / orthographic']):
    ax.imshow(plt.imread(ROOT/'review'/f'{name}.png'));ax.axis('off');ax.set_title(label,fontsize=13,pad=10)
fig.suptitle('QINGLAN  |  FACE GEOMETRY STUDY',fontsize=20,y=.97)
fig.text(.5,.025,'Editable candidate - facial likeness pending - neutral materials, no hair or skin texture',ha='center',fontsize=12)
fig.subplots_adjust(left=.02,right=.98,top=.865,bottom=.07,wspace=.025)
fig.savefig(ROOT/'review/face-review.png',facecolor=fig.get_facecolor());plt.close(fig)
ref=plt.imread(ROOT.parent/'references/qinglan-face-target.png')
fig,axes=plt.subplots(1,2,figsize=(9,7),dpi=130,facecolor='#e7e9ec')
axes[0].imshow(ref[:828,:592]);axes[0].set_title('Working design reference',fontsize=13)
axes[1].imshow(plt.imread(ROOT/'review/front.png'));axes[1].set_title('Current neutral geometry',fontsize=13)
for ax in axes:ax.axis('off')
fig.suptitle('FACE IDENTITY REVIEW - NOT AN ACCEPTANCE',fontsize=15,y=.98)
fig.text(.5,.025,'Visual comparison only; the reference is not a calibrated camera reconstruction.',ha='center',fontsize=10)
fig.subplots_adjust(left=.02,right=.98,top=.92,bottom=.07,wspace=.06)
fig.savefig(ROOT/'review/reference-comparison.png',facecolor=fig.get_facecolor());plt.close(fig)
print('FACE_REVIEW_SHEETS_READY')
