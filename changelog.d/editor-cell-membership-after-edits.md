---
section: Fixed
commits:
  - fix(editor): apply cell actions to the current world partition
---
**Cell loading follows the latest scene edits.** Applying a load or unload brings the viewport back in line with the current partition, including entities moved between cells and subtrees that have become persistent.
