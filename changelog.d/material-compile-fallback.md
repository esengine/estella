---
section: Changed
commits:
  - feat(render): a mesh whose material is still compiling draws with its default surface meanwhile
---
**A scene shows all its meshes while their materials compile.** A mesh whose material shader was still compiling in the background used to be left out of the frame until the compile ended, so a large scene filled in piece by piece for seconds after it opened. Such a mesh now draws with the mesh's own default surface, and its material takes over in the first frame its shader is ready.
