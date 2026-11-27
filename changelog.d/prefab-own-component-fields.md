---
section: Fixed
commits:
  - fix(prefab): compare own component fields when saving overrides
---
**Prefab save handles custom component fields that share names with built-in JavaScript properties.** Instances keep inherited prefab values when fields are absent and preserve explicitly authored overrides.
