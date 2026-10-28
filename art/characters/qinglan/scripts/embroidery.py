"""Union the reference stitch paths in garment space before mapping to 3D."""
import os,sys,math
from pathlib import Path
sys.path.append(os.environ.get('QINGLAN_GEOMETRY_LIBS',r'D:\tmp\qinglan-blender-python'))
import shapely
from shapely.geometry import LineString,Polygon
from common import *

def build_relief(patterns,material):
    outputs=[]
    for fn,paths in patterns.items():
        su,sv=fn.uv_scale
        ribbons=[]
        for points,radius in paths:
            # The dense source paths already describe the approved lotus/cloud contours.
            line=LineString([(float(u)*su,float(v)*sv) for u,v in points])
            ribbons.append(line.buffer(radius,quad_segs=4,cap_style='round',join_style='round'))
        merged=shapely.set_precision(shapely.union_all(ribbons),grid_size=.000002)
        polygons=list(merged.geoms) if hasattr(merged,'geoms') else [merged]
        vertices=[];uv=[];faces=[];lookup={}
        def vertex(x,y,side):
            key=(round(x,9),round(y,9),side)
            if key not in lookup:
                u=x/su;v=y/sv;p=Vector(fn(u,v));n=fn.normal(u,v)
                lookup[key]=len(vertices);vertices.append(p+n*(.00035 if side else -.00035));uv.append((u,v))
            return lookup[key]
        for poly in polygons:
            if poly.geom_type!='Polygon' or poly.area<1e-9:continue
            holes=[r.coords for r in poly.interiors if Polygon(r).area>2e-8]
            poly=Polygon(poly.exterior.coords,holes).simplify(.000006,preserve_topology=True)
            triangles=shapely.constrained_delaunay_triangles(poly)
            for tri in triangles.geoms:
                xy=list(tri.exterior.coords)[:3]
                faces.append(tuple(vertex(x,y,1) for x,y in xy))
                faces.append(tuple(vertex(x,y,0) for x,y in reversed(xy)))
            for ring in [poly.exterior,*poly.interiors]:
                pts=list(ring.coords)
                for a,b in zip(pts[:-1],pts[1:]):
                    faces.append((vertex(*a,0),vertex(*b,0),vertex(*b,1),vertex(*a,1)))
        ob=mesh_object('QL06_Embroidery_'+fn.source_name,vertices,faces,material,uv)
        ob['part_id']='QL06'
        # The narrow relief retains the watertight constrained triangulation.
        # Beveling micrometre-scale junctions would create overlapping slivers.
        outputs.append(ob)
    return outputs
