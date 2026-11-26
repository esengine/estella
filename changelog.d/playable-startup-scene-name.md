---
section: Fixed
commits:
  - fix(export): preserve startup scene names in single-scene playables
---
**Single-scene playable ads preserve the startup scene's runtime name.** Nested scene names and `@project/` aliases match editor Play and all-scenes exports, so scene lookups keep working when you change how many scenes the playable includes.
