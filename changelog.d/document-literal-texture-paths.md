---
section: Fixed
commits:
  - fix(assets): prefer literal filenames when resolving document references
  - fix(editor): preserve literal texture names in flipbook previews
---
**Flipbooks find textures with a `#` in their filename.** The editor and exported game check the full filename before looking for a texture with a URL suffix removed.
