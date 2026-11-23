---
section: Fixed
commits:
  - fix(assets): distinguish scene and prefab reference counts by world
  - fix(editor): qualify inspected asset users with the editing world
---
**Asset diagnostics now count each world's use of a shared texture, material or font.** A sprite or mesh in another world keeps its entry when a same-numbered entity despawns or its registry disconnects. A world can also be passed to the counter to inspect its own users.
