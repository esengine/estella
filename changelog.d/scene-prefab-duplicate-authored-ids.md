---
section: Fixed
commits:
  - "fix(scene): check authored ids before expanding prefab instances"
---
**Scenes with repeated entity IDs fail consistently when they contain prefab instances.** Scene preparation reports the duplicate ID before resolving prefab assets, including when a missing prefab would have hidden the conflict.
