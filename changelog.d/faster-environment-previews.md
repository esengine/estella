---
section: Changed
commits:
  - perf(editor): reuse panorama coordinates across environment preview rows
---
**Environment previews refresh faster when rotating a sky.** The Lighting panel reuses the panorama's horizontal sampling coordinates across rows and keeps the same sky, diffuse and mirror previews.
