---
section: Fixed
commits:
  - fix(editor): restore rejected Animator parameter names
  - fix(animation): keep controller references when renaming Animator parameters
---
**Renaming an Animator parameter keeps its controller bindings.** Transitions, blend trees, playback settings and constraints follow the new name through layers and sub-machines. The editor restores the previous name when a rename is blank or conflicts with an existing parameter.
