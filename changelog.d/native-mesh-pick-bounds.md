---
section: Fixed
commits:
  - fix(picking): resolve mesh bounds on native hosts
---
**Native picking can hit mesh geometry away from its origin.** Native hosts resolve the same resident and inline mesh bounds as Web, so ray and area picks can use the model's actual extent.
