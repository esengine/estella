---
section: Fixed
commits:
  - fix(import): track external gltf hair maps as dependencies
---
**Imported glTF hair materials keep their external flow and shift textures.** Import resolves these maps from the source model's directory, registers them as linear data, and reports missing maps so the generated material and package can use the remaining textures.
