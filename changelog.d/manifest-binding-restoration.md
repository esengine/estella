---
section: Fixed
commits:
  - fix(assets): rebind live scene fields when manifest records return
---
**Running scenes follow renamed and restored materials and textures.** A sprite or mesh keeps drawing its current asset while its record is absent. Restoring the same UUID updates its live fields, even if the file moved. An asset that subsequently takes the old filename keeps its own handle.
