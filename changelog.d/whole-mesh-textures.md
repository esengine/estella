---
section: Fixed
commits:
  - fix(pipeline): preserve whole textures sampled by mesh UVs
---
**Meshes keep their original texture coordinates when automatic atlas packing is enabled.** A texture sampled by a mesh, an inherited material or a baked lightmap ships as a whole image, including when a sprite or UI image also uses it. The exporter recognises bindings from prefab variants and instance overrides.
