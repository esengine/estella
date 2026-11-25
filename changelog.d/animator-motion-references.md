---
section: Fixed
commits:
  - fix(editor): choose Animator clips by project asset and preserve registered motions
  - fix(assets): resolve indexed animation and graph references across targets
---
**Animator clip menus show matching files and their folders for states and blend motions.** Type a filename or folder to search, use the arrow keys and Enter to pick, or enter a registered motion name. A selection saves the clip and its player in one undo step. Existing controllers and clips that use older indexed references or mixed-case extensions now load consistently in previews and exported builds.
