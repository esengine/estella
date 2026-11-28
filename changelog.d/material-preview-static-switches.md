---
section: Fixed
commits:
  - fix(editor): check and preserve material shader switches
  - fix(render): share material switch selection with editor diagnostics
---
**Shader sample diagnostics check the material's enabled static switches.** The preview follows instances to the material that owns the shader, and updating a paired material with the shader write tool preserves its saved switches.
