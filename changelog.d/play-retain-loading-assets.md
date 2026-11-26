---
section: Fixed
commits:
  - fix(runtime): preserve loading assets when toggling visibility
  - fix(editor): preserve loading assets during Play field edits
---
**Play visibility and field edits keep assets loading.** Hiding a renderer or editing an unrelated property no longer cancels its pending texture or mesh.
