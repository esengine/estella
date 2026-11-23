---
section: Fixed
commits:
  - fix(render): identify the module for every optional built-in shader
---
**Materials that use an uninstalled waterfall, planet, terrain surface bake or voxel ground shader now name the module to import.** These shaders also appear with their module's templates in the material menu regardless of installation order.
