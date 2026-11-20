---
section: Added
commits:
  - feat(editor): an HLOD tab in the World panel, as Unreal's Hierarchical LOD Outliner
---
**An HLOD view, as in Unreal's Hierarchical LOD Outliner.** The World panel gains an HLOD tab listing each cell's far-proxy cluster: the triangles its meshes draw, the triangles the proxy draws after simplification, the share kept, and whether it is built or out of date. Open a cluster to see the entities it merges and the ones it leaves out with the reason (not opaque, moving, skinned and so on). Generate Proxy Mesh and Build All make the proxies exactly as a build does; picking a cluster selects its entities and rings it in the viewport.
