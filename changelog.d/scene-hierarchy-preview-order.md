---
section: Fixed
commits:
  - fix(editor): preserve live sibling order through hierarchy edits
  - fix(ecs): keep live hierarchy order consistent with saved scenes
---
**Same-named siblings resolve in the same order in the live scene and after reload.** Reparenting and undoing a deletion restore the authored sibling order. Reordering siblings also refreshes cached paths used by animation and camera targets.
