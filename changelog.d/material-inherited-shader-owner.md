---
section: Fixed
commits:
  - fix(material): resolve the active shader through material instance chains
---
**Material instances use the closest inherited shader throughout the runtime.** Uniform declarations, static switches, and reported shader handles follow the active shader. A local permutation stays valid when an ancestor changes shaders.
