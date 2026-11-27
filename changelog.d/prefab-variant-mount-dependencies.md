---
section: Fixed
commits:
  - fix(prefab): preload the effective variant mounts
---
**Prefab variants load the nested dependencies they actually use.** The editor and runtime can load inherited mounts through deep variant chains, and a replaced mount no longer requires its old prefab file.
