---
section: Changed
commits:
  - perf(picking): reuse live mesh transform readers during selection
---
**Model selection reuses transform reads in large scenes.** Clicks and area selection can read each model through the same live transform reader, avoiding a fresh transform snapshot each time.
