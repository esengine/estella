---
section: Fixed
commits:
  - fix(cook): reject packages with unresolved tiled terrain images
---
**Packaging reports unavailable tiled terrain images.** When a terrain document names an unregistered, excluded, or missing
local image, the cook reports the document and image reference and marks the build unsuccessful.
