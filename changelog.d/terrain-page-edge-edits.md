---
section: Fixed
commits:
  - fix(terrain): refresh pages when their border samples change
---
**Terrain lighting follows edits near page seams.** Height changes refresh neighboring render pages whose edge normals depend on the edited samples, including coarser levels of detail.
