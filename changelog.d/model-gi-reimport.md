---
section: Fixed
commits:
  - fix(editor): follow active mesh lighting bakes on reimport
  - fix(gi): withdraw inactive mesh bakes across imports and runtimes
---
**A model’s Dynamic GI import setting now applies to the edit viewport, Play and exported games.** Turning it off and reimporting removes the distance field and surface cards from the model’s dependencies. Existing scenes can still reference either file directly. Turning it back on reuses the bake’s asset IDs where available. Hiding or removing the last contributing mesh clears the previous lighting field. A full project scan also recognizes a deleted file when its `.meta` still exists.
