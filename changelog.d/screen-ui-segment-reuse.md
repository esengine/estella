---
note: A screen UI split over several root Canvases rebuilds only the Canvas that changed.
commits:
  - fix(render): a screen root that replaces another takes over the segment the other held - opening a scene gave its Canvas a new root, so the held overlay shut the old root's pool down and made a new one, whose fresh vertex layouts named new pipelines that are never erased; the editor grew two pipelines and about 2.4 KB of heap on every scene opened back and forth
---
