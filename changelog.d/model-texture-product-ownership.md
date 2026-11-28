---
section: Fixed
commits:
  - fix(import): protect model texture products from other imports
---
**Models imported into the same project folder keep their own generated textures.** Importing another model with the same output filename preserves the first texture and its asset ID. Reimporting updates each model's established texture path.
