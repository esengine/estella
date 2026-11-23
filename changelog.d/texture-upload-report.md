---
section: Fixed
commits:
  - fix(assets): keep the effective GPU format with each texture upload
---
**The texture inspector reports each image’s actual GPU format during concurrent loads and after streaming changes its size.** A KTX2 data texture that falls back to RGBA on the engine upload path retains its linear sampling, including normal and roughness maps.
