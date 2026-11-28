---
section: Changed
commits:
  - perf(editor): notify only subscribers of completed asset thumbnails
---
**Generated asset previews target updates to the tiles that show them.** When a mesh, material, or prefab preview finishes in the asset picker or Content Browser, only tiles for that asset recheck their thumbnail. Project file changes still refresh previews that may depend on those files.
