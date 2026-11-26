---
section: Fixed
commits:
  - fix(assets): recognize structured refs during scene reprojection
  - fix(editor): ship nested asset refresh and effect reference fixes
---
**Scene asset updates reach references inside arrays and objects.** The editor refreshes nested resource handles and terrain layer paths while leaving post-process textures in the reference format their renderer expects.
