---
section: Fixed
commits:
  - "fix(export): restage suffixes Douyin's developer tool does not pack"
---
**A Douyin export no longer loses its prefabs, materials and meshes.** Douyin's developer tool leaves out every file whose suffix it does not know, so `.esprefab`, `.esmaterial` and `.esmesh` read back as "File not found" in a preview. The export now ships those as `<name>.<ext>.bin`, as the WeChat export does, and the runtime reads through the rename.
