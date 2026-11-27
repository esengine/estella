---
section: Fixed
commits:
  - fix(editor): inherit viewport visibility from source parent links
  - fix(project): ship consistent viewport hierarchy visibility
---
**The Outliner eye hides the same descendants live and after reopening a scene.** Older scenes with stale child lists keep unrelated sprites and meshes visible. Descendants still inherit visibility from a parent that is absent from the preview world.
