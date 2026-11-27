---
section: Fixed
commits:
  - fix(material): replace live shader programs with the material state
  - fix(editor): preview material shader changes before saving
---
**Changing a material's shader updates its live scene appearance and preview.** The new shader and parameters take effect together, including on instances that inherit the shader.
