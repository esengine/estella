"""Technical projection of cage indices, for vertex-level facial editing."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
source=json.loads((ROOT/'head-cage.json').read_text())
base=np.array([v['co'] for v in source['vertices']]);fitted=np.array(json.loads((ROOT/'fitted-cage.json').read_text()))
for region,limits in [('eye',(.008,.065,1.587,1.613)),('mouth',(-.027,.027,1.516,1.540))]:
    x0,x1,z0,z1=limits
    ids=[i for i,(x,y,z) in enumerate(base) if x0<x<x1 and z0<z<z1 and y<-.115]
    fig,axes=plt.subplots(2,1,figsize=(18,15),dpi=130)
    for ax,coords,title in zip(axes,[base,fitted],['Preserved cage','Fitted cage']):
        for a,b in source['edges']:
            if a in ids and b in ids:ax.plot(coords[[a,b],0]*1000,coords[[a,b],2]*1000,color='.72',lw=.8)
        ax.scatter(coords[ids,0]*1000,coords[ids,2]*1000,c=coords[ids,1],s=10,cmap='viridis')
        for i in ids:ax.text(coords[i,0]*1000,coords[i,2]*1000,str(i),fontsize=7)
        ax.set_aspect('equal');ax.set_title(title);ax.set_xlabel('X mm');ax.set_ylabel('Z mm');ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(ROOT/'review'/f'debug-{region}-indices.png');plt.close(fig)
print('CAGE_INDEX_PLOTS_WRITTEN')
