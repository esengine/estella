---
section: Fixed
commits:
  - fix(material): keep inherited texture references tied to their source
  - fix(editor): ship accurate inherited material textures
---
**Material instances show the textures inherited from their ancestors.** Enabling an override starts with the same image that was inherited, even when the two materials live in different folders and each folder contains an image with the same name.
