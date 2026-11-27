---
section: Fixed
commits:
  - fix(editor): show unbound Animator parameters
  - fix(animation): unbind deleted Animator parameters
---
**Deleting an Animator parameter leaves its transition conditions inactive.** The editor shows the missing binding so you can choose another parameter. Playback and constraint settings release the deleted binding, and blend trees keep their authored clips and thresholds.
