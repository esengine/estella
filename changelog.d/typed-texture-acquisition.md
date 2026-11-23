---
section: Fixed
commits:
  - fix(assets): share texture acquisitions across SDK entry points
---
**Loading a texture through `acquireTyped('texture', ref)` and `acquireTexture(ref)` shares one upload and honors the same import settings and streaming quality.** Concurrent callers can release their own receipts independently. Custom texture loaders registered for typed requests still handle those requests.
