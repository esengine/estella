---
section: Fixed
commits:
  - fix(editor): keep long picker highlights visible after layout changes
---
**Long searchable pickers keep the keyboard highlight in view when rows are measured or the list resizes.** Entity, joint, and suggestion pickers still allow manual scrolling independently of the highlighted choice.
