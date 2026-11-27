---
section: Fixed
commits:
  - fix(material): use the shader default for cleared texture overrides
  - fix(editor): distinguish clearing a texture override from inheriting it
---
**Material texture overrides can be edited in Details.** Clearing a texture uses the shader default in live preview and after a reload. Turning off the override restores the parent texture.
