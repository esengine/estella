---
section: Fixed
commits:
  - fix(render): keep authored geometry when the core rejects an upload
---
**Inline meshes keep their last accepted geometry when an upload is rejected.** The scene snapshot only changes after the engine accepts the replacement, so malformed indices cannot overwrite the saved geometry.
