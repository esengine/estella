---
section: Changed
commits:
  - feat(pipeline): share source asset imports with the editor
  - fix(editor): refresh imported products from source metadata
---
**The editor and command line use the same settings to import source assets.** Run `estella import-source` on a model, PSD, Aseprite animation, HDR or EXR panorama, or six-face environment before exporting. The existing model and HDR commands also read the source’s saved import settings and accept explicit overrides. When those settings change on disk, the editor refreshes the generated assets, including placed model instances, and keeps their existing references. The Content Browser groups generated sprites, clips and environments under their source alongside model products.
