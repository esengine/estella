---
section: Fixed
commits:
  - fix(editor): mark HLOD proxies stale when simplification settings change
---
**The HLOD panel flags proxies after simplification settings change.** Changing the triangle ratio or allowed error marks the previous preview stale, including when the settings are inherited from a prefab.
