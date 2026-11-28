---
section: Fixed
commits:
  - fix(assets): resolve environment images with indexed sibling fallback
  - fix(editor): resolve environment images consistently for preview and bake
---
**Environment images resolve consistently in previews, bakes and builds.** Environment files can reference a nearby image, a project path, or an indexed UUID. The Lighting panel and reflection bakes can now use those references to read the same authored sky and reflection atlas as the runtime.
