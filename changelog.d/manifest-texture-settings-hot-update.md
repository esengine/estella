---
section: Fixed
commits:
  - fix(assets): apply manifest-only updates to live packaged assets
---
**Packaged games now apply texture sampling and nine-slice changes during a hot update.** A running sprite or textured mesh picks up the new settings even when its image file is identical. The download estimate counts only files that need verification. With update persistence enabled, the next launch uses the saved settings.
